#!/usr/bin/env bash
# Proves the E2E suite can fail: mutates invoice price-tolerance matching,
# expects the P2P happy-path spec to go red, then restores and rebuilds.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="src/domain/matching.ts"
if [ -n "$(git status --porcelain -- "$TARGET")" ]; then
  echo "ERROR: $TARGET has uncommitted changes" >&2
  exit 1
fi

restore() {
  git checkout -- "$TARGET"
  echo "restored $TARGET — rebuilding clean bundle…"
  npm run build >/dev/null 2>&1
}
trap restore EXIT

cp "$TARGET" /tmp/matching.ts.bak
perl -pi -e 's/return Math\.abs\(invoicePrice - poPrice\) <= tolerance;/return false;/' "$TARGET"
if ! grep -q "return false;" "$TARGET"; then
  echo "ERROR: mutation did not apply" >&2
  exit 1
fi
echo "mutation applied: priceWithinTolerance always returns false"

npm run build >/dev/null 2>&1
set +e
npx playwright test tests/e2e/p2p.spec.ts --grep "rita requests" 2>/dev/null
STATUS=$?
set -e

if [ "$STATUS" -eq 0 ]; then
  echo "MUTATION SURVIVED — E2E suite failed to detect the regression" >&2
  rm -f /tmp/matching.ts.bak
  exit 1
fi
echo "suite went RED under mutation (exit $STATUS) — E2E can fail ✓"
rm -f /tmp/matching.ts.bak
