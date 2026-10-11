use std::{env, fs, path::PathBuf};

fn main() {
    let source = "../solagel/src/lib.rs";
    println!("cargo:rerun-if-changed={source}");
    let reference = fs::read_to_string(source).expect("read reference program ID");
    let marker = "declare_id!(\"";
    let start = reference.find(marker).expect("reference declare_id") + marker.len();
    let id = reference[start..]
        .split('"')
        .next()
        .expect("reference program ID");
    assert!(
        id.bytes().all(|c| c.is_ascii_alphanumeric()),
        "invalid program ID literal"
    );
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR")).join("program_id.rs"),
        format!("solana_pubkey::declare_id!(\"{id}\");\n"),
    )
    .expect("write shared program ID");
}
