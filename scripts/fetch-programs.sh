#!/usr/bin/env bash
# Downloads the external on-chain programs the Slana program tests load into LiteSVM.
# Currently only Metaplex Core (Slana Pass collection and assets).
#   MAINNET_RPC=<url> scripts/fetch-programs.sh
set -euo pipefail

cd "$(dirname "$0")/.."
RPC="${MAINNET_RPC:-https://api.mainnet-beta.solana.com}"
OUT_DIR=target/programs
MPL_CORE_ID=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d

mkdir -p "$OUT_DIR"
if [ -f "$OUT_DIR/mpl_core.so" ]; then
  echo "$OUT_DIR/mpl_core.so already exists, skipping"
else
  solana program dump -u "$RPC" "$MPL_CORE_ID" "$OUT_DIR/mpl_core.so"
fi
