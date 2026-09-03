#!/usr/bin/env bash
# Repro: `kilo run` hangs at boot when stdin is a held-open pipe.
#
# Recipe:
#   1. Isolate config in a temp KILO_CONFIG_DIR (kilo.json only:
#      snapshot off, permission {"*":"allow"}; remote and MCP are
#      deliberately absent, they are ruled out as causes).
#   2. Warm bun's transpile cache with one discarded /dev/null boot.
#   3. Boot `bun run --conditions=browser ./src/index.ts run ... --format json --auto`
#      RUNS times with `sleep (TIMEOUT_SEC+5)` piped into stdin, so the
#      pipe never EOFs before the timeout fires.
#   4. A run HANGS when rc=124 (timeout killed it) or when its log holds
#      no `"type":"text"` event line.
#   5. On the first hang, rerun once with `--print-logs --log-level DEBUG`
#      against the same held-open stdin and save stderr for inspection.
#   6. Report `hangs: X / RUNS` and `step0: Y / RUNS` (Y = ok runs whose
#      first step_start event landed within 20000 ms of the run start).
#
# Usage:
#   packages/opencode/script/kilocode/repro-run-stdin-hang.sh [RUNS] [TIMEOUT_SEC]
#
# Env:
#   KILO_REPRO_MODEL  model for the boot (default: kilo/z-ai/glm-5.3-flash)
#
# Pinned root cause:
#   The never-resolving await is `await Bun.stdin.text()` in `loadInput()`
#   at packages/opencode/src/cli/cmd/run.ts:442. A held-open pipe never
#   EOFs, and Bun 1.4.0 on macOS never delivers FIFO EOF (bare-bun probe
#   evidence), so the CLI blocks before the session starts.
#   The hung debug log tail is `project copy refresh done` /
#   `booting location services` (+ `remote-ws connected` when
#   remote_control is on), then only heartbeat lines.
#
# Known-good evidence from planning:
#   - 20/20 boots with /dev/null stdin pass.
#   - 3/3 FIFO-stdin boots and 1/1 held-open-pipe boot hang with the
#     exact observed signature.
#   - The installed kilo 7.5.6 hangs too.
set -euo pipefail

RUNS=${1:-10}
TIMEOUT_SEC=${2:-60}

case $RUNS in
  ''|*[!0-9]*) echo "error: RUNS must be a non-negative integer, got: $RUNS" >&2; exit 2 ;;
esac
case $TIMEOUT_SEC in
  ''|*[!0-9]*) echo "error: TIMEOUT_SEC must be a non-negative integer, got: $TIMEOUT_SEC" >&2; exit 2 ;;
esac

# packages/opencode, resolved from script/kilocode of this script.
PKG_DIR=$(cd "$(dirname "$0")/../.." && pwd)
cd "$PKG_DIR"

command -v bun >/dev/null 2>&1 || { echo "error: bun is required but not installed" >&2; exit 2; }
command -v timeout >/dev/null 2>&1 || { echo "error: timeout is required but not installed (brew install coreutils)" >&2; exit 2; }

MODEL=${KILO_REPRO_MODEL:-kilo/z-ai/glm-5.3-flash}
PROMPT="Reply with one word: hi"
WARMUP_TIMEOUT_SEC=60

# Isolated config dir: no remote, no MCP, no snapshots, all permissions allowed.
KILO_CONFIG_DIR=$(mktemp -d)
export KILO_CONFIG_DIR
export KILO_DISABLE_AUTOUPDATE=1
# shellcheck disable=SC2016  # $schema is a literal JSON key, not a shell expansion.
printf '%s\n' '{"$schema":"https://app.kilo.ai/config.json","snapshot":false,"permission":{"*":"allow"}}' >"$KILO_CONFIG_DIR/kilo.json"

# Per-run logs stay out of the git worktree.
LOG_DIR=$(mktemp -d)
# $TEMP/kilo-hang-debug.log, per the repro recipe; fall back to TMPDIR then /tmp.
TEMP_DIR=${TEMP:-${TMPDIR:-/tmp}}
TEMP_DIR=${TEMP_DIR%/}
DEBUG_LOG="$TEMP_DIR/kilo-hang-debug.log"

# Epoch milliseconds. BSD date has no %N, so fall back to python3, then perl.
now_ms() {
  local t
  t=$(date +%s%3N 2>/dev/null) || t=""
  case $t in
    ''|*[!0-9]*) ;;
    *) printf '%s\n' "$t"; return ;;
  esac
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import time; print(int(time.time()*1000))'
    return
  fi
  perl -MTime::HiRes=time -e 'printf "%d\n", time()*1000'
}

echo "repro: $PKG_DIR, runs=$RUNS, timeout=${TIMEOUT_SEC}s, model=$MODEL"
echo "warmup: one discarded boot with /dev/null stdin (warms bun transpile cache)..."
timeout "$WARMUP_TIMEOUT_SEC" bun run --conditions=browser ./src/index.ts run "$PROMPT" \
  -m "$MODEL" --format json --auto </dev/null >/dev/null 2>&1 || true

hangs=0
step0=0
debug_done=0

for ((i = 1; i <= RUNS; i++)); do
  log="$LOG_DIR/run-$i.log"
  start_ms=$(now_ms)
  rc=0
  # The sleep keeps the write end of stdin open, so the pipe never EOFs.
  sleep $((TIMEOUT_SEC + 5)) | timeout "$TIMEOUT_SEC" bun run --conditions=browser ./src/index.ts run "$PROMPT" \
    -m "$MODEL" --format json --auto >"$log" 2>&1 || rc=$?

  hung=0
  if [ "$rc" -eq 124 ]; then hung=1; fi
  if ! grep -q '"type":"text"' "$log"; then hung=1; fi

  if [ "$hung" -eq 1 ]; then
    hangs=$((hangs + 1))
    echo "run $i: HANG (rc=$rc, log=$log)"
    if [ "$debug_done" -eq 0 ]; then
      debug_done=1
      echo "first hang: rerun once with --print-logs --log-level DEBUG (stderr -> $DEBUG_LOG)"
      drc=0
      sleep $((TIMEOUT_SEC + 5)) | timeout "$TIMEOUT_SEC" bun run --conditions=browser ./src/index.ts run "$PROMPT" \
        -m "$MODEL" --format json --auto --print-logs --log-level DEBUG >/dev/null 2>"$DEBUG_LOG" || drc=$?
      echo "--- last 30 lines of $DEBUG_LOG (debug rerun rc=$drc) ---"
      tail -n 30 "$DEBUG_LOG" || true
      echo "--- debug log file: $DEBUG_LOG ---"
    fi
    continue
  fi

  # Ok run: first step_start timestamp minus run start must be <= 20000 ms.
  line=$(grep -m1 '"type":"step_start"' "$log" || true)
  if [ -n "$line" ]; then
    rest=${line#*'"timestamp":'}
    ts=${rest%%[!0-9]*}
    if [ -n "$ts" ] && [ $((ts - start_ms)) -le 20000 ]; then
      step0=$((step0 + 1))
    fi
  fi
  echo "run $i: ok"
done

echo "logs: $LOG_DIR"
echo "hangs: $hangs / $RUNS"
echo "step0: $step0 / $RUNS"
