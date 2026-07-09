#!/usr/bin/env bash
# Shared cloud build environment: bun, Node 20+ (for vite), swap.
set -euo pipefail

NODE_VER="${KILO_NODE_VERSION:-20.19.2}"
NODE_ROOT="${HOME}/.local/node"
CURL_OPTS=(--connect-timeout 15 --max-time 600 -fsSL)

run() {
  echo "[build-env] $*"
  "$@"
}

ensure_bun() {
  export PATH="${HOME}/.bun/bin:${PATH}"

  if [[ -x "${HOME}/.bun/bin/bun" ]]; then
    export PATH="${HOME}/.bun/bin:${PATH}"
    echo "[build-env] bun binary ok (${HOME}/.bun/bin/bun)"
    return 0
  fi

  if command -v bun >/dev/null 2>&1; then
    echo "[build-env] bun at $(command -v bun) but ${HOME}/.bun/bin/bun missing — reinstalling..."
  else
    echo "[build-env] bun not found — installing..."
  fi

  run curl "${CURL_OPTS[@]}" https://bun.sh/install | bash
  export PATH="${HOME}/.bun/bin:${PATH}"
  grep -q '\.bun/bin' ~/.bashrc 2>/dev/null || echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
  [[ -x "${HOME}/.bun/bin/bun" ]] || { echo "[build-env] bun install failed" >&2; exit 1; }
  echo "[build-env] bun installed (${HOME}/.bun/bin/bun)"
}

node_major() {
  local bin="${1:-node}"
  command -v "$bin" >/dev/null 2>&1 || return 1
  "$bin" -v 2>/dev/null | sed 's/^v//' | cut -d. -f1
}

install_node_binary() {
  rm -f "${HOME}/.local/bin/node" 2>/dev/null || true
  local arch="linux-x64"
  case "$(uname -m)" in
    aarch64|arm64) arch="linux-arm64" ;;
    x86_64|amd64) arch="linux-x64" ;;
    *) echo "[build-env] unsupported arch: $(uname -m)" >&2; return 1 ;;
  esac

  local name="node-v${NODE_VER}-${arch}"
  local mirror="https://npmmirror.com/mirrors/node/v${NODE_VER}/${name}.tar.xz"
  local primary="https://nodejs.org/dist/v${NODE_VER}/${name}.tar.xz"
  local tmp="/tmp/${name}.tar.xz"

  echo "[build-env] downloading Node ${NODE_VER} (${name}.tar.xz)..."
  mkdir -p "${NODE_ROOT}"
  if ! run curl "${CURL_OPTS[@]}" "$mirror" -o "$tmp"; then
    echo "[build-env] npmmirror failed — trying nodejs.org..."
    run curl "${CURL_OPTS[@]}" "$primary" -o "$tmp"
  fi
  run tar -xJf "$tmp" -C "${NODE_ROOT}" --strip-components=1
  rm -f "$tmp"

  export PATH="${NODE_ROOT}/bin:${HOME}/.bun/bin:${PATH}"
  if ! grep -q '\.local/node/bin' ~/.bashrc 2>/dev/null; then
    echo 'export PATH="$HOME/.local/node/bin:$HOME/.bun/bin:$PATH"' >> ~/.bashrc
  fi
}

ensure_node() {
  echo "[build-env] checking node..."
  rm -f "${HOME}/.local/bin/node" 2>/dev/null || true
  export PATH="${NODE_ROOT}/bin:${HOME}/.bun/bin:/usr/bin:/usr/local/bin:${PATH}"
  hash -r 2>/dev/null || true

  if [[ -x "${NODE_ROOT}/bin/node" ]]; then
    local major
    major="$(node_major "${NODE_ROOT}/bin/node" 2>/dev/null || echo 0)"
    if [[ "$major" -ge 18 ]]; then
      echo "[build-env] node v${major}.x (${NODE_ROOT}/bin/node)"
      export PATH="${NODE_ROOT}/bin:${PATH}"
      return 0
    fi
  fi

  local major
  major="$(node_major node 2>/dev/null || echo 0)"
  if [[ "$major" -ge 18 ]]; then
    echo "[build-env] node $(node -v) ($(command -v node))"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    echo "[build-env] node $(node -v) too old — installing ${NODE_VER}..."
  else
    echo "[build-env] node not found — installing ${NODE_VER}..."
  fi

  # dnf nodejs on OpenCloudOS is often v12 and may hang on metadata — skip unless forced
  if [[ "${KILO_DNF_NODE:-0}" == "1" ]] && command -v dnf >/dev/null 2>&1; then
    echo "[build-env] trying dnf install nodejs (KILO_DNF_NODE=1)..."
    if sudo dnf install -y nodejs npm; then
      hash -r 2>/dev/null || true
      major="$(node_major node 2>/dev/null || echo 0)"
      if [[ "$major" -ge 18 ]]; then
        echo "[build-env] node $(node -v) (dnf)"
        return 0
      fi
    fi
  fi

  install_node_binary
  major="$(node_major "${NODE_ROOT}/bin/node")"
  [[ "$major" -ge 18 ]] || { echo "[build-env] node install failed" >&2; exit 1; }
  echo "[build-env] node $( "${NODE_ROOT}/bin/node" -v) (${NODE_ROOT}/bin/node)"
}

ensure_swap() {
  echo "[build-env] checking swap..."
  if swapon --show 2>/dev/null | grep -q .; then
    echo "[build-env] swap: $(swapon --show | awk 'NR==2 {print $3}')"
    return 0
  fi
  if [[ -f /swapfile ]]; then
    sudo swapon /swapfile 2>/dev/null && return 0
  fi
  echo "[build-env] no swap — adding 4G (CLI compile may OOM without it)..."
  sudo fallocate -l 4G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096 status=progress
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "[build-env] swap enabled: $(free -h | awk '/^Swap:/ {print $2}')"
}

prepare_build_env() {
  echo "[build-env] step 1/3: bun"
  ensure_bun
  echo "[build-env] step 2/3: node"
  ensure_node
  echo "[build-env] step 3/3: swap"
  ensure_swap
  echo "[build-env] ready"
}
