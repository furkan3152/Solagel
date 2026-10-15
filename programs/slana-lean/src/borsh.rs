//! Borsh, without `alloc`: a cursor over instruction arguments and little-endian field
//! accessors for account data.
//!
//! Instruction arguments decode exactly like Anchor's `AnchorDeserialize::deserialize`
//! (trailing bytes ignored): any failure is `InstructionDidNotDeserialize` (102), including an
//! `Option` tag or a `bool` other than 0/1 and a `String` that is not UTF-8.
//!
//! The field accessors take `&[u8]` plus a constant offset. Account data is always handed out
//! as a fixed-size array (`accounts::load`), so the bounds checks fold away at compile time.

use {
    crate::error::Result,
    crate::error::{err, INSTRUCTION_DID_NOT_DESERIALIZE},
};

/// Reads instruction arguments front to back.
///
/// Decoding errors are sticky: a read past the end (or an invalid `bool` / `Option` tag /
/// UTF-8 string) yields a zero value and marks the reader failed; [`Args::finish`] then
/// returns `InstructionDidNotDeserialize`. Handlers decode all arguments before touching any
/// account and call `finish` once, so the outcome equals Anchor's all-or-nothing decode
/// without an error branch per field.
pub struct Args<'a> {
    rest: &'a [u8],
    failed: bool,
}

impl<'a> Args<'a> {
    #[inline(always)]
    pub fn new(data: &'a [u8]) -> Self {
        Self {
            rest: data,
            failed: false,
        }
    }

    /// `InstructionDidNotDeserialize` if any read failed.
    #[inline(always)]
    pub fn finish(&self) -> Result {
        if self.failed {
            Err(err(INSTRUCTION_DID_NOT_DESERIALIZE))
        } else {
            Ok(())
        }
    }

    /// The next `len` bytes (empty and failed when fewer remain).
    #[inline(never)]
    pub fn bytes(&mut self, len: usize) -> &'a [u8] {
        match self.rest.split_at_checked(len) {
            Some((head, rest)) => {
                self.rest = rest;
                head
            }
            None => {
                self.failed = true;
                self.rest = &[];
                &[]
            }
        }
    }

    /// Little-endian unsigned integer of `len` (≤ 8) bytes.
    #[inline(never)]
    fn uint(&mut self, len: usize) -> u64 {
        let mut le = [0u8; 8];
        let bytes = self.bytes(len);
        put(&mut le, 0, bytes);
        u64::from_le_bytes(le)
    }

    pub fn u8(&mut self) -> u8 {
        self.uint(1) as u8
    }

    pub fn u16(&mut self) -> u16 {
        self.uint(2) as u16
    }

    pub fn u32(&mut self) -> u32 {
        self.uint(4) as u32
    }

    pub fn u64(&mut self) -> u64 {
        self.uint(8)
    }

    pub fn i64(&mut self) -> i64 {
        self.uint(8) as i64
    }

    /// `[u8; 32]` (a `Pubkey` or a hash).
    #[inline(never)]
    pub fn key(&mut self) -> [u8; 32] {
        let mut out = [0u8; 32];
        if let Some(src) = self.bytes(32).first_chunk::<32>() {
            out = *src;
        }
        out
    }

    /// Borsh `bool`: exactly 0 or 1.
    #[inline(never)]
    pub fn bool(&mut self) -> bool {
        let b = self.uint(1);
        if b > 1 {
            self.failed = true;
        }
        b == 1
    }

    /// Borsh `Option` tag: `false` for `None` (0), `true` for `Some` (1).
    pub fn some(&mut self) -> bool {
        self.bool()
    }

    /// Borsh `String`: u32 length + UTF-8 bytes.
    #[inline(never)]
    pub fn string(&mut self) -> &'a [u8] {
        let len = self.u32() as usize;
        let bytes = self.bytes(len);
        if !is_utf8(bytes) {
            self.failed = true;
        }
        bytes
    }
}

/// `core::str::from_utf8(bytes).is_ok()`, in a fraction of the code: shortest-form sequences of
/// 1–4 bytes, no surrogates (U+D800..=U+DFFF), nothing above U+10FFFF.
#[inline(never)]
pub fn is_utf8(bytes: &[u8]) -> bool {
    let mut rest = bytes;
    while let Some((&lead, tail)) = rest.split_first() {
        rest = tail;
        if lead < 0x80 {
            continue;
        }
        let (extra, min, mut cp) = match lead {
            0xc0..=0xdf => (1, 0x80, u32::from(lead & 0x1f)),
            0xe0..=0xef => (2, 0x800, u32::from(lead & 0x0f)),
            0xf0..=0xf7 => (3, 0x1_0000, u32::from(lead & 0x07)),
            _ => return false,
        };
        for _ in 0..extra {
            match rest.split_first() {
                Some((&b, tail)) if b & 0xc0 == 0x80 => {
                    cp = (cp << 6) | u32::from(b & 0x3f);
                    rest = tail;
                }
                _ => return false,
            }
        }
        if cp < min || cp > 0x10_ffff || (cp >= 0xd800 && cp <= 0xdfff) {
            return false;
        }
    }
    true
}

