#!/usr/bin/env bash
# cloud-init bootstrap for JetBrains remote development
# Installs: build essentials, Homebrew, brew git, OpenJDK 21, Bun 1.3.13
set -euxo pipefail

LOG=/var/log/kilo-jetbrains-bootstrap.log
exec > >(tee -a "$LOG") 2>&1

echo "=== kilo-jetbrains bootstrap start $(date -u) ==="

# ---------------------------------------------------------------------------
# System packages
# ---------------------------------------------------------------------------

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q \
  build-essential \
  curl \
  file \
  git \
  ca-certificates \
  unzip \
  zip \
  tar \
  gzip \
  procps

# ---------------------------------------------------------------------------
# Homebrew (Linuxbrew) — must run as the ubuntu user, not root
# ---------------------------------------------------------------------------

if ! sudo -u ubuntu test -x /home/linuxbrew/.linuxbrew/bin/brew; then
  sudo -u ubuntu HOME=/home/ubuntu NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# ---------------------------------------------------------------------------
# brew packages: git and openjdk@21
# PATH entries go into .profile (sourced by login shells; .bashrc skips
# non-interactive shells via the 'case $-' guard and would be ignored here)
# ---------------------------------------------------------------------------

sudo -u ubuntu bash -lc '
  set -euxo pipefail
  eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv bash)"

  brew install git openjdk@21

  JAVA_PREFIX="$(brew --prefix openjdk@21)"

  if ! grep -qF "linuxbrew" ~/.profile; then
    echo "" >> ~/.profile
    echo "# Homebrew" >> ~/.profile
    echo "eval \"\$(/home/linuxbrew/.linuxbrew/bin/brew shellenv bash)\"" >> ~/.profile
  fi

  if ! grep -qF "linuxbrew" ~/.bashrc; then
    echo "" >> ~/.bashrc
    echo "# Homebrew" >> ~/.bashrc
    echo "eval \"\$(/home/linuxbrew/.linuxbrew/bin/brew shellenv bash)\"" >> ~/.bashrc
  fi

  if ! grep -qF "openjdk@21" ~/.profile; then
    echo "" >> ~/.profile
    echo "# Java 21" >> ~/.profile
    echo "export JAVA_HOME=\"'"'"'$JAVA_PREFIX'"'"'\"" >> ~/.profile
    echo "export PATH=\"'"'"'$JAVA_PREFIX'"'"'/bin:\$PATH\"" >> ~/.profile
  fi
'

# ---------------------------------------------------------------------------
# Bun 1.3.13 — installed as ubuntu user
# ---------------------------------------------------------------------------

sudo -u ubuntu bash -lc '
  set -euxo pipefail

  curl -fsSL https://bun.sh/install | BUN_INSTALL_VERSION="1.3.13" bash

  if ! grep -qF ".bun/bin" ~/.profile; then
    echo "" >> ~/.profile
    echo "# Bun" >> ~/.profile
    echo "export BUN_INSTALL=\"\$HOME/.bun\"" >> ~/.profile
    echo "export PATH=\"\$HOME/.bun/bin:\$PATH\"" >> ~/.profile
  fi
'

echo "=== kilo-jetbrains bootstrap complete $(date -u) ==="
