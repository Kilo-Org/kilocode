#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<EOF
Usage: $0 <version> [options]

Builds the JetBrains plugin for a version without creating or validating a git tag.
By default this runs a clean build, prepares production CLI binaries, signs the ZIP, and verifies it.

Version:
  x.y.z or x.y.z-rc.n, with an optional leading v.

Options:
  --skip-signing       Build an unsigned ZIP without requiring JetBrains signing secrets.
  --skip-verification  Skip JetBrains signature and plugin verification.
  --skip-clean         Reuse Gradle outputs instead of running ./gradlew clean first.
  -h, --help           Show this help.

Examples:
  $0 7.0.1
  $0 v7.0.1-rc.1
  $0 7.0.1-rc.1 --skip-signing --skip-verification
  $0 7.0.1 --skip-clean --skip-signing --skip-verification
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

raw=""
skip_verification=0
sign=1
clean=1

for arg in "$@"; do
  case "$arg" in
    --skip-verification)
      skip_verification=1
      ;;
    --skip-signing)
      sign=0
      ;;
    --skip-clean)
      clean=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$raw" ]]; then
        echo "Unexpected argument: $arg" >&2
        usage
        exit 1
      fi
      raw="$arg"
      ;;
  esac
done

if [[ -z "$raw" ]]; then
  echo "Missing required version." >&2
  usage
  exit 1
fi

version="${raw#v}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$ ]]; then
  echo "Unsupported version '$raw'. Expected x.y.z or x.y.z-rc.n, for example 7.0.1 or 7.0.1-rc.1." >&2
  exit 1
fi

script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin="$(cd "${script}/.." && pwd)"
cli="$(cd "${plugin}/../opencode" && pwd)"
secrets="${HOME}/.secrets/jetbrains"
chain="${secrets}/chain.crt"
key="${secrets}/private.pem"
encrypted_key="${secrets}/private_encrypted.pem"
pass="${secrets}/JETBRAINS_PRIVATE_KEY_PASSWORD"

if [[ ! -d "$plugin" ]]; then
  echo "Expected JetBrains plugin package at $plugin" >&2
  exit 1
fi

if [[ ! -f "${cli}/package.json" ]]; then
  echo "Expected CLI package at $cli" >&2
  exit 1
fi

if [[ "$sign" == "1" ]]; then
  for file in "$chain" "$key" "$pass"; do
    if [[ ! -s "$file" ]]; then
      echo "Missing required secret file: $file" >&2
      echo "Pass --skip-signing to build an unsigned ZIP without signing secrets." >&2
      exit 1
    fi
    chmod go-rwx "$file" 2>/dev/null || true
  done

  if [[ -f "$encrypted_key" ]]; then
    chmod go-rwx "$encrypted_key" 2>/dev/null || true
  fi

  export JETBRAINS_CERTIFICATE_CHAIN_FILE="$chain"
  export JETBRAINS_PRIVATE_KEY_FILE="$key"
  export JETBRAINS_PRIVATE_KEY_PASSWORD="$(<"$pass")"
fi

cd "$plugin"

if [[ "$clean" == "1" ]]; then
  ./gradlew clean
fi

rm -rf "${cli}/dist"
KILO_VERSION="$version" KILO_CHANNEL=rc bun "${plugin}/script/build.ts" --production --prepare-cli
./gradlew buildPlugin -Pproduction=true -Pkilo.version="$version" -Pkilo.channel=eap

if [[ "$sign" == "1" ]]; then
  ./gradlew signPlugin -Pproduction=true -Pkilo.version="$version" -Pkilo.channel=eap
fi

if [[ "$skip_verification" == "1" ]]; then
  printf '\nSkipping JetBrains plugin verification.\n'
else
  if [[ "$sign" == "1" ]]; then
    ./gradlew verifyPluginSignature -Pproduction=true -Pkilo.version="$version" -Pkilo.channel=eap
  fi
  ./gradlew verifyPlugin -Pproduction=true -Pkilo.version="$version" -Pkilo.channel=eap
fi

if [[ "$sign" == "1" ]]; then
  printf '\nSigned JetBrains plugin ZIP:\n'
  ls -lh build/distributions/*-signed.zip
else
  printf '\nUnsigned JetBrains plugin ZIP:\n'
  ls -lh build/distributions/*.zip
fi