// ----- account data -------------------------------------------------------------------------

#[inline(always)]
fn chunk<const N: usize>(d: &[u8], off: usize) -> [u8; N] {
    match d.get(off..).and_then(|rest| rest.first_chunk::<N>()) {
        Some(src) => *src,
        None => [0u8; N],
    }
}

/// Copies `src` to `d[off..]`. A write that does not fit aborts the program (it is never
/// dropped silently): every caller writes a constant field offset into a fixed-size array,
/// so the check folds away and the abort is unreachable (the layout tests pin each offset).
#[inline(always)]
fn put(d: &mut [u8], off: usize, src: &[u8]) {
    match d.get_mut(off..off.wrapping_add(src.len())) {
        // SAFETY: `dst` is exactly `src.len()` bytes; the two cannot overlap (`src` is never
        // a part of `d` here).
        Some(dst) => unsafe {
            core::ptr::copy_nonoverlapping(src.as_ptr(), dst.as_mut_ptr(), src.len())
        },
        None => write_out_of_range(),
    }
}

/// A field write past the end of its buffer: abort (`sol_panic_`-free, no message).
#[cold]
#[inline(never)]
fn write_out_of_range() -> ! {
    #[cfg(target_os = "solana")]
    // SAFETY: `abort` ends the program; nothing runs after it.
    unsafe {
        pinocchio::syscalls::abort()
    }
    #[cfg(not(target_os = "solana"))]
    panic!("borsh: field write out of range")
}

#[inline(always)]
pub fn rd_u8(d: &[u8], off: usize) -> u8 {
    chunk::<1>(d, off)[0]
}

#[inline(always)]
pub fn rd_bool(d: &[u8], off: usize) -> bool {
    rd_u8(d, off) != 0
}

#[inline(always)]
pub fn rd_u16(d: &[u8], off: usize) -> u16 {
    u16::from_le_bytes(chunk(d, off))
}

#[inline(always)]
pub fn rd_u32(d: &[u8], off: usize) -> u32 {
    u32::from_le_bytes(chunk(d, off))
}

#[inline(always)]
pub fn rd_u64(d: &[u8], off: usize) -> u64 {
    u64::from_le_bytes(chunk(d, off))
}

#[inline(always)]
pub fn rd_i64(d: &[u8], off: usize) -> i64 {
    i64::from_le_bytes(chunk(d, off))
}

#[inline(always)]
pub fn rd_key(d: &[u8], off: usize) -> [u8; 32] {
    chunk(d, off)
}

/// `N` bytes at `off` (zeros when out of range).
#[inline(always)]
pub fn rd_arr<const N: usize>(d: &[u8], off: usize) -> [u8; N] {
    chunk(d, off)
}

#[inline(always)]
pub fn wr_u8(d: &mut [u8], off: usize, v: u8) {
    put(d, off, &[v]);
}

#[inline(always)]
pub fn wr_bool(d: &mut [u8], off: usize, v: bool) {
    wr_u8(d, off, v as u8);
}

#[inline(always)]
pub fn wr_u16(d: &mut [u8], off: usize, v: u16) {
    put(d, off, &v.to_le_bytes());
}

#[inline(always)]
pub fn wr_u32(d: &mut [u8], off: usize, v: u32) {
    put(d, off, &v.to_le_bytes());
}

#[inline(always)]
pub fn wr_u64(d: &mut [u8], off: usize, v: u64) {
    put(d, off, &v.to_le_bytes());
}

#[inline(always)]
pub fn wr_i64(d: &mut [u8], off: usize, v: i64) {
    put(d, off, &v.to_le_bytes());
}

#[inline(always)]
pub fn wr_bytes(d: &mut [u8], off: usize, v: &[u8]) {
    put(d, off, v);
}

#[cfg(test)]
mod tests {
    use {super::*, anchor_lang::AnchorSerialize};

