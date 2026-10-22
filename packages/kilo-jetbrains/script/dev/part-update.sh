#!/usr/bin/env sh
set -eu

usage() {
  printf 'Usage: %s <client|backend> <session-id>\n' "$0" >&2
  printf '       %s <kilo-log> <session-id>\n' "$0" >&2
}

if [ "$#" -ne 2 ]; then
  usage
  exit 2
fi

target=$1
sid=$2
mode=$target

script=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
plugin=$(CDPATH= cd -- "$script/../.." && pwd)

resolve() {
  case "$target" in
    client|frontend)
      for file in \
        "$plugin/.intellijPlatform/sandbox/kilo.jetbrains/kilo-frontend/kilo-dev.log" \
        "$plugin/build/idea-sandbox/system/log/idea.log" \
        "$plugin/build/idea-sandbox/client/system/log/idea.log" \
        "$plugin/build/idea-sandbox/frontend/system/log/idea.log"
      do
        if [ -r "$file" ]; then
          printf '%s\n' "$file"
          return 0
        fi
      done
      ;;
    backend)
      for file in \
        "$plugin/.intellijPlatform/sandbox/kilo.jetbrains/kilo-backend/kilo-dev.log" \
        "$plugin/build/idea-sandbox/backend/system/log/idea.log" \
        "$plugin/build/idea-sandbox-backend/system/log/idea.log" \
        "$plugin/build/idea-sandbox/system/log/idea.log"
      do
        if [ -r "$file" ]; then
          printf '%s\n' "$file"
          return 0
        fi
      done
      ;;
    *)
      if [ -r "$target" ]; then
        printf '%s\n' "$target"
        return 0
      fi
      ;;
  esac

  return 1
}

in=$(resolve || true)

if [ -z "$in" ]; then
  printf 'Could not find readable log for target: %s\n' "$target" >&2
  printf 'Tried JetBrains sandbox logs under: %s/.intellijPlatform and %s/build\n' "$plugin" "$plugin" >&2
  exit 1
fi

if [ ! -r "$in" ]; then
  printf 'Input not readable: %s\n' "$in" >&2
  exit 1
fi

awk -v want="$sid" -v mode="$mode" '
function trim(s) {
  sub(/^[[:space:]]+/, "", s)
  sub(/[[:space:]]+$/, "", s)
  return s
}

function value(s, key, pattern) {
  pattern = key "=[^[:space:]]+"
  if (match(s, pattern)) return substr(s, RSTART + length(key) + 1, RLENGTH - length(key) - 1)
  return ""
}

function quoted(s, key, pattern) {
  pattern = key "=\"[^\"]*\""
  if (match(s, pattern)) return substr(s, RSTART + length(key) + 2, RLENGTH - length(key) - 3)
  return ""
}

function logger(line, start, rest, stop) {
  start = index(line, " - #")
  if (start == 0) return ""
  rest = substr(line, start + 4)
  stop = index(rest, " - ")
  if (stop == 0) return ""
  return substr(rest, 1, stop - 1)
}

function message(line, start, rest, stop) {
  start = index(line, " - #")
  if (start == 0) return ""
  rest = substr(line, start + 4)
  stop = index(rest, " - ")
  if (stop == 0) return ""
  return substr(rest, stop + 3)
}

function emit(msg, pid, text) {
  if (value(msg, "sid") != want) return
  if (value(msg, "evt") != "message.part.delta") return
  if (value(msg, "field") != "text") return

  pid = value(msg, "pid")
  text = quoted(msg, "preview")
  if (pid == "" || text == "") return

  print "pid=" pid " text=\"" text "\""
}

{
  sub(/\r$/, "")
  cls = logger($0)
  if ((mode == "client" || mode == "frontend") && cls !~ /KiloSessionService$/) next
  if (mode == "backend" && cls !~ /KiloBackendChatManager$/) next

  msg = trim(message($0))
  if (msg == "") next
  if (msg ~ /pass=(true|false)/) next

  emit(msg)
}
' "$in"
