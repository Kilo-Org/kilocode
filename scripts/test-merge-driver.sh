#!/usr/bin/env bash
# DaveAI: synthetic test harness for scripts/merge-package-json-branding.cjs.
#
# Builds three small package.json fixtures in a tempdir:
#   ancestor : upstream baseline at version 7.2.20, no MAOS branding
#   current  : DaveAI fork — same baseline + DaveAI displayName/author/MAOS title
#   incoming : upstream at version 7.2.24 (a release-bump commit)
#
# Invokes the driver. Asserts the merged result has BOTH:
#   - incoming's new "version" (7.2.24)
#   - current's DaveAI "displayName" (contains "MAOS")
#   - current's MAOS-flavoured contributes.commands[].title preserved
#   - incoming's new contributes.commands[] entries also present
#
# Prints PASS / FAIL and exits with 0 / 1 accordingly.
#
# Usage: bash scripts/test-merge-driver.sh

set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
DRIVER="${SCRIPT_DIR}/merge-package-json-branding.cjs"

if [[ ! -f "${DRIVER}" ]]; then
    echo "FAIL: driver not found at ${DRIVER}"
    exit 1
fi

TMP="$(mktemp -d -t daveai-merge-test-XXXXXX)"
trap 'rm -rf "${TMP}"' EXIT

ANCESTOR="${TMP}/ancestor.json"
CURRENT="${TMP}/current.json"
INCOMING="${TMP}/incoming.json"

cat > "${ANCESTOR}" <<'JSON'
{
  "name": "kilocode",
  "displayName": "Kilo Code",
  "description": "Kilo Code for VS Code.",
  "version": "7.2.20",
  "publisher": "kilocode",
  "author": { "name": "Kilo Code" },
  "contributes": {
    "commands": [
      { "command": "kilo-code.new.plusButtonClicked", "title": "New Task" }
    ]
  }
}
JSON

cat > "${CURRENT}" <<'JSON'
{
  "name": "kilocode-maos",
  "displayName": "KiloCode MAOS Edition",
  "description": "Multi-Agent Operating System (MAOS) for VS Code.",
  "version": "7.2.20-EVO2",
  "publisher": "kilocode",
  "icon": "assets/icons/logo-outline-black.png",
  "author": { "name": "KiloCode MAOS Edition" },
  "homepage": "https://daveai.tech/kilocode-maos",
  "contributes": {
    "commands": [
      { "command": "kilo-code.v4.toggleDebugMode", "title": "KiloCode V4 MAOS: Toggle Debug Mode" },
      { "command": "kilo-code.new.plusButtonClicked", "title": "New Task" },
      { "command": "kilo-code.new.agentManagerOpen",  "title": "MAOS Agent Manager" }
    ]
  }
}
JSON

cat > "${INCOMING}" <<'JSON'
{
  "name": "kilocode",
  "displayName": "Kilo Code",
  "description": "Kilo Code for VS Code.",
  "version": "7.2.24",
  "publisher": "kilocode",
  "author": { "name": "Kilo Code" },
  "contributes": {
    "commands": [
      { "command": "kilo-code.v4.toggleDebugMode",     "title": "Kilo Code: Toggle Debug Mode" },
      { "command": "kilo-code.new.plusButtonClicked",  "title": "New Task" },
      { "command": "kilo-code.new.agentManagerOpen",   "title": "Agent Manager" },
      { "command": "kilo-code.brand-new-upstream-cmd", "title": "Brand New Upstream Command" }
    ]
  }
}
JSON

# Invoke the driver. Note: it writes the merged result back to %A (CURRENT).
node "${DRIVER}" "${ANCESTOR}" "${CURRENT}" "${INCOMING}" "packages/kilo-vscode/package.json"
RC=$?

if [[ ${RC} -ne 0 ]]; then
    echo "FAIL: driver exited with non-zero status ${RC}"
    exit 1
fi

# Assertions — pure bash + grep (no jq dependency).
RESULT="$(cat "${CURRENT}")"

fail() {
    echo "FAIL: $1"
    echo "----- merged file was: -----"
    echo "${RESULT}"
    echo "----------------------------"
    exit 1
}

# 1. Upstream's new version made it through.
echo "${RESULT}" | grep -q '"version": "7.2.24"' \
    || fail 'expected merged "version" to be 7.2.24 (from incoming)'

# 2. DaveAI displayName preserved.
echo "${RESULT}" | grep -q '"displayName": "KiloCode MAOS Edition"' \
    || fail 'expected merged "displayName" to be "KiloCode MAOS Edition" (from current)'

# 3. DaveAI author preserved.
echo "${RESULT}" | grep -q '"name": "KiloCode MAOS Edition"' \
    || fail 'expected merged author.name to be "KiloCode MAOS Edition" (from current)'

# 4. DaveAI-only top-level field (homepage) preserved (incoming did not have it).
echo "${RESULT}" | grep -q '"homepage": "https://daveai.tech/kilocode-maos"' \
    || fail 'expected merged "homepage" to be preserved from current'

# 5. MAOS-flavoured command title preserved.
echo "${RESULT}" | grep -q '"title": "KiloCode V4 MAOS: Toggle Debug Mode"' \
    || fail 'expected MAOS command title to be preserved from current'

# 6. Non-MAOS command title takes upstream value (none differ here, but the
#    new upstream command should be present).
echo "${RESULT}" | grep -q '"command": "kilo-code.brand-new-upstream-cmd"' \
    || fail 'expected new upstream command to flow through'

# 7. MAOS-only command (Agent Manager has MAOS in its title in current) preserved
#    even though upstream's same-named command has a non-MAOS title.
echo "${RESULT}" | grep -q '"title": "MAOS Agent Manager"' \
    || fail 'expected MAOS-flavoured "MAOS Agent Manager" title to win over upstream "Agent Manager"'

echo "PASS: merge driver produced correct DaveAI-branding-preserving result."
echo "      version=7.2.24 (upstream)  displayName=\"KiloCode MAOS Edition\" (DaveAI)"
exit 0
