#!/usr/bin/env bash
# OpenCloudOS 9 — install Docker (>20.10.9) + Bun for Phase 1 deploy
# Tencent Cloud: use mirrors.cloud.tencent.com (download.docker.com often blocked/SSL reset)
# Usage: bash bootstrap-oc9.sh
set -euo pipefail

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  echo "[bootstrap] OS: ${NAME:-unknown} ${VERSION_ID:-}"
fi

echo "[bootstrap] Installing base tools..."
sudo dnf install -y dnf-plugins-core git curl tar gzip ca-certificates

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    echo "[bootstrap] Docker already installed: $(docker --version)"
    sudo systemctl enable --now docker 2>/dev/null || true
    return 0
  fi

  # Remove broken official repo from a previous failed attempt
  sudo rm -f /etc/yum.repos.d/docker-ce.repo

  echo "[bootstrap] [1/3] Try OpenCloudOS / Tencent preconfigured docker-ce..."
  if sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin --nobest 2>/dev/null; then
    echo "[bootstrap] Installed via system repo"
    return 0
  fi

  echo "[bootstrap] [2/3] Try Tencent Cloud docker-ce mirror..."
  sudo rm -f /etc/yum.repos.d/docker-ce.repo
  sudo dnf config-manager --add-repo https://mirrors.cloud.tencent.com/docker-ce/linux/centos/docker-ce.repo
  if [[ -f /etc/yum.repos.d/docker-ce.repo ]]; then
    sudo sed -i 's|download.docker.com|mirrors.tencentyun.com/docker-ce|g' /etc/yum.repos.d/docker-ce.repo
    sudo sed -i 's|https://mirrors.cloud.tencent.com/docker-ce|https://mirrors.tencentyun.com/docker-ce|g' /etc/yum.repos.d/docker-ce.repo 2>/dev/null || true
  fi
  if sudo dnf makecache -y && sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin --nobest; then
    echo "[bootstrap] Installed via Tencent mirror"
    return 0
  fi

  echo "[bootstrap] [3/3] Try Aliyun docker-ce mirror..."
  sudo rm -f /etc/yum.repos.d/docker-ce.repo
  sudo dnf config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
  if [[ -f /etc/yum.repos.d/docker-ce.repo ]]; then
    sudo sed -i 's|download.docker.com|mirrors.aliyun.com/docker-ce|g' /etc/yum.repos.d/docker-ce.repo
  fi
  sudo dnf makecache -y
  sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin --nobest
  echo "[bootstrap] Installed via Aliyun mirror"
}

configure_docker_mirror() {
  sudo mkdir -p /etc/docker
  if [[ ! -f /etc/docker/daemon.json ]]; then
    echo '[bootstrap] Configuring Tencent container registry mirror...'
    sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "registry-mirrors": ["https://mirror.ccs.tencentyun.com"]
}
EOF
    sudo systemctl restart docker 2>/dev/null || true
  fi
}

install_docker
sudo systemctl enable --now docker
configure_docker_mirror

ver="$(docker version --format '{{.Server.Version}}' 2>/dev/null || docker --version | awk '{print $3}' | tr -d ',')"
echo "[bootstrap] Docker version: $ver"

if id -nG "$USER" | grep -qw docker; then
  echo "[bootstrap] User already in docker group"
else
  sudo usermod -aG docker "$USER"
  echo "[bootstrap] Added $USER to docker group — re-login SSH after this script"
fi

if systemctl is-active --quiet firewalld; then
  echo "[bootstrap] Opening firewalld ports 22, 9080..."
  sudo firewall-cmd --permanent --add-port=22/tcp
  sudo firewall-cmd --permanent --add-port=9080/tcp
  sudo firewall-cmd --reload
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "[bootstrap] Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  grep -q 'bun.sh' ~/.bashrc 2>/dev/null || echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
fi

# Kilo Console vite build needs Node 18+ — binary install (NodeSource RPM skips OpenCloudOS)
rm -f "${HOME}/.local/bin/node" 2>/dev/null || true
export PATH="${HOME}/.local/node/bin:${HOME}/.bun/bin:/usr/bin:/usr/local/bin:${PATH}"
major="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1 || echo 0)"
if [[ "$major" -lt 18 ]]; then
  echo "[bootstrap] Installing Node.js 20 binary (OpenCloudOS)..."
  NODE_VER=20.19.2
  arch="linux-x64"
  [[ "$(uname -m)" == "aarch64" ]] && arch="linux-arm64"
  name="node-v${NODE_VER}-${arch}"
  tmp="/tmp/${name}.tar.xz"
  mkdir -p "${HOME}/.local/node"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VER}/${name}.tar.xz" -o "$tmp" \
    || curl -fsSL "https://npmmirror.com/mirrors/node/v${NODE_VER}/${name}.tar.xz" -o "$tmp"
  tar -xJf "$tmp" -C "${HOME}/.local/node" --strip-components=1
  rm -f "$tmp"
  grep -q '\.local/node/bin' ~/.bashrc 2>/dev/null || echo 'export PATH="$HOME/.local/node/bin:$HOME/.bun/bin:$PATH"' >> ~/.bashrc
  export PATH="${HOME}/.local/node/bin:${HOME}/.bun/bin:${PATH}"
fi
hash -r 2>/dev/null || true
echo "[bootstrap] node: $(node -v 2>/dev/null || echo missing)"

if ! swapon --show 2>/dev/null | grep -q .; then
  if [[ ! -f /swapfile ]]; then
    echo "[bootstrap] Adding 4G swap for CLI compile..."
    sudo fallocate -l 4G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096 status=none
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  else
    sudo swapon /swapfile 2>/dev/null || true
  fi
fi

echo ""
echo "[bootstrap] Versions:"
docker --version
docker compose version
export PATH="${HOME}/.bun/bin:${PATH}"
bun --version 2>/dev/null || echo "  bun: run 'source ~/.bashrc' after re-login"

echo ""
echo "[bootstrap] Done. Next:"
echo "  1) Re-login SSH if newly added to docker group"
echo "  2) cd /root/kilocode-main && bun install --ignore-scripts"
echo "  3) cd deploy/enterprise && cp env/test.cloud.ruiyumaas.env.sample .env && nano .env"
echo "  4) ./scripts/deploy-cloud.sh --build --full-chain"
