#!/usr/bin/env bash
# Local Solana cluster for Slana v2: solana-test-validator with the Slana program (upgrade
# authority = your local admin key) and Metaplex Core preloaded, a Token-2022 test mint
# ($SLANA: 6 decimals, no freeze authority, 1,000,000,000 tokens to the admin, then minting
# disabled so the supply only shrinks by burns), Config initialized, the Slana Pass collection,
# seed commitment and open mint, and the default arenas.
#
#   scripts/localnet.sh          (re)start from a fresh ledger and print the game-server env
#   scripts/localnet.sh --stop   stop the validator started by this script
#
# State lives in .localnet/ (server + token-mint keypairs, the secret Pass seed, ledger, logs,
# server.env). Never commit it. Requires `anchor build` output (target/deploy), the Agave CLI
# tools (solana-test-validator, solana, solana-keygen, spl-token) and target/programs/mpl_core.so
# (scripts/fetch-programs.sh downloads it when missing).
# Env: ADMIN_KEYPAIR (default ~/.config/solana/id.json), RPC_PORT (default 8899),
#      GAME_URL (game server base URL for the Pass metadata, default http://127.0.0.1:8787).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$ROOT/.localnet"
LEDGER="$STATE/test-ledger"
PID_FILE="$STATE/validator.pid"
RPC_PORT="${RPC_PORT:-8899}"
RPC_URL="http://127.0.0.1:$RPC_PORT"
PROGRAM_SO="$ROOT/target/deploy/slana.so"
PROGRAM_KEYPAIR="$ROOT/target/deploy/slana-keypair.json"
ADMIN_KEYPAIR="${ADMIN_KEYPAIR:-$HOME/.config/solana/id.json}"
SERVER_KEYPAIR="$STATE/server.json"
MINT_KEYPAIR="$STATE/token-mint.json"
SEED_FILE="$STATE/pass-seed.json"
MPL_CORE_SO="$ROOT/target/programs/mpl_core.so"
MPL_CORE_ID=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
GAME_URL="${GAME_URL:-http://127.0.0.1:8787}"
TOKEN_SUPPLY=1000000000

# The Agave tools are often installed outside PATH.
for dir in /opt/solana/bin "$HOME/.local/share/solana/install/active_release/bin"; do
  if [[ -d "$dir" && ":$PATH:" != *":$dir:"* ]]; then PATH="$dir:$PATH"; fi
done
export PATH

say() { printf '\033[1;35m▸\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31m✗\033[0m %s\n' "$*" >&2
  exit 1
}

rpc_healthy() {
  curl -s -m 2 -X POST -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC_URL" 2>/dev/null | grep -q '"ok"'
}

stop_validator() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      say "stopping validator (pid $pid)"
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 40); do
        if ! kill -0 "$pid" 2>/dev/null; then break; fi
        sleep 0.25
      done
      if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null || true; fi
    fi
    rm -f "$PID_FILE"
  fi
}

if [[ "${1:-}" == "--stop" ]]; then
  stop_validator
  if rpc_healthy; then echo "note: something else still answers on $RPC_URL"; fi
  say "localnet stopped"
  exit 0
