# Kilo Code Development Container
# Based on flake.nix dependencies for standardized development environment

# Use official Node.js image matching .nvmrc version
FROM node:20.20.0-bullseye

# Install system dependencies (matching flake.nix packages)
RUN apt-get update && apt-get install -y \
  git \
  curl \
  wget \
  libnotify-bin \
  build-essential \
  python3 \
  ca-certificates \
  gnupg \
  lsb-release \
  && rm -rf /var/lib/apt/lists/*

# Enable corepack for pnpm (matching package.json version)
RUN corepack enable && corepack prepare pnpm@10.8.1 --activate

# Set working directory
WORKDIR /workspace

# Set environment variables
ENV NODE_ENV=development
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Create pnpm directories
RUN mkdir -p /root/.local/share/pnpm

# Default command
CMD ["bash"]