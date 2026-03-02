#!/usr/bin/env bash
set -euo pipefail

KEY_FILE="/data/keys/dss_api_key_prod"
URL_FILE="/data/keys/dss_url_prod"

PROJECT_KEY="DIAG_PARSER_BRANCH1"
WEBAPP_ID="nOQzJAF"
BASE_ENDPOINT="/public/api/projects/${PROJECT_KEY}/webapps/${WEBAPP_ID}/backend"

DSS_URL="$(cat "${URL_FILE}")"
API_KEY="$(cat "${KEY_FILE}")"

api_call() {
  local method="$1" path="$2"
  curl -sS -H "Authorization: Bearer ${API_KEY}" \
    -X "$method" "${DSS_URL}${BASE_ENDPOINT}${path}"
}

echo "[1/4] Waiting 20s for plugin reload to fully complete..."
sleep 20

echo "[2/4] Restarting webapp backend..."
RESTART_RESP=$(api_call PUT "/actions/restart")
echo "  Restart response: ${RESTART_RESP}"

echo "[3/4] Waiting 15s for backend to start..."
sleep 15

echo "[4/4] Checking backend state..."
STATE=$(api_call GET "/state")
# Extract key fields
ALIVE=$(echo "$STATE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('futureInfo',{}).get('alive','unknown'))" 2>/dev/null || echo "parse_error")
CRASH=$(echo "$STATE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('futureInfo',{}).get('payload',{}).get('extras',{}).get('crashCount','unknown'))" 2>/dev/null || echo "parse_error")
LOGS=$(echo "$STATE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
lines=d.get('currentLogTail',{}).get('lines',[])
for l in lines[-10:]: print(l)
" 2>/dev/null || echo "no logs")

echo "  alive=${ALIVE} crashCount=${CRASH}"
echo "  Last logs:"
echo "$LOGS"

if [ "$ALIVE" = "True" ] && [ "$CRASH" = "0" ]; then
  echo "[SUCCESS] Backend is running!"
else
  echo "[WARNING] Backend may not be healthy (alive=${ALIVE}, crashCount=${CRASH})"
fi
