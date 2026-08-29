#!/usr/bin/env bash
# kilocode_change - new file
# Bootstraps a constrained or cloud dev environment for this repo.
#
# Idempotent and safe to re-run. Fixes the environment constraints that trip
# up the pre-push hook in ephemeral sandboxes:
#   1. Java 21 (required by the JetBrains typecheck)
#   2. TLS intercept CA trust (required by git, gh, and the JVM behind a
#      transparent proxy, e.g. Cloudflare in cloud sandboxes)
#   3. Workspace dependencies (bun install)
#
# Usage:
#   bun run script/setup-sandbox.sh
# or directly:
#   ./script/setup-sandbox.sh
#
# Env:
#   KILO_SKIP_JAVA=1        skip Java install/verification
#   KILO_SKIP_CA=1          skip TLS CA setup
#   KILO_SKIP_INSTALL=1     skip bun install
#   KILO_SANDBOX_STATE_DIR  where to store generated CA bundle (default ~/.kilocode-sandbox)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state_dir="${KILO_SANDBOX_STATE_DIR:-$HOME/.kilocode-sandbox}"
mkdir -p "$state_dir"

has_java21() {
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
    "$JAVA_HOME/bin/java" -version 2>&1 | grep -q '"21'
    return $?
  fi
  command -v java >/dev/null 2>&1 && java -version 2>&1 | grep -q '"21'
}

setup_java() {
  if has_java21; then
    echo "Java 21: OK"
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    echo "Installing openjdk-21-jdk-headless..."
    apt-get update -qq
    apt-get install -y -qq openjdk-21-jdk-headless
    if has_java21; then
      echo "Java 21: installed"
      return
    fi
  fi

  echo "Warning: could not install Java 21. The pre-push hook will skip the JetBrains typecheck when Java is missing."
}

extract_intercept_ca() {
  echo | openssl s_client -connect github.com:443 -showcerts 2>/dev/null |
    awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/' |
    awk 'BEGIN { n=0 } /BEGIN CERT/ { n++ } { print > "'"$state_dir"'/chain-" n ".pem" }'
  for f in "$state_dir"/chain-*.pem; do
    [ -e "$f" ] || continue
    if openssl x509 -in "$f" -noout -subject 2>/dev/null |
      grep -q "$(openssl x509 -in "$f" -noout -issuer 2>/dev/null | sed 's/^issuer=//')"; then
      echo "$f"
      return
    fi
  done
  return 1
}

setup_ca() {
  local intercept bundle
  if ! command -v openssl >/dev/null 2>&1; then
    echo "Warning: openssl not found; skipping TLS CA setup"
    return
  fi
  if ! command -v git >/dev/null 2>&1 && ! command -v keytool >/dev/null 2>&1; then
    echo "Warning: neither git nor keytool present; skipping TLS CA setup"
    return
  fi

  intercept="$(extract_intercept_ca || true)"
  if [ -z "$intercept" ]; then
    echo "Warning: could not detect a TLS intercept CA (no transparent proxy?)"
    return
  fi
  echo "TLS intercept CA: $intercept"

  bundle="$state_dir/ca-bundle.crt"
  if [ -f /etc/ssl/certs/ca-certificates.crt ]; then
    cat /etc/ssl/certs/ca-certificates.crt "$intercept" > "$bundle"
  else
    cat "$intercept" > "$bundle"
  fi

  if command -v git >/dev/null 2>&1; then
    git config --global http.sslCAInfo "$bundle"
    echo "git: configured http.sslCAInfo=$bundle"
  fi

  if command -v java >/dev/null 2>&1 && command -v keytool >/dev/null 2>&1; then
    local cacerts
    cacerts="$(dirname "$(readlink -f "$(command -v java)")")/../lib/security/cacerts"
    if [ -f "$cacerts" ]; then
      keytool -importcert -noprompt -alias kilocode-sandbox-intercept \
        -file "$intercept" -keystore "$cacerts" -storepass changeit >/dev/null 2>&1 \
        || echo "Warning: could not import CA into JVM cacerts ($cacerts)"
    fi
  fi

  echo "gh/curl: export SSL_CERT_FILE=$bundle in your shell before running gh"

  if [ -n "${GIT_SSL_CAINFO:-}" ] && [ "$GIT_SSL_CAINFO" != "$bundle" ]; then
    echo "Note: GIT_SSL_CAINFO=$GIT_SSL_CAINFO is set in this shell and overrides git's http.sslCAInfo. Run:"
    echo "  export GIT_SSL_CAINFO=$bundle"
    echo "or unset GIT_SSL_CAINFO so git uses its configured bundle."
  fi
}

setup_install() {
  if command -v bun >/dev/null 2>&1; then
    (cd "$root" && bun install --frozen-lockfile)
  else
    echo "Warning: bun not found; cannot install workspace dependencies"
  fi
}

[ -n "${KILO_SKIP_JAVA:-}" ] || setup_java
[ -n "${KILO_SKIP_CA:-}" ] || setup_ca
[ -n "${KILO_SKIP_INSTALL:-}" ] || setup_install

echo
echo "Environment summary:"
echo "  bun: $(bun --version 2>/dev/null || echo missing)"
echo "  java: $(java -version 2>&1 | head -1 || echo missing)"
echo "  git http.sslCAInfo: $(git config --global --get http.sslCAInfo || echo unset)"
echo "  sandbox state: $state_dir"
echo
echo "If the pre-push hook still blocks a push (e.g. bun version gate), use:"
echo "  KILO_SKIP_BUN_VERSION_CHECK=1 git push"
echo "Only bypass the hook when the push content is already verified."
