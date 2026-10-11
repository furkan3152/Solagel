//! Borsh-compatible readers whose private errors do not format diagnostics.
//!
//! Instruction and account boundaries already map every decode error to the
//! stable public codes 102 and 3003. Formatting Borsh's discarded bool, option,
//! or UTF-8 error messages needlessly links Rust's formatting runtime into SBF.
use borsh::{
    io::{self, ErrorKind, Read},
    BorshDeserialize,
};
use solana_pubkey::Pubkey;

#[inline]
pub fn pubkey<R: Read>(reader: &mut R) -> io::Result<Pubkey> {
    let mut bytes = [0u8; 32];
    reader.read_exact(&mut bytes).map_err(|error| {
        if error.kind() == ErrorKind::UnexpectedEof {
            ErrorKind::InvalidData.into()
        } else {
            error
        }
    })?;
    Ok(Pubkey::new_from_array(bytes))
}

#[inline]
pub fn boolean<R: Read>(reader: &mut R) -> io::Result<bool> {
    match u8::deserialize_reader(reader)? {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(ErrorKind::InvalidData.into()),
    }
}

#[inline]
fn optional_with<T, R: Read>(
    reader: &mut R,
    read_value: impl FnOnce(&mut R) -> io::Result<T>,
) -> io::Result<Option<T>> {
    match u8::deserialize_reader(reader)? {
        0 => Ok(None),
        1 => read_value(reader).map(Some),
        _ => Err(ErrorKind::InvalidData.into()),
    }
}

#[inline]
pub fn option<T: BorshDeserialize, R: Read>(reader: &mut R) -> io::Result<Option<T>> {
    optional_with(reader, T::deserialize_reader)
}

#[inline]
pub fn option_bool<R: Read>(reader: &mut R) -> io::Result<Option<bool>> {
    optional_with(reader, boolean)
}

#[inline]
pub fn option_pubkey<R: Read>(reader: &mut R) -> io::Result<Option<Pubkey>> {
    optional_with(reader, pubkey)
}

#[inline]
pub fn string<R: Read>(reader: &mut R) -> io::Result<String> {
    // Retain Borsh's exact u32 length decoder, bounded initial allocation, read
    // behavior and truncation checks, including maliciously large lengths.
    let bytes = Vec::<u8>::deserialize_reader(reader)?;
    String::from_utf8(bytes).map_err(|_| ErrorKind::InvalidData.into())
}

#[inline]
pub fn option_string<R: Read>(reader: &mut R) -> io::Result<Option<String>> {
    optional_with(reader, string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::fmt::Debug;

    fn same_decode<'a, T: BorshDeserialize + Debug + PartialEq>(
        bytes: &'a [u8],
        compact: impl FnOnce(&mut &'a [u8]) -> io::Result<T>,
    ) {
        let mut reference_input = bytes;
        let mut compact_input = bytes;
        let reference = T::deserialize(&mut reference_input);
        let compact = compact(&mut compact_input);
        assert_eq!(reference_input, compact_input, "same input consumption");
        match (reference, compact) {
            (Ok(reference), Ok(compact)) => assert_eq!(reference, compact),
            (Err(reference), Err(compact)) => assert_eq!(reference.kind(), compact.kind()),
            (reference, compact) => panic!("different decode outcomes: {reference:?}, {compact:?}"),
        }
    }

    #[test]
    fn all_boolean_and_optional_tags_match_borsh() {
        same_decode::<bool>(&[], boolean);
        same_decode::<Option<u64>>(&[], option);
        for tag in 0..=u8::MAX {
            same_decode::<bool>(&[tag, 99], boolean);
            let mut data = vec![tag];
            data.extend_from_slice(&u64::MAX.to_le_bytes());
            data.push(99);
            same_decode::<Option<u64>>(&data, option);
            for boolean_tag in 0..=u8::MAX {
                same_decode::<Option<bool>>(&[tag, boolean_tag, 99], option_bool);
            }
        }
        for len in 1..9 {
            same_decode::<Option<u64>>(&[1; 9][..len], option);
        }
    }

    #[test]
    fn strings_preserve_unicode_lengths_trailing_bytes_and_decode_errors() {
        for value in ["", "solagel", "Jelly 🪼", "abcdefghijklmnopq", "\0\n"] {
            let mut data = borsh::to_vec(value).unwrap();
            data.extend_from_slice(&[17, 99]);
            same_decode::<String>(&data, string);
            let mut optional = vec![1];
            optional.extend_from_slice(&data);
            same_decode::<Option<String>>(&optional, option_string);
        }
        for data in [
            vec![],
            vec![1],
            vec![1, 0],
            vec![1, 0, 0],
            vec![1, 0, 0, 0],
            vec![2, 0, 0, 0, b'a'],
            vec![1, 0, 0, 0, 0xff],
            vec![2, 0, 0, 0, 0xc3, 0x28],
            vec![255, 255, 255, 255],
        ] {
            same_decode::<String>(&data, string);
            let mut optional = vec![1];
            optional.extend_from_slice(&data);
            same_decode::<Option<String>>(&optional, option_string);
        }
        same_decode::<Option<String>>(&[0, 99], option_string);
        same_decode::<Option<String>>(&[2, 99], option_string);
    }

    #[test]
    fn pubkeys_preserve_bytes_truncation_optional_tags_and_remaining_input() {
        let mut data = Vec::from(core::array::from_fn::<_, 32, _>(|index| index as u8));
        data.extend_from_slice(&[17, 99]);
        for len in 0..=data.len() {
            same_decode::<Pubkey>(&data[..len], pubkey);
            let mut some = vec![1];
            some.extend_from_slice(&data[..len]);
            same_decode::<Option<Pubkey>>(&some, option_pubkey);
        }
        for tag in 0..=u8::MAX {
            let mut bytes = vec![tag];
            bytes.extend_from_slice(&data);
            same_decode::<Option<Pubkey>>(&bytes, option_pubkey);
        }
    }
}
