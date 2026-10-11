#!/usr/bin/env bash
# Local Solana cluster for Solagel: solana-test-validator with the program preloaded
# (upgrade authority = your local admin key), Config initialized, default arenas created.
#
#   scripts/localnet.sh          (re)start from a fresh ledger and print the game-server env
#   scripts/localnet.sh --stop   stop the validator started by this script
#
# State lives in .localnet/ (server + treasury keypairs, ledger, logs, server.env).
# Requires `anchor build` output (target/deploy) and the Agave CLI tools.
# Env: ADMIN_KEYPAIR (default ~/.config/solana/id.json), RPC_PORT (default 8899),
#      PROGRAM_ID (defaults to the SDK IDL address; must match it).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$ROOT/.localnet"
LEDGER="$STATE/test-ledger"
PID_FILE="$STATE/validator.pid"
RPC_PORT="${RPC_PORT:-8899}"
RPC_URL="http://127.0.0.1:$RPC_PORT"
PROGRAM_SO="$ROOT/target/deploy/solagel.so"
ADMIN_KEYPAIR="${ADMIN_KEYPAIR:-$HOME/.config/solana/id.json}"
SERVER_KEYPAIR="$STATE/server.json"
TREASURY_KEYPAIR="$STATE/treasury.json"

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

for tool in solana-test-validator solana solana-keygen curl pnpm; do
  command -v "$tool" >/dev/null || die "$tool not found in PATH"
done
[[ -f "$PROGRAM_SO" ]] || die "$PROGRAM_SO is missing — run \`anchor build\` at the repo root first"
IDL_ID="$(sed -n 's/^ *"address": *"\([1-9A-HJ-NP-Za-km-z]*\)".*/\1/p' "$ROOT/packages/sdk/src/idl/solagel.json" | head -n 1)"
[[ -n "$IDL_ID" ]] || die "the SDK IDL has no program address — build and sync the IDL first"
# Local genesis preloads a program at its declared public address. It does not sign a
# deployment and needs no program keypair, which a fresh clone cannot reproduce.
PROGRAM_ID="${PROGRAM_ID:-$IDL_ID}"
if [[ "$IDL_ID" != "$PROGRAM_ID" ]]; then
  die "PROGRAM_ID is $PROGRAM_ID but the SDK IDL is for $IDL_ID — rebuild and sync the IDL for the intended local program"
fi

mkdir -p "$STATE"
if [[ ! -f "$ADMIN_KEYPAIR" ]]; then
  say "creating admin keypair $ADMIN_KEYPAIR"
  mkdir -p "$(dirname "$ADMIN_KEYPAIR")"
  solana-keygen new --no-bip39-passphrase --silent --outfile "$ADMIN_KEYPAIR"
fi
if [[ ! -f "$SERVER_KEYPAIR" ]]; then solana-keygen new --no-bip39-passphrase --silent --outfile "$SERVER_KEYPAIR"; fi
if [[ ! -f "$TREASURY_KEYPAIR" ]]; then solana-keygen new --no-bip39-passphrase --silent --outfile "$TREASURY_KEYPAIR"; fi
ADMIN="$(solana-keygen pubkey "$ADMIN_KEYPAIR")"
SERVER="$(solana-keygen pubkey "$SERVER_KEYPAIR")"
TREASURY="$(solana-keygen pubkey "$TREASURY_KEYPAIR")"

stop_validator
if rpc_healthy; then die "another validator already answers on $RPC_URL — stop it first"; fi

say "starting solana-test-validator (program $PROGRAM_ID, upgrade authority $ADMIN)"
# --quiet writes the validator log into the ledger; .localnet/validator.log links to it.
nohup solana-test-validator --reset --quiet \
  --ledger "$LEDGER" \
  --rpc-port "$RPC_PORT" \
  --upgradeable-program "$PROGRAM_ID" "$PROGRAM_SO" "$ADMIN_KEYPAIR" \
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
say "airdropping SOL: admin $ADMIN (100), server $SERVER (10), treasury $TREASURY (1)"
airdrop 100 "$ADMIN"
airdrop 10 "$SERVER"
airdrop 1 "$TREASURY"

admin() {
  (cd "$ROOT" && pnpm --silent -F @solagel/sdk admin --url "$RPC_URL" --keypair "$ADMIN_KEYPAIR" --program "$PROGRAM_ID" --cluster localnet "$@")
}
say "initializing the program"
admin init --server "$SERVER" --treasury "$TREASURY"
say "creating the default arenas"
admin create-arena --defaults

cat >"$STATE/server.env" <<EOF
SOLANA_CLUSTER=localnet
SOLANA_RPC_URL=$RPC_URL
PROGRAM_ID=$PROGRAM_ID
SERVER_KEYPAIR=$SERVER_KEYPAIR
EOF

echo
say "localnet ready ✓   status: pnpm admin status · stop: scripts/localnet.sh --stop"
echo "Game server env (also in .localnet/server.env):"
echo
echo "  SOLANA_CLUSTER=localnet SOLANA_RPC_URL=$RPC_URL PROGRAM_ID=$PROGRAM_ID SERVER_KEYPAIR=$SERVER_KEYPAIR"
echo
echo "e.g.  cd apps/server && env \$(cat ../../.localnet/server.env | xargs) npx tsx src/index.ts"
