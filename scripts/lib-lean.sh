# Shared helpers for scripts/deploy-lean.sh and scripts/close-program.sh. Source it; do not run it.
# shellcheck shell=bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The Agave tools are often installed outside PATH.
for dir in /opt/solana/bin "$HOME/.local/share/solana/install/active_release/bin"; do
  if [[ -d "$dir" && ":$PATH:" != *":$dir:"* ]]; then PATH="$dir:$PATH"; fi
done
export PATH

# SLANA_ADMIN: the admin wallet (public key).
# shellcheck source=scripts/admin.env
source "$ROOT/scripts/admin.env"
[[ -n "${SLANA_ADMIN:-}" ]] || {
  echo "error: SLANA_ADMIN is not set in scripts/admin.env" >&2
  exit 1
}

# Test-only: SLANA_ADMIN_TEST_OVERRIDE=<pubkey> rehearses the admin hand-over with a throwaway admin.
if [[ -n "${SLANA_ADMIN_TEST_OVERRIDE:-}" ]]; then
  echo "note: using the TEST admin $SLANA_ADMIN_TEST_OVERRIDE instead of $SLANA_ADMIN" >&2
  SLANA_ADMIN="$SLANA_ADMIN_TEST_OVERRIDE"
fi

die() {
  echo "error: $*" >&2
  exit 1
}

# The lean program id: the 32 bytes of `ID` in programs/slana-lean/src/lib.rs, base58-encoded.
lean_program_id() {
  node -e '
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
' "$ROOT/programs/slana-lean/src/lib.rs"
}

# program_field <url> <program-id> <json-field>: a field of `solana program show --output json`
# (authority, programId, programdataAddress, lamports, ...). Prints nothing and returns 1 when the
# program does not exist.
program_field() {
  local json
  json=$(solana program show "$2" --url "$1" --output json 2>/dev/null) || return 1
  node -e '
const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
const v = j[process.argv[1]];
console.log(v === null || v === undefined ? "none" : String(v));
' "$3" <<<"$json"
}
