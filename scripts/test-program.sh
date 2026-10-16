#!/usr/bin/env bash
# Builds both program builds and runs the LiteSVM suite (programs/slana-ref/tests) against each:
#   SLANA_IMPL=ref   → target/deploy/slana.so      (Anchor reference, never deployed)
#   SLANA_IMPL=lean  → target/deploy/slana_lean.so (Pinocchio, the deployed program)
# Both are loaded at the same program id; instructions and accounts always use the reference
# crate's Anchor types. Also runs clippy on the lean crate (warnings and unchecked arithmetic are
# errors), the lean crate's host tests (discriminators vs reference/IDL) and the size gate
# (tests/size.rs). Runs every suite, then fails if any failed.
#
#   scripts/test-program.sh [ref|lean|both]   (default both)
#   SKIP_BUILD=1 scripts/test-program.sh      reuse existing target/deploy/*.so
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
for dir in /opt/solana/bin "$HOME/.local/share/solana/install/active_release/bin"; do
  if [[ -d "$dir" && ":$PATH:" != *":$dir:"* ]]; then PATH="$dir:$PATH"; fi
done
export PATH

WHICH="${1:-both}"
case "$WHICH" in ref | lean | both) ;; *)
  echo "usage: $0 [ref|lean|both]" >&2
  exit 2
  ;;
esac

if [[ -z "${SKIP_BUILD:-}" ]]; then
  anchor build --ignore-keys || exit 1
  scripts/build-lean.sh || exit 1
fi

status=0
echo "=== clippy (slana-lean, -D warnings -D clippy::arithmetic_side_effects) ==="
cargo clippy -p slana-lean --lib -- -D warnings -D clippy::arithmetic_side_effects || status=1
cargo test -p slana-lean || status=1
for impl in ref lean; do
  if [[ "$WHICH" == both || "$WHICH" == "$impl" ]]; then
    echo "=== LiteSVM suite, SLANA_IMPL=$impl ==="
    SLANA_IMPL=$impl cargo test -p slana-ref --no-fail-fast || status=1
  fi
done
exit $status
