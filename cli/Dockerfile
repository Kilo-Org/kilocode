# Build arguments for metadata (all optional with defaults)
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

# ==========================================
# 1. Alpine Base 
# ==========================================
FROM node:20.19.2-alpine AS alpine_base

# Install dependencies
RUN apk add --no-cache \
    # Build tools for native npm modules
    python3 \
    make \
    g++ \
    # Version control
    git \
    # Network tools
    curl

# Create non-root user and set up directories
RUN addgroup -S kilocode && \
    adduser -S -G kilocode -G audio -G video kilocode && \
    mkdir -p /home/kilocode/.kilocode /workspace && \
    chown -R kilocode:kilocode /home/kilocode /workspace

# Set environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    HOME=/home/kilocode

# ==========================================
# 2. Debian Base
# ==========================================
FROM node:20.19.2-bookworm-slim AS debian_base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    # Chromium and dependencies for puppeteer
    chromium \
    chromium-sandbox \
    fonts-liberation \
    fonts-noto-color-emoji \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    git \
    curl \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user and set up directories
RUN groupadd -r kilocode && useradd -r -g kilocode -G audio,video kilocode \
    && mkdir -p /home/kilocode/.kilocode /workspace \
    && chown -R kilocode:kilocode /home/kilocode /workspace

# Set environment variables for Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium \
    CHROME_BIN=/usr/bin/chromium \
    HOME=/home/kilocode

# ==========================================
# 3. Final Alpine Target
# ==========================================
FROM alpine_base AS alpine

# Re-declare ARGs needed for Labels (ARGs assume scope of the FROM)
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

# Apply Labels
LABEL org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.revision="${VCS_REF}" \
    org.opencontainers.image.version="${VERSION}" \
    org.opencontainers.image.title="Kilo CLI (Alpine)" \
    org.opencontainers.image.description="Docker image for Kilo CLI (Alpine)" \
    org.opencontainers.image.vendor="Kilo" \
    org.opencontainers.image.licenses="Apache-2.0" \
    org.opencontainers.image.url="https://hub.docker.com/r/kiloai/cli"

# Install App
COPY dist/kilocode-cli-${VERSION}.tgz /tmp/kilocode-cli.tgz
RUN npm install -g /tmp/kilocode-cli.tgz && rm /tmp/kilocode-cli.tgz

USER kilocode
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/kilocode"]
CMD []

# ==========================================
# 4. Final Debian Target
# ==========================================
FROM debian_base AS debian

# Re-declare ARGs
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

# Apply Labels
LABEL org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.revision="${VCS_REF}" \
    org.opencontainers.image.version="${VERSION}" \
    org.opencontainers.image.title="Kilo CLI" \
    org.opencontainers.image.description="Docker image for Kilo CLI" \
    org.opencontainers.image.vendor="Kilo" \
    org.opencontainers.image.licenses="Apache-2.0" \
    org.opencontainers.image.url="https://hub.docker.com/r/kiloai/cli"

# Install App
COPY dist/kilocode-cli-${VERSION}.tgz /tmp/kilocode-cli.tgz
RUN npm install -g /tmp/kilocode-cli.tgz && rm /tmp/kilocode-cli.tgz

USER kilocode
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/kilocode"]
CMD []