fi
if [[ $# -gt 0 ]]; then die "usage: $0 [--stop]"; fi

for tool in solana-test-validator solana solana-keygen spl-token curl pnpm; do
  command -v "$tool" >/dev/null || die "$tool not found in PATH"
done
[[ -f "$PROGRAM_SO" ]] || die "$PROGRAM_SO is missing — run \`anchor build\` at the repo root first"
[[ -f "$PROGRAM_KEYPAIR" ]] || die "$PROGRAM_KEYPAIR is missing — run \`anchor build\` first"
if [[ ! -f "$MPL_CORE_SO" ]]; then
  say "Metaplex Core is missing — running scripts/fetch-programs.sh"
  "$ROOT/scripts/fetch-programs.sh" || die "could not download Metaplex Core (set MAINNET_RPC, or copy mpl_core.so to $MPL_CORE_SO)"
fi

PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
IDL_ID="$(sed -n 's/^ *"address": *"\([1-9A-HJ-NP-Za-km-z]*\)".*/\1/p' "$ROOT/packages/sdk/src/idl/slana.json" | head -n 1)"
if [[ -n "$IDL_ID" && "$IDL_ID" != "$PROGRAM_ID" ]]; then
  die "program keypair is $PROGRAM_ID but the SDK IDL is for $IDL_ID — run \`anchor keys sync && anchor build && pnpm -F @slana/sdk sync-idl\`"
fi

mkdir -p "$STATE"
chmod 700 "$STATE"
if [[ ! -f "$ADMIN_KEYPAIR" ]]; then
  say "creating admin keypair $ADMIN_KEYPAIR"
  mkdir -p "$(dirname "$ADMIN_KEYPAIR")"
  solana-keygen new --no-bip39-passphrase --silent --outfile "$ADMIN_KEYPAIR"
fi
if [[ ! -f "$SERVER_KEYPAIR" ]]; then solana-keygen new --no-bip39-passphrase --silent --outfile "$SERVER_KEYPAIR"; fi

stop_validator
if rpc_healthy; then die "another validator already answers on $RPC_URL — stop it first"; fi

# A fresh ledger gets a fresh token mint and a fresh Pass seed (v1 left a treasury keypair here).
rm -f "$MINT_KEYPAIR" "$SEED_FILE" "$STATE/treasury.json"
solana-keygen new --no-bip39-passphrase --silent --outfile "$MINT_KEYPAIR"
ADMIN="$(solana-keygen pubkey "$ADMIN_KEYPAIR")"
SERVER="$(solana-keygen pubkey "$SERVER_KEYPAIR")"
TOKEN_MINT="$(solana-keygen pubkey "$MINT_KEYPAIR")"

say "starting solana-test-validator (program $PROGRAM_ID, upgrade authority $ADMIN; Metaplex Core)"
# --quiet writes the validator log into the ledger; .localnet/validator.log links to it.
nohup solana-test-validator --reset --quiet \
  --ledger "$LEDGER" \
  --rpc-port "$RPC_PORT" \
  --upgradeable-program "$PROGRAM_ID" "$PROGRAM_SO" "$ADMIN_KEYPAIR" \
  --bpf-program "$MPL_CORE_ID" "$MPL_CORE_SO" \
  >"$STATE/validator.stdout.log" 2>&1 &
echo $! >"$PID_FILE"
ln -sfn "test-ledger/validator.log" "$STATE/validator.log"

for _ in $(seq 1 120); do
  if rpc_healthy; then break; fi
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    tail -n 20 "$STATE/validator.stdout.log" >&2 || true
    die "the validator exited — see .localnet/validator.stdout.log and .localnet/validator.log"
  fi
  sleep 0.5
done
rpc_healthy || die "the validator did not become healthy within 60 s — see .localnet/validator.log"
for _ in $(seq 1 60); do
  if solana program show "$PROGRAM_ID" --url "$RPC_URL" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

airdrop() {
  for _ in $(seq 1 10); do
    if solana airdrop "$1" "$2" --url "$RPC_URL" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  die "airdrop of $1 SOL to $2 failed"
}
say "airdropping SOL: admin $ADMIN (100), server $SERVER (10)"
airdrop 100 "$ADMIN"
airdrop 10 "$SERVER"

spl() { spl-token --url "$RPC_URL" --fee-payer "$ADMIN_KEYPAIR" --program-2022 "$@"; }
say "creating the Token-2022 test mint $TOKEN_MINT (6 decimals, no freeze authority)"
spl create-token --decimals 6 --mint-authority "$ADMIN" "$MINT_KEYPAIR" >/dev/null
spl create-account "$TOKEN_MINT" --owner "$ADMIN" >/dev/null
spl mint "$TOKEN_MINT" "$TOKEN_SUPPLY" --mint-authority "$ADMIN_KEYPAIR" >/dev/null
spl authorize "$TOKEN_MINT" mint --disable --authority "$ADMIN_KEYPAIR" >/dev/null
say "minted $TOKEN_SUPPLY tokens to the admin; minting disabled (the supply only shrinks by burns)"

admin() {
  (cd "$ROOT" && pnpm --silent -F @slana/sdk admin --url "$RPC_URL" --keypair "$ADMIN_KEYPAIR" --program "$PROGRAM_ID" --cluster localnet "$@")
}
say "initializing the program"
admin init --mint "$TOKEN_MINT" --server "$SERVER"
say "creating the Slana Pass collection"
COLLECTION_OUT="$(admin create-collection --name "Slana Pass" --uri "$GAME_URL/pass/collection.json" --royalty-bps 500 --royalty-to "$ADMIN")"
echo "$COLLECTION_OUT"
COLLECTION="$(printf '%s\n' "$COLLECTION_OUT" | sed -n 's/^ *collection \([1-9A-HJ-NP-Za-km-z]\{32,44\}\)$/\1/p' | head -n 1)"
[[ -n "$COLLECTION" ]] || die "create-collection printed no collection address"
admin set-pass-collection --collection "$COLLECTION"
say "committing the Pass seed ($SEED_FILE — secret, never commit it)"
admin pass-seed --new --seed-file "$SEED_FILE"
admin set-seed-hash --seed-file "$SEED_FILE"
say "opening the Pass mint"
admin open-mint --base-uri "$GAME_URL/pass/"
say "creating the default arenas"
admin create-arena --defaults

cat >"$STATE/server.env" <<ENV
SOLANA_CLUSTER=localnet
SOLANA_RPC_URL=$RPC_URL
PROGRAM_ID=$PROGRAM_ID
SERVER_KEYPAIR=$SERVER_KEYPAIR
TOKEN_MINT=$TOKEN_MINT
PUBLIC_URL=$GAME_URL
ENV

echo
say "localnet ready ✓   status: pnpm admin status · stop: scripts/localnet.sh --stop"
echo "Game server env (also in .localnet/server.env):"
echo
echo "  SOLANA_CLUSTER=localnet SOLANA_RPC_URL=$RPC_URL PROGRAM_ID=$PROGRAM_ID SERVER_KEYPAIR=$SERVER_KEYPAIR"
echo "  TOKEN_MINT=$TOKEN_MINT PUBLIC_URL=$GAME_URL"
echo
echo "The admin ($ADMIN) holds the $TOKEN_SUPPLY test tokens. Pass seed: $SEED_FILE"
echo "(after the mint ends: pnpm admin reveal --seed-file $SEED_FILE)."
echo
echo "e.g.  cd apps/server && env \$(cat ../../.localnet/server.env | xargs) npx tsx src/index.ts"
echo "      pnpm -F @slana/server e2e        (needs STALE_SESSION_AFTER_S=5 on the server)"
