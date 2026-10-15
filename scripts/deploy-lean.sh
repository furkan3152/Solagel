#!/usr/bin/env bash
# Deploys (or upgrades) the lean program target/deploy/slana_lean.so — the only build that is ever
# deployed — at the Slana program id. Refuses to run when the program keypair is not the lean
# program's `ID` (programs/slana-lean/src/lib.rs, pinned to the reference's `declare_id!` by
# `cargo test -p slana-lean`): deploying with another keypair would create a different program.
#
#   scripts/deploy-lean.sh <cluster-url> <program-keypair> [extra `solana program deploy` args]
#   e.g. scripts/deploy-lean.sh devnet target/deploy/slana-keypair.json
#        scripts/deploy-lean.sh https://my-rpc.example target/deploy/slana-keypair.json --max-len 71000
#
# The fee payer and upgrade authority are the Solana CLI defaults (`solana config get`) unless the
# extra args say otherwise (`--keypair`, `--upgrade-authority`). Build first with scripts/build-lean.sh.
# Never use `anchor deploy`: it ships the ~679 KB Anchor reference instead.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for dir in /opt/solana/bin "$HOME/.local/share/solana/install/active_release/bin"; do
  if [[ -d "$dir" && ":$PATH:" != *":$dir:"* ]]; then PATH="$dir:$PATH"; fi
done
export PATH

die() {
  echo "error: $*" >&2
  exit 1
}

[[ $# -ge 2 ]] || die "usage: $0 <cluster-url> <program-keypair> [extra solana program deploy args]"
CLUSTER="$1"
KEYPAIR="$2"
shift 2

SO="$ROOT/target/deploy/slana_lean.so"
[[ -f "$SO" ]] || die "$SO is missing — run scripts/build-lean.sh first"
[[ -f "$KEYPAIR" ]] || die "program keypair $KEYPAIR not found"

# The lean program id: the 32 bytes of `ID` in programs/slana-lean/src/lib.rs, base58-encoded.
LEAN_ID=$(node -e '
const src = require("fs").readFileSync(process.argv[1], "utf8");
const m = src.match(/pub const ID: Address = Address::new_from_array\(\[([\s\S]*?)\]\)/);
if (!m) process.exit(1);
const bytes = m[1].split(",").map((s) => s.trim()).filter(Boolean).map(Number);
if (bytes.length !== 32 || bytes.some((b) => !(b >= 0 && b <= 255))) process.exit(1);
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
let n = bytes.reduce((acc, b) => acc * 256n + BigInt(b), 0n), out = "";
while (n > 0n) { out = A[Number(n % 58n)] + out; n /= 58n; }
for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
console.log(out);
' "$ROOT/programs/slana-lean/src/lib.rs") || die "could not read the program id from programs/slana-lean/src/lib.rs"

ACTUAL=$(solana-keygen pubkey "$KEYPAIR") || die "could not read $KEYPAIR"
if [[ "$ACTUAL" != "$LEAN_ID" ]]; then
  die "$KEYPAIR is $ACTUAL but the lean program id is $LEAN_ID.
       Deploying with it would create a different program. Use the real program keypair."
fi

echo "deploying $SO ($(wc -c <"$SO" | tr -d ' ') bytes) to $LEAN_ID on $CLUSTER"
exec solana program deploy --url "$CLUSTER" "$SO" --program-id "$KEYPAIR" "$@"
