#!/usr/bin/env bash
# Funds a wallet on the local cluster started by scripts/localnet.sh (`pnpm demo:localnet`):
# SOL by airdrop and $SLANA by transfer from the admin (the test mint is capped, so tokens are
# transferred, not minted).
#
#   scripts/localnet-fund.sh <wallet-address> [sol=10] [slana=1000]
#
# Env: ADMIN_KEYPAIR (default ~/.config/solana/id.json), RPC_PORT (default 8899).
# Only SOL by hand:  solana airdrop 10 <wallet-address> --url http://127.0.0.1:8899
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$ROOT/.localnet"
RPC_URL="http://127.0.0.1:${RPC_PORT:-8899}"
ADMIN_KEYPAIR="${ADMIN_KEYPAIR:-$HOME/.config/solana/id.json}"

for dir in /opt/solana/bin "$HOME/.local/share/solana/install/active_release/bin"; do
  if [[ -d "$dir" && ":$PATH:" != *":$dir:"* ]]; then PATH="$dir:$PATH"; fi
done
export PATH

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
[[ $# -ge 1 && $# -le 3 ]] || die "usage: $0 <wallet-address> [sol=10] [slana=1000]"
WALLET="$1"
SOL="${2:-10}"
SLANA="${3:-1000}"
for tool in solana spl-token; do command -v "$tool" >/dev/null || die "$tool not found in PATH"; done
[[ -f "$STATE/server.env" ]] || die "$STATE/server.env is missing: start the cluster first (pnpm demo:localnet or scripts/localnet.sh)"
TOKEN_MINT="$(sed -n 's/^TOKEN_MINT=//p' "$STATE/server.env")"
[[ -n "$TOKEN_MINT" ]] || die "TOKEN_MINT not found in $STATE/server.env"
[[ -f "$ADMIN_KEYPAIR" ]] || die "admin keypair $ADMIN_KEYPAIR not found (set ADMIN_KEYPAIR)"
solana cluster-version --url "$RPC_URL" >/dev/null 2>&1 || die "no validator answers on $RPC_URL: start it with pnpm demo:localnet"

echo "airdropping $SOL SOL to $WALLET"
solana airdrop "$SOL" "$WALLET" --url "$RPC_URL" >/dev/null
echo "sending $SLANA \$SLANA ($TOKEN_MINT) from the admin to $WALLET"
spl-token --url "$RPC_URL" --program-2022 --fee-payer "$ADMIN_KEYPAIR" transfer "$TOKEN_MINT" "$SLANA" "$WALLET" \
  --owner "$ADMIN_KEYPAIR" --fund-recipient --allow-unfunded-recipient >/dev/null
echo "done: $(solana balance "$WALLET" --url "$RPC_URL") and $(spl-token --url "$RPC_URL" --program-2022 balance "$TOKEN_MINT" --owner "$WALLET" 2>/dev/null || echo '?') \$SLANA"
