#!/usr/bin/env bash
# Builds the deployed Slana program (programs/slana-lean, Pinocchio) into
# target/deploy/slana_lean.so and prints its size and ProgramData rent.
#
#   scripts/build-lean.sh [extra cargo-build-sbf args]
#
# Exact build: `cargo build-sbf --manifest-path programs/slana-lean/Cargo.toml` (release
# profile, LTO fat, SBF target = panic abort, .so stripped by cargo-build-sbf). The size
# settings are `[profile.release.package.slana-lean]` / `pinocchio*` (`opt-level = "z"`) in the
# root Cargo.toml; they do not touch the Anchor reference (programs/slana-ref), which is built
# with `anchor build --ignore-keys` only to produce the IDL and the conformance oracle
# target/deploy/slana.so. Never deploy the reference.
#
# The program id stays 5skf5Twyqr8M84dJ8RLGfz1NU6fR3zPDRLUvGd5y7472: deploy slana_lean.so with
# target/deploy/slana-keypair.json (never committed). cargo-build-sbf also writes a random
# target/deploy/slana_lean-keypair.json; it is removed below so nothing deploys to that id.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The Agave tools are often installed outside PATH.
for dir in /opt/solana/bin "$HOME/.local/share/solana/install/active_release/bin"; do
  if [[ -d "$dir" && ":$PATH:" != *":$dir:"* ]]; then PATH="$dir:$PATH"; fi
done
export PATH

cargo build-sbf --manifest-path programs/slana-lean/Cargo.toml "$@"
rm -f target/deploy/slana_lean-keypair.json

SO=target/deploy/slana_lean.so
LEN=$(wc -c <"$SO" | tr -d ' ')
RENT=$(((LEN + 45 + 128) * 6960))
printf '%s: %s bytes (budget 71000), rent %s lamports = %d.%09d SOL\n' \
  "$SO" "$LEN" "$RENT" $((RENT / 1000000000)) $((RENT % 1000000000))
