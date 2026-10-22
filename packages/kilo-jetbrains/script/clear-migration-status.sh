#!/usr/bin/env sh
set -eu

# Clears the legacy migration status so the JetBrains plugin re-offers the migration wizard.
#
# Mirrors the backend's KiloBackendLegacyMigrationStoreService.resetStatus(): it deletes the
# durable "legacy-migration-status" marker and strips the inline "migrationStatus" key from
# "legacy-settings.json". Legacy source data in that file is preserved so migration can run again.
#
# It clears every Kilo config dir it can resolve, matching KiloCliConfigPath.resolve():
#   1. $KILO_CONFIG_DIR
#   2. $XDG_CONFIG_HOME/kilo
#   3. $HOME/.config/kilo
# plus the isolated dev-storage dir used by runIde*/split-mode runs:
#   <worktree>/.kilo-dev/config/kilo
#
# Usage:
#   script/clear-migration-status.sh          # clear all resolved config dirs
#   script/clear-migration-status.sh <dir>    # clear a specific config dir

usage() {
  printf 'Usage: %s [config-dir]\n' "$0" >&2
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

script=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
plugin=$(CDPATH= cd -- "$script/.." && pwd)
worktree=$(CDPATH= cd -- "$plugin/../.." && pwd)

# Collect candidate config dirs (newline-separated), deduped while preserving order.
dirs=""
add() {
  [ -n "$1" ] || return 0
  case "
$dirs" in
    *"
$1
"*) ;;
    *) dirs="$dirs$1
" ;;
  esac
}

if [ "$#" -ge 1 ]; then
  add "$1"
else
  [ -n "${KILO_CONFIG_DIR:-}" ] && add "$KILO_CONFIG_DIR"
  [ -n "${XDG_CONFIG_HOME:-}" ] && add "$XDG_CONFIG_HOME/kilo"
  [ -n "${HOME:-}" ] && add "$HOME/.config/kilo"
  add "$worktree/.kilo-dev/config/kilo"
fi

# Strip the inline "migrationStatus" key from legacy-settings.json, if present, without
# touching the rest of the file. Prefers python3, then node; otherwise warns.
strip_inline() {
  file=$1
  grep -q '"migrationStatus"' "$file" 2>/dev/null || return 0
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$file" <<'PY'
import json, sys
p = sys.argv[1]
try:
    with open(p) as f:
        data = json.load(f)
except Exception:
    sys.exit(0)
if isinstance(data, dict) and data.pop("migrationStatus", None) is not None:
    with open(p, "w") as f:
        json.dump(data, f, indent=2)
    print("  cleared inline migrationStatus in " + p)
PY
  elif command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs");
      const p = process.argv[1];
      let data;
      try { data = JSON.parse(fs.readFileSync(p, "utf8")); } catch { process.exit(0); }
      if (data && typeof data === "object" && "migrationStatus" in data) {
        delete data.migrationStatus;
        fs.writeFileSync(p, JSON.stringify(data, null, 2));
        console.log("  cleared inline migrationStatus in " + p);
      }
    ' "$file"
  else
    printf '  WARN: %s has an inline migrationStatus but neither python3 nor node is available to strip it\n' "$file" >&2
  fi
}

printf '%s\n' "$dirs" | while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  [ -d "$dir" ] || continue

  marker="$dir/legacy-migration-status"
  settings="$dir/legacy-settings.json"
  touched=0

  if [ -f "$marker" ]; then
    rm -f "$marker"
    printf '  removed %s\n' "$marker"
    touched=1
  fi

  if [ -f "$settings" ]; then
    strip_inline "$settings" && touched=1 || true
  fi

  if [ "$touched" -eq 1 ]; then
    printf 'Cleared migration status in %s\n' "$dir"
  fi
done

printf 'Done. Restart the JetBrains plugin/backend to re-offer the migration wizard.\n'
