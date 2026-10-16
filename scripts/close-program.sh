#!/usr/bin/env bash
# EMERGENCY / END OF LIFE: permanently closes the deployed Slana program and returns its
# ProgramData rent to the admin.
#
#   scripts/close-program.sh <cluster-url> <admin-keypair> [--force] [--program <id>]
#   e.g. scripts/close-program.sh mainnet-beta ~/keys/admin.json
#
#   <admin-keypair>  the current upgrade authority (the admin wallet, SLANA_ADMIN in scripts/admin.env).
#                    It signs the close and receives the reclaimed SOL. A hardware wallet URL
#                    (usb://ledger) also works for the close itself, but the state report
#                    (`pnpm admin status`) needs a keypair file, so with usb:// the report is skipped.
#   --force          skip the typed confirmation (for tests and scripted use)
#   --program <id>   program to close (default: the lean program id; for rehearsals on a throwaway id)
#   -h, --help       print this help
#
# Before closing it prints the on-chain state (`pnpm admin status`: paused flag, token mint, arenas'
# open sessions and vaults) and the upgrade authority.
#
# WARNING: once the program is closed, every token left in the program-owned arena vaults is
# PERMANENTLY inaccessible, and the program id can never be deployed again. Pause
# (`pnpm admin update-config --paused true`) and wind down first unless it is a real emergency
# (docs/OPERATIONS.md, "Emergency stop / close").
set -euo pipefail

# shellcheck source=scripts/lib-lean.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-lean.sh"

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }

FORCE=0
PROGRAM_ID=""
POS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --force) FORCE=1 ;;
    --program)
      [[ $# -ge 2 ]] || die "--program needs a value"
      PROGRAM_ID="$2"
      shift
      ;;
    -*) die "unknown option: $1 (see --help)" ;;
    *) POS+=("$1") ;;
  esac
  shift
done
[[ ${#POS[@]} -eq 2 ]] || die "usage: $0 <cluster-url> <admin-keypair> [--force] [--program <id>] (see --help)"
CLUSTER="${POS[0]}"
ADMIN_KP="${POS[1]}"

[[ -n "$PROGRAM_ID" ]] || PROGRAM_ID=$(lean_program_id) || die "could not read the program id from programs/slana-lean/src/lib.rs"
[[ "$ADMIN_KP" == usb://* || -f "$ADMIN_KP" ]] || die "admin keypair $ADMIN_KP not found"
ADMIN=$(solana-keygen pubkey "$ADMIN_KP") || die "could not read the public key of $ADMIN_KP"

AUTHORITY=$(program_field "$CLUSTER" "$PROGRAM_ID" authority) || die "program $PROGRAM_ID not found on $CLUSTER (already closed?)"
[[ "$AUTHORITY" != "none" ]] || die "program $PROGRAM_ID is immutable (no upgrade authority): it cannot be closed"
[[ "$AUTHORITY" == "$ADMIN" ]] || die "upgrade authority is $AUTHORITY but $ADMIN_KP is $ADMIN"
if [[ "$ADMIN" != "$SLANA_ADMIN" ]]; then
  echo "note: $ADMIN is not the project admin wallet ($SLANA_ADMIN in scripts/admin.env)" >&2
fi

echo "=== program $PROGRAM_ID on $CLUSTER ==="
solana program show "$PROGRAM_ID" --url "$CLUSTER"
PD=$(program_field "$CLUSTER" "$PROGRAM_ID" programdataAddress || true)

echo
echo "=== on-chain game state (pnpm admin status) ==="
if [[ "$ADMIN_KP" == usb://* ]]; then
  echo "(skipped: the admin CLI reads keypair files only)"
elif ! (cd "$ROOT" && pnpm --silent admin status --url "$CLUSTER" --program "$PROGRAM_ID" --keypair "$(cd "$(dirname "$ADMIN_KP")" && pwd)/$(basename "$ADMIN_KP")"); then
  echo "(could not read the state: the program may not be initialized, or pnpm/node is unavailable)" >&2
fi

BEFORE_BAL=$(solana balance "$ADMIN" --url "$CLUSTER" --lamports 2>/dev/null | awk '{print $1}' || echo 0)

printf '\n\033[1;31m'
cat <<EOW
############################################################################
# WARNING: CLOSING THE PROGRAM IS IRREVERSIBLE.
# Every token still in a program-owned arena vault becomes PERMANENTLY
# INACCESSIBLE. Open sessions can no longer settle or refund. The program id
# $PROGRAM_ID can never be reused.
############################################################################
EOW
printf '\033[0m\n'

if [[ "$FORCE" -ne 1 ]]; then
  read -r -p "Type the program id ($PROGRAM_ID) to close it: " TYPED
  [[ "$TYPED" == "$PROGRAM_ID" ]] || die "confirmation did not match: nothing was closed"
fi

solana program close "$PROGRAM_ID" --bypass-warning --recipient "$ADMIN" \
  --url "$CLUSTER" --keypair "$ADMIN_KP"

if solana program show "$PROGRAM_ID" --url "$CLUSTER" >/dev/null 2>&1; then
  die "program $PROGRAM_ID is still present on $CLUSTER"
fi
AFTER_BAL=$(solana balance "$ADMIN" --url "$CLUSTER" --lamports | awk '{print $1}')
echo "program $PROGRAM_ID is closed (ProgramData ${PD:-?})."
node -e '
const d = BigInt(process.argv[2]) - BigInt(process.argv[1]);
console.log(`admin balance change: ${d} lamports (${Number(d) / 1e9} SOL, net of the transaction fee)`);
' "$BEFORE_BAL" "$AFTER_BAL"
