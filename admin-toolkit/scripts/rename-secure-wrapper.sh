#!/usr/bin/env bash
# Renames the secure plugin wrapper from diag-parser-live to admin-toolkit.
# Run as root: sudo bash scripts/rename-secure-wrapper.sh
set -euo pipefail

WRAPPER_DIR="/data/dss-secure-actions/bin"
OLD="${WRAPPER_DIR}/dss_plugin_update_diag-parser-live"
NEW="${WRAPPER_DIR}/dss_plugin_update_admin-toolkit"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: must run as root" >&2
  exit 1
fi

if [[ ! -f "${OLD}" ]]; then
  echo "ERROR: old wrapper not found: ${OLD}" >&2
  exit 1
fi

cat > "${NEW}" << 'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail

KEY_FILE="/data/keys/dss_api_key_prod"
URL_FILE="/data/keys/dss_url_prod"
DIST_DIR="/data/dist"

PLUGIN_ID="admin-toolkit"
ENDPOINT="/public/api/plugins/${PLUGIN_ID}/actions/updateFromZip"

usage() {
  echo "Usage: $0 <zip_filename>" >&2
  echo "  Expects: ${DIST_DIR}/<zip_filename>" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
ZIP_NAME="$1"

# Enforce filename-only (no slashes, no traversal)
if [[ "${ZIP_NAME}" == *"/"* || "${ZIP_NAME}" == *".."* ]]; then
  echo "ERROR: zip filename must not contain path elements" >&2
  exit 2
fi

# Enforce naming family for this plugin
if [[ ! "${ZIP_NAME}" =~ ^dss-plugin-admin-toolkit-[0-9]+(\.[0-9]+)*\.zip$ ]]; then
  echo "ERROR: unexpected zip filename: ${ZIP_NAME}" >&2
  exit 2
fi

ZIP_PATH="${DIST_DIR}/${ZIP_NAME}"
[[ -f "${ZIP_PATH}" ]] || { echo "ERROR: file not found: ${ZIP_PATH}" >&2; exit 2; }

DSS_URL="$(cat "${URL_FILE}")"
API_KEY="$(cat "${KEY_FILE}")"

exec /usr/bin/curl -fsS   -H "Authorization: Bearer ${API_KEY}"   -X POST "${DSS_URL}${ENDPOINT}"   --form "file=@${ZIP_PATH}"
WRAPPER

chmod 755 "${NEW}"
chown root:root "${NEW}"

echo "Created: ${NEW}"
echo "Old wrapper kept at: ${OLD} (remove manually when ready)"
