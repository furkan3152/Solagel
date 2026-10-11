#!/usr/bin/env bash
# Build the ABI-compatible compact program; never deploy or spend funds.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
export CARGO_PROFILE_RELEASE_OPT_LEVEL=z
export CARGO_PROFILE_RELEASE_PANIC=abort
export RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }-C llvm-args=-inline-threshold=0 -C llvm-args=-inlinehint-threshold=0"
cargo build-sbf --manifest-path programs/solagel-compact/Cargo.toml \
  --sbf-out-dir target/deploy --tools-version v1.57 --arch v3 --lto -- --locked "$@" 2>&1 | tee "$LOG"
# The SBF compiler can exit successfully even after a stack overflow diagnostic.
if rg -qi 'stack offset.*exceeded|stack frame.*exceeded|overflows? the max stack|Error:' "$LOG"; then
  printf '%s\n' 'SBF diagnostics failed validation. Do not deploy this artifact.' >&2
  exit 1
fi
wc -c target/deploy/solagel_compact.so
sha256sum target/deploy/solagel_compact.so
printf '%s\n' 'Built only. Run the parity tests and the read-only deploy-budget command before deployment.'
