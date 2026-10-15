//! Size gate for the deployed program: `target/deploy/slana_lean.so` must stay at or under
//! 71,000 bytes so its ProgramData rent is at most 0.5 SOL.
//!
//! Rent: `(len + 45 + 128) × 6960` lamports (45-byte ProgramData header, 128-byte account
//! storage overhead, 3,480 lamports/byte-year × 2 years exemption).

const MAX_LEAN_SO_BYTES: u64 = 71_000;
const LAMPORTS_PER_BYTE: u64 = 6_960;
const PROGRAM_DATA_OVERHEAD: u64 = 45 + 128;

fn rent_lamports(len: u64) -> u64 {
    (len + PROGRAM_DATA_OVERHEAD) * LAMPORTS_PER_BYTE
}

#[test]
fn lean_program_fits_half_sol() {
    let path = concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/slana_lean.so");
    let len = std::fs::metadata(path)
        .unwrap_or_else(|e| panic!("{path} is missing ({e}): run scripts/build-lean.sh"))
        .len();
    let rent = rent_lamports(len);
    println!(
        "slana_lean.so: {len} bytes (limit {MAX_LEAN_SO_BYTES}), rent {rent} lamports = {}.{:09} SOL",
        rent / 1_000_000_000,
        rent % 1_000_000_000
    );
    assert!(
        len <= MAX_LEAN_SO_BYTES,
        "slana_lean.so is {len} bytes, over the {MAX_LEAN_SO_BYTES}-byte budget"
    );
    assert!(rent <= 500_000_000, "rent {rent} lamports is over 0.5 SOL");
}

#[test]
fn budget_is_half_sol() {
    assert!(rent_lamports(MAX_LEAN_SO_BYTES) <= 500_000_000);
}