    #[test]
    fn args_decode_like_borsh() {
        #[derive(AnchorSerialize)]
        struct S {
            a: u8,
            b: u16,
            c: u32,
            d: u64,
            e: i64,
            f: bool,
            g: Option<u16>,
            h: Option<u16>,
            i: String,
            j: [u8; 32],
        }
        let s = S {
            a: 1,
            b: 0x0203,
            c: 0x0405_0607,
            d: 0x0809_0a0b_0c0d_0e0f,
            e: -5,
            f: true,
            g: None,
            h: Some(77),
            i: "héllo/".into(),
            j: [9; 32],
        };
        let mut bytes = Vec::new();
        s.serialize(&mut bytes).unwrap();
        let mut a = Args::new(&bytes);
        assert_eq!(a.u8(), s.a);
        assert_eq!(a.u16(), s.b);
        assert_eq!(a.u32(), s.c);
        assert_eq!(a.u64(), s.d);
        assert_eq!(a.i64(), s.e);
        assert!(a.bool());
        assert!(!a.some());
        assert!(a.some());
        assert_eq!(a.u16(), 77);
        assert_eq!(a.string(), s.i.as_bytes());
        assert_eq!(a.key(), s.j);
        assert_eq!(a.finish(), Ok(()));
        // Trailing bytes are ignored (Anchor uses `deserialize`, not `try_from_slice`); a read
        // past the end fails.
        a.u8();
        assert_eq!(a.finish(), Err(err(INSTRUCTION_DID_NOT_DESERIALIZE)));
    }

    fn fails(f: impl FnOnce(&mut Args)) -> bool {
        let data = [2u8, 1, 0, 0, 0, 0xff];
        let mut a = Args::new(&data);
        f(&mut a);
        a.finish().is_err()
    }

    #[test]
    fn args_reject_what_borsh_rejects() {
        assert!(fails(|a| {
            a.bool();
        }));
        assert!(fails(|a| {
            a.some();
        }));
        // u32 length 0x0102 past the end.
        assert!(fails(|a| {
            a.u8();
            a.string();
        }));
        // 1-byte string 0xff after a 1-byte skip: not UTF-8.
        let data = [1u8, 0, 0, 0, 0xff];
        let mut a = Args::new(&data);
        a.string();
        assert!(a.finish().is_err());
        let mut a = Args::new(&[1, 0, 0]);
        assert_eq!(a.u32(), 0);
        assert!(a.finish().is_err());
        assert!(!fails(|a| {
            a.u32();
            a.u16();
        }));
    }

    /// `is_utf8` agrees with `core::str::from_utf8` on every 1–3 byte input, on all 4-byte
    /// inputs with a 4-byte lead, and on a sample of longer mixes.
    #[test]
    fn utf8_matches_core() {
        let check = |b: &[u8]| {
            assert_eq!(is_utf8(b), core::str::from_utf8(b).is_ok(), "{b:02x?}");
        };
        check(&[]);
        for a in 0..=255u8 {
            check(&[a]);
            for b in 0..=255u8 {
                check(&[a, b]);
            }
        }
        for a in 0xc0..=0xffu8 {
            for b in 0..=255u8 {
                for c in [
                    0x00, 0x41, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xff,
                ] {
                    check(&[a, b, c]);
                }
            }
        }
        for a in 0xf0..=0xffu8 {
            for b in 0x80..=0xbfu8 {
                for c in [0x7f, 0x80, 0xbf, 0xc0] {
                    for d in [0x7f, 0x80, 0xbf, 0xc0] {
                        check(&[a, b, c, d]);
                    }
                }
            }
        }
        let mut seed = 0x1234_5678_9abc_def0u64;
        for _ in 0..20_000 {
            let mut v = Vec::new();
            for _ in 0..(seed % 12) {
                seed = seed
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                v.push((seed >> 33) as u8);
            }
            check(&v);
            let text: String = (0..(seed % 6))
                .map(|i| char::from_u32(((seed >> (i * 7)) as u32) % 0x11_0000).unwrap_or('x'))
                .collect();
            check(text.as_bytes());
        }
    }

    #[test]
    #[should_panic(expected = "field write out of range")]
    fn out_of_range_write_aborts() {
        let mut d = [0u8; 8];
        wr_u64(&mut d, 1, 7);
    }

    #[test]
    fn field_accessors_round_trip() {
        let mut d = [0u8; 40];
        wr_u16(&mut d, 1, 0xBEEF);
        wr_u64(&mut d, 3, u64::MAX - 1);
        wr_i64(&mut d, 11, -2);
        wr_bool(&mut d, 19, true);
        wr_bytes(&mut d, 20, &[7; 20]);
        assert_eq!(rd_u16(&d, 1), 0xBEEF);
        assert_eq!(rd_u64(&d, 3), u64::MAX - 1);
        assert_eq!(rd_i64(&d, 11), -2);
        assert!(rd_bool(&d, 19));
        assert_eq!(rd_u8(&d, 39), 7);
    }
}
