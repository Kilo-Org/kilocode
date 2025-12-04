# Kilo Code CLI Docker Image
FROM node:20.19.2-bookworm-slim

# Build arguments for metadata (all optional with defaults)
ARG BUILD_DATE=""
ARG VCS_REF=""
ARG VERSION="latest"

# OCI Image labels
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.revision="${VCS_REF}"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.title="Kilo Code CLI"
LABEL org.opencontainers.image.description="Docker image for Kilo Code CLI with Chromium support"
LABEL org.opencontainers.image.vendor="Kilo Code"
LABEL org.opencontainers.image.url="https://kilocode.ai/docs/cli"
LABEL org.opencontainers.image.documentation="https://kilocode.ai/docs/cli"
LABEL org.opencontainers.image.source="https://github.com/Kilo-Org/kilocode"
LABEL org.opencontainers.image.licenses="Apache-2.0"

# Install system dependencies and clean up in one layer
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
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @kilocode/cli@latest

# Set environment variables for Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium \
    CHROME_BIN=/usr/bin/chromium

# Set home directory
ENV HOME=/home/kilocode

# Create non-root user and set up directories in one layer
RUN groupadd -r kilocode && useradd -r -g kilocode -G audio,video kilocode \
    && mkdir -p /home/kilocode/.kilocode /workspace \
    && chown -R kilocode:kilocode /home/kilocode /workspace

# Set working directory
WORKDIR /workspace

# Switch to non-root user
USER kilocode

# Use ENTRYPOINT so arguments are properly passed to the CLI
ENTRYPOINT ["/usr/local/bin/kilocode"]

# Default to interactive mode if no args provided
CMD []