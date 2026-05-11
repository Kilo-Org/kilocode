#!/usr/bin/env bash
# Find git merge conflict markers in one or more files.
#
# Prints the line number and the marker for each of:
#   <<<<<<< (ours start)
#   ||||||| (base / diff3 separator)
#   ======= (separator)
#   >>>>>>> (theirs end)
#
# When invoked with multiple files, prints a `===== <file> =====` header
# before each file's matches and continues past files that are missing or
# have no matches. This batch form exists so the upstream-merge agent can
# inspect a list of conflicted files in a single allowlisted command,
# instead of needing a `for f in ...; do ... done` loop that the permission
# system can't pattern-match.
#
# Requires ripgrep (rg).
#
# Usage:
#   script/upstream/find-conflict-markers.sh <file> [<file>...]
set -uo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <file> [<file>...]" >&2
  exit 2
fi

if ! command -v rg >/dev/null 2>&1; then
  echo "error: ripgrep (rg) is required but not installed" >&2
  exit 2
fi

# Match the four conflict marker line shapes. `=======` must be the whole line;
# the others may have trailing content (branch name, commit hash, etc.).
pattern='^(<{7}|\|{7}|={7}$|>{7})'

scan() {
  local file=$1
  if [ ! -f "$file" ]; then
    echo "error: not a file: $file" >&2
    return 1
  fi
  # rg exits 1 when no matches are found; treat that as success (clean file).
  rg -n "$pattern" "$file"
  local status=$?
  if [ "$status" -eq 0 ] || [ "$status" -eq 1 ]; then
    return 0
  fi
  return "$status"
}

if [ "$#" -eq 1 ]; then
  if [ ! -f "$1" ]; then
    echo "error: not a file: $1" >&2
    exit 2
  fi
  scan "$1"
  exit $?
fi

rc=0
for file in "$@"; do
  echo "===== $file ====="
  scan "$file" || rc=1
done
exit "$rc"
