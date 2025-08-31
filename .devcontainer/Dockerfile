# Kilo Code Development Container
# Based on flake.nix dependencies for standardized development environment

# Use official Node.js image matching .nvmrc version
FROM node:20.19.2-bullseye

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

# The node user already exists in the base image with UID/GID 1000
# Just ensure the home directory exists and has correct permissions
RUN mkdir -p /home/node && chown node:node /home/node

# Set working directory
WORKDIR /workspace

# Switch to non-root user
USER node

# Set environment variables
ENV NODE_ENV=development
ENV PNPM_HOME="/home/node/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Create pnpm directories
RUN mkdir -p /home/node/.local/share/pnpm

# Default command
CMD ["bash"]