#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <version> [--skip-clean] [--skip-signing] [--skip-verification]" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
version="${1#v}"
shift
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || usage

clean=true
sign=true
verify=true
for option in "$@"; do
  case "$option" in
    --skip-clean) clean=false ;;
    --skip-signing) sign=false ;;
    --skip-verification) verify=false ;;
    *) usage ;;
  esac
done

cd "$(dirname "$0")/.."
tasks=()
if "$clean"; then tasks+=(clean); fi
tasks+=(buildPlugin)
if "$sign"; then tasks+=(signPlugin); fi
if "$verify"; then
  if "$sign"; then tasks+=(verifyPluginSignature); fi
  tasks+=(verifyPlugin)
fi
exec ./gradlew -Pproduction=true "-Pkilo.version=$version" "${tasks[@]}"
