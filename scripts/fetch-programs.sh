#!/usr/bin/env bash
# Downloads the external on-chain programs the Slana LiteSVM suite (programs/slana-ref/tests, run
# against both slana.so and slana_lean.so) and scripts/localnet.sh load.
# Currently only Metaplex Core (Slana Pass collection and assets).
#   MAINNET_RPC=<url> scripts/fetch-programs.sh
set -euo pipefail

cd "$(dirname "$0")/.."
RPC="${MAINNET_RPC:-https://api.mainnet-beta.solana.com}"
OUT_DIR=target/programs
MPL_CORE_ID=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d

ATTEMPTS="${FETCH_ATTEMPTS:-5}"
# a blocked or offline network must fail, not hang: each attempt is cut off after FETCH_TIMEOUT seconds
TIMEOUT=()
if command -v timeout >/dev/null; then TIMEOUT=(timeout "${FETCH_TIMEOUT:-60}"); fi

mkdir -p "$OUT_DIR"
if [ -s "$OUT_DIR/mpl_core.so" ]; then
  echo "$OUT_DIR/mpl_core.so already exists, skipping"
  exit 0
fi
# public RPCs rate-limit and drop connections: retry with a growing pause
for i in $(seq 1 "$ATTEMPTS"); do
  if "${TIMEOUT[@]+"${TIMEOUT[@]}"}" solana program dump -u "$RPC" "$MPL_CORE_ID" "$OUT_DIR/mpl_core.so.tmp" && [ -s "$OUT_DIR/mpl_core.so.tmp" ]; then
    mv "$OUT_DIR/mpl_core.so.tmp" "$OUT_DIR/mpl_core.so"
    echo "fetched $OUT_DIR/mpl_core.so"
    exit 0
  fi
  rm -f "$OUT_DIR/mpl_core.so.tmp"
  if [ "$i" -lt "$ATTEMPTS" ]; then
    echo "solana program dump failed (attempt $i/$ATTEMPTS); retrying in $((i * 10)) s" >&2
    sleep $((i * 10))
  fi
done
echo "could not fetch Metaplex Core from $RPC after $ATTEMPTS attempts" >&2
exit 1
