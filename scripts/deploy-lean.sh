#!/usr/bin/env bash
# Deploys (or upgrades) the lean program target/deploy/slana_lean.so — the only build that is ever
# deployed — at the Slana program id. Refuses to run when the program keypair is not the lean
# program's `ID` (programs/slana-lean/src/lib.rs, pinned to the reference's `declare_id!` by
# `cargo test -p slana-lean`): deploying with another keypair would create a different program.
#
#   scripts/deploy-lean.sh <cluster-url> <program-keypair> [--keep-authority] [extra `solana program deploy` args]
#   e.g. scripts/deploy-lean.sh devnet target/deploy/slana-keypair.json --keypair keys/deployer.json
#        scripts/deploy-lean.sh https://my-rpc.example target/deploy/slana-keypair.json --max-len 71000
#
# Options
#   --keep-authority   leave the upgrade authority as the deployer (localnet and tests only)
#   -h, --help         print this help
#
# Fee payer and upgrade authority are the Solana CLI defaults (`solana config get`) unless the
# extra args say otherwise (`--keypair`, `--upgrade-authority`). After a successful deploy the
# upgrade authority is moved to SLANA_ADMIN (scripts/admin.env) with
#   solana program set-upgrade-authority <ID> --new-upgrade-authority <ADMIN> \
#     --skip-new-upgrade-authority-signer-check
# unless it already is the admin or --keep-authority is given. The before and after states are
# printed. The program stays upgradeable: this script never passes --final.
# Test-only escape hatch: SLANA_ALLOW_OTHER_PROGRAM_ID=1 skips the program-id check, to rehearse on a
# throwaway program id (never set it for a real deploy).
# Build first with scripts/build-lean.sh. Never use `anchor deploy`: it ships the ~679 KB Anchor
# reference instead.
set -euo pipefail

# shellcheck source=scripts/lib-lean.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-lean.sh"

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }

KEEP_AUTHORITY=0
POS=()
EXTRA=()
for arg in "$@"; do
  case "$arg" in
    -h | --help)
      usage
      exit 0
      ;;
    --keep-authority) KEEP_AUTHORITY=1 ;;
    --final) die "--final is refused: the Slana program must stay upgradeable and closable" ;;
    *)
      if [[ ${#POS[@]} -lt 2 ]]; then POS+=("$arg"); else EXTRA+=("$arg"); fi
      ;;
  esac
done

[[ ${#POS[@]} -eq 2 ]] || die "usage: $0 <cluster-url> <program-keypair> [--keep-authority] [extra solana program deploy args] (see --help)"
CLUSTER="${POS[0]}"
KEYPAIR="${POS[1]}"

SO="$ROOT/target/deploy/slana_lean.so"
[[ -f "$SO" ]] || die "$SO is missing — run scripts/build-lean.sh first"
[[ -f "$KEYPAIR" ]] || die "program keypair $KEYPAIR not found"

LEAN_ID=$(lean_program_id) || die "could not read the program id from programs/slana-lean/src/lib.rs"
ACTUAL=$(solana-keygen pubkey "$KEYPAIR") || die "could not read $KEYPAIR"
if [[ "$ACTUAL" != "$LEAN_ID" && -z "${SLANA_ALLOW_OTHER_PROGRAM_ID:-}" ]]; then
  die "$KEYPAIR is $ACTUAL but the lean program id is $LEAN_ID.
       Deploying with it would create a different program. Use the real program keypair."
fi
PROGRAM_ID="$ACTUAL"

# The signer of the current upgrade authority: --upgrade-authority, else --keypair, else the CLI default.
AUTH_SIGNER=()
for ((i = 0; i < ${#EXTRA[@]}; i++)); do
  case "${EXTRA[i]}" in
    --upgrade-authority) AUTH_SIGNER=(--upgrade-authority "${EXTRA[i + 1]:-}") ;;
    -k | --keypair) [[ ${#AUTH_SIGNER[@]} -eq 0 ]] && AUTH_SIGNER=(--keypair "${EXTRA[i + 1]:-}") ;;
  esac
done

BEFORE=$(program_field "$CLUSTER" "$PROGRAM_ID" authority 2>/dev/null || echo "(not deployed)")
echo "upgrade authority before: $BEFORE"
echo "deploying $SO ($(wc -c <"$SO" | tr -d ' ') bytes) to $PROGRAM_ID on $CLUSTER"
solana program deploy --url "$CLUSTER" "$SO" --program-id "$KEYPAIR" ${EXTRA[@]+"${EXTRA[@]}"}

CURRENT=$(program_field "$CLUSTER" "$PROGRAM_ID" authority) || die "deployed, but could not read the program back"
if [[ "$CURRENT" == "$SLANA_ADMIN" ]]; then
  echo "upgrade authority is already the admin ($SLANA_ADMIN): nothing to change"
elif [[ "$KEEP_AUTHORITY" -eq 1 ]]; then
  echo "upgrade authority left as $CURRENT (--keep-authority); the admin is $SLANA_ADMIN"
else
  echo "moving the upgrade authority $CURRENT -> $SLANA_ADMIN"
  solana program set-upgrade-authority "$PROGRAM_ID" --url "$CLUSTER" \
    --new-upgrade-authority "$SLANA_ADMIN" --skip-new-upgrade-authority-signer-check \
    ${AUTH_SIGNER[@]+"${AUTH_SIGNER[@]}"}
  CURRENT=$(program_field "$CLUSTER" "$PROGRAM_ID" authority)
  [[ "$CURRENT" == "$SLANA_ADMIN" ]] || die "the upgrade authority is $CURRENT, expected $SLANA_ADMIN"
fi
echo "upgrade authority before: $BEFORE"
echo "upgrade authority after:  $CURRENT"
