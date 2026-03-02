#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# sudo-wrapper diagnostics (Makefile-aware)
#
# Run as root from repo root (recommended):
#   sudo bash sudo_diag_tests.sh
#
# It will:
# - Read Makefile to detect SECURE_PLUGIN_WRAPPER / SECURE_RESTART_WRAPPER
# - Inspect wrapper scripts to show WEBAPP_ID / ENDPOINT
# - Validate sudoers + perms
# - Run sudo -l and sudo -n tests as claude
# =============================================================================

CLAUDE_USER="${CLAUDE_USER:-claude}"
MAKEFILE="${MAKEFILE:-./Makefile}"

# Defaults if Makefile parsing fails
DEFAULT_PLUGIN_WRAPPER="/data/dss-secure-actions/bin/dss_plugin_update_diag-parser-live"
DEFAULT_RESTART_WRAPPER="/data/dss-secure-actions/bin/dss_webapp_restart_DIAG_PARSER_BRANCH1_nOQzJAF_liveparser"
SUDOERS_DROPIN="${SUDOERS_DROPIN:-/etc/sudoers.d/claude-dss-actions}"

echo "=== Context ==="
echo "Date: $(date -Is)"
echo "Host: $(hostname)"
echo "User: $(whoami)"
echo "PWD : $(pwd)"
echo

need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "MISSING: $1"; exit 1; }; }
for c in visudo sudo stat ls id awk sed grep; do need_cmd "$c"; done

echo "=== Check: user exists (${CLAUDE_USER}) ==="
id -u "${CLAUDE_USER}" >/dev/null 2>&1 || { echo "FAIL: user ${CLAUDE_USER} does not exist"; exit 2; }
echo "OK: ${CLAUDE_USER} exists (uid=$(id -u "${CLAUDE_USER}"))"
echo

echo "=== Preflight: detect wrapper paths from Makefile (if present) ==="
PLUGIN_WRAPPER="${DEFAULT_PLUGIN_WRAPPER}"
RESTART_WRAPPER="${DEFAULT_RESTART_WRAPPER}"

if [[ -f "${MAKEFILE}" ]]; then
  echo "Makefile: ${MAKEFILE} (found)"
  # Extract the RHS of lines like: SECURE_PLUGIN_WRAPPER ?= /path
  mf_plugin="$(awk -F':?= ' '/^[[:space:]]*SECURE_PLUGIN_WRAPPER[[:space:]]*[?]*=/{print $2; exit}' "${MAKEFILE}" 2>/dev/null || true)"
  mf_restart="$(awk -F':?= ' '/^[[:space:]]*SECURE_RESTART_WRAPPER[[:space:]]*[?]*=/{print $2; exit}' "${MAKEFILE}" 2>/dev/null || true)"

  [[ -n "${mf_plugin}" ]] && PLUGIN_WRAPPER="${mf_plugin}"
  [[ -n "${mf_restart}" ]] && RESTART_WRAPPER="${mf_restart}"

  echo "Detected SECURE_PLUGIN_WRAPPER: ${PLUGIN_WRAPPER}"
  echo "Detected SECURE_RESTART_WRAPPER: ${RESTART_WRAPPER}"
else
  echo "Makefile: ${MAKEFILE} (NOT found) â using defaults"
  echo "Default SECURE_PLUGIN_WRAPPER: ${PLUGIN_WRAPPER}"
  echo "Default SECURE_RESTART_WRAPPER: ${RESTART_WRAPPER}"
fi
echo

echo "=== Preflight: wrapper existence + what they target ==="
inspect_wrapper() {
  local f="$1"
  echo "--- $f ---"
  if [[ ! -f "$f" ]]; then
    echo "MISSING"
    return 1
  fi
  ls -l "$f"

  # Show key lines that define behavior
  echo "Key lines (WEBAPP_ID / PROJECT_KEY / ENDPOINT / PLUGIN_ID):"
  grep -nE '^(PROJECT_KEY|WEBAPP_ID|PLUGIN_ID|ENDPOINT)=' "$f" || true

  # If wrapper uses variables in ENDPOINT, show the assembled endpoint hints too
  echo "Endpoint-related lines (restart/actions/restart/updateFromZip):"
  grep -nE 'actions/updateFromZip|backend/actions/restart|/public/api/' "$f" || true
  echo
}

inspect_wrapper "${PLUGIN_WRAPPER}" || true
inspect_wrapper "${RESTART_WRAPPER}" || true

echo "NOTE: It is OK if the restart wrapper filename contains '_liveparser' â what matters is the WEBAPP_ID inside it."
echo

echo "=== Check: sudoers syntax ==="
visudo -c
echo

echo "=== Check: /etc/sudoers.d permissions (must be 0440) ==="
bad=0
if [[ -d /etc/sudoers.d ]]; then
  while IFS= read -r -d '' f; do
    perms="$(stat -c '%a' "$f" 2>/dev/null || echo '?')"
    owner="$(stat -c '%U:%G' "$f" 2>/dev/null || echo '?')"
    if [[ "$perms" != "440" ]]; then
      echo "BAD  $perms  $owner  $f"
      bad=1
    else
      echo "OK   $perms  $owner  $f"
    fi
  done < <(find /etc/sudoers.d -maxdepth 1 -type f -print0 | sort -z)
else
  echo "WARN: /etc/sudoers.d does not exist"
fi
echo

echo "=== Inspect: ${SUDOERS_DROPIN} ==="
if [[ -f "${SUDOERS_DROPIN}" ]]; then
  ls -l "${SUDOERS_DROPIN}"
  echo "--- contents ---"
  cat "${SUDOERS_DROPIN}"
  echo "--------------"
else
  echo "MISSING: ${SUDOERS_DROPIN}"
  bad=1
fi
echo

echo "=== Show: what sudo thinks ${CLAUDE_USER} can do (sudo -l) ==="
sudo -u "${CLAUDE_USER}" sudo -l || true
echo

echo "=== Test: non-interactive sudo for wrappers (sudo -n) ==="
echo "Test 1: restart wrapper (should NOT prompt; may fail due to curl/404/etc)"
sudo -u "${CLAUDE_USER}" sudo -n "${RESTART_WRAPPER}" && echo "OK: restart wrapper ran without password" || echo "FAIL: restart wrapper prompted/failed (exit=$?)"
echo

echo "Test 2: plugin wrapper (argument check only)"
echo "Calling with a dummy filename; wrapper should fail validation, but sudo should NOT prompt."
sudo -u "${CLAUDE_USER}" sudo -n "${PLUGIN_WRAPPER}" "DUMMY.zip" && echo "UNEXPECTED: plugin wrapper succeeded" || echo "OK/EXPECTED: plugin wrapper failed without prompting (exit=$?)"
echo

echo "=== Grep for sudo policies that force auth/tty ==="
grep -R --line-number -E 'requiretty|authenticate|timestamp_timeout|targetpw|rootpw|runaspw' /etc/sudoers /etc/sudoers.d 2>/dev/null || true
echo

echo "=== Summary ==="
if [[ "$bad" -eq 1 ]]; then
  echo "STATUS: ISSUES FOUND (see BAD/MISSING above)."
  exit 10
else
  echo "STATUS: BASIC CHECKS OK. If sudo -n still prompts, focus on 'sudo -u claude sudo -l' output and sudoers.d perms."
fi
