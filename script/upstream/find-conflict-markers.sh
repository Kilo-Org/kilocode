#!/usr/bin/env bash
# Find git merge conflict markers in a file.
#
# Prints the line number and the marker for each of:
#   <<<<<<< (ours start)
#   ||||||| (base / diff3 separator)
#   ======= (separator)
#   >>>>>>> (theirs end)
#
# Requires ripgrep (rg).
#
# Usage:
#   script/upstream/find-conflict-markers.sh <file>
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <file>" >&2
  exit 2
fi

file=$1

if [ ! -f "$file" ]; then
  echo "error: not a file: $file" >&2
  exit 2
fi

if ! command -v rg >/dev/null 2>&1; then
  echo "error: ripgrep (rg) is required but not installed" >&2
  exit 2
fi

# Match the four conflict marker line shapes. `=======` must be the whole line;
# the others may have trailing content (branch name, commit hash, etc.).
# rg exits 1 when no matches are found; treat that as success (clean file).
rg -n '^(<{7}|\|{7}|={7}$|>{7})' "$file" || {
  status=$?
  if [ "$status" -eq 1 ]; then
    exit 0
  fi
  exit "$status"
}
