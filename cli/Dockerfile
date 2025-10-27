# Kilo Code CLI Docker Image
# Production-ready image with full browser support

FROM node:20.19.2-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    # Build tools for native modules
    python3 \
    make \
    g++ \
    # Chromium and dependencies for puppeteer
    chromium \
    chromium-sandbox \
    # Fonts for proper rendering
    fonts-liberation \
    fonts-noto-color-emoji \
    # Required libraries
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
    # Git for repository operations
    git \
    # CA certificates for HTTPS
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install CLI globally and verify installation
RUN npm install -g @kilocode/cli@latest && \
    # Verify the installation worked
    kilocode --version || echo "CLI installed but version check failed"

# Set environment variables for Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium \
    CHROME_BIN=/usr/bin/chromium

# Create non-root user for security
RUN groupadd -r kilocode && useradd -r -g kilocode -G audio,video kilocode \
    && mkdir -p /home/kilocode/.kilocode \
    && chown -R kilocode:kilocode /home/kilocode

# Set working directory
WORKDIR /workspace

# Change ownership of workspace
RUN chown kilocode:kilocode /workspace

# Switch to non-root user
USER kilocode

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD /usr/local/bin/kilocode --help || exit 1

# Use ENTRYPOINT so arguments are properly passed to the CLI
ENTRYPOINT ["/usr/local/bin/kilocode"]

# Default to interactive mode if no args provided
CMD []