#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/data/projects/tam-repo/admin-toolkit"
FE_DIR="$REPO_ROOT/resource/frontend"
LIVE_URL="https://tam-global.fe-aws.dkucloud-dev.com/webapps/admintoolkit/"
TOTAL=30
PASS=0
FAIL=0

for i in $(seq 1 "$TOTAL"); do
  echo ""
  echo "============================================"
  echo "  ITERATION $i / $TOTAL  (pass=$PASS fail=$FAIL)"
  echo "============================================"

  # Step 1: Build + Deploy
  echo "[iter $i] Building and deploying..."
  cd "$REPO_ROOT"
  make deploy COMMIT_MSG="test iteration $i" 2>&1 | tail -5
  echo "[iter $i] Deploy done. Waiting 10s for backend restart..."
  sleep 10

  # Step 2: Run Playwright tests
  echo "[iter $i] Running tests..."
  cd "$FE_DIR"
  if LIVE_URL="$LIVE_URL" npx playwright test tests/loading-states.spec.ts 2>&1 | tee /tmp/loading-test-iter-$i.log | tail -15; then
    PASS=$((PASS + 1))
    echo "[iter $i] PASSED"
  else
    FAIL=$((FAIL + 1))
    echo "[iter $i] FAILED — see /tmp/loading-test-iter-$i.log"
  fi
done

echo ""
echo "============================================"
echo "  FINAL RESULTS: $PASS passed, $FAIL failed out of $TOTAL"
echo "============================================"
