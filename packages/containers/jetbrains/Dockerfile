# kilocode_change start
ARG REGISTRY=ghcr.io/kilo-org
FROM ${REGISTRY}/build/bun-node:24.04 AS runtime

ARG DEBIAN_FRONTEND=noninteractive
ARG GRADLE_VERSION=9.4.1

# Install Java 21 and the font stack required by JBR headless tests
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    fonts-dejavu-core \
    libfontconfig1 \
    libfreetype6 \
    openjdk-21-jdk-headless \
  && rm -rf /var/lib/apt/lists/*

# Create a stable /usr/lib/jvm/java-21 symlink that works on amd64 and arm64
RUN java_home="$(dirname "$(dirname "$(readlink -f "$(which java)")")")" \
  && ln -nfs "${java_home}" /usr/lib/jvm/java-21

ENV JAVA_HOME=/usr/lib/jvm/java-21

# Pre-download the exact Gradle distribution used by the wrapper so CI jobs
# skip the download entirely.  GRADLE_USER_HOME is set to a location that any
# user (including the GitHub Actions runner) can read.
ENV GRADLE_USER_HOME=/gradle-home

RUN set -euo pipefail; \
    url="https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip"; \
    hash=$(node -e 'const crypto = require("node:crypto"); const hex = crypto.createHash("md5").update(process.argv[1]).digest("hex"); console.log(BigInt(`0x${hex}`).toString(36))' "${url}"); \
    dir="/gradle-home/wrapper/dists/gradle-${GRADLE_VERSION}-bin/${hash}"; \
    mkdir -p "${dir}"; \
    curl -fsSL "${url}" -o "${dir}/gradle-${GRADLE_VERSION}-bin.zip"; \
    unzip -q "${dir}/gradle-${GRADLE_VERSION}-bin.zip" -d "${dir}"; \
    touch "${dir}/gradle-${GRADLE_VERSION}-bin.zip.ok"; \
    rm "${dir}/gradle-${GRADLE_VERSION}-bin.zip"; \
    java -version; \
    "${dir}/gradle-${GRADLE_VERSION}/bin/gradle" --version

FROM ${REGISTRY}/build/bun-node:24.04 AS bun-cache

WORKDIR /src
COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
COPY patches ./patches
RUN bun install --frozen-lockfile --ignore-scripts --cache-dir=/bun-cache

FROM runtime

ENV BUN_INSTALL_CACHE_DIR=/opt/bun/install/cache
COPY --from=bun-cache /bun-cache/ /opt/bun/install/cache/
# kilocode_change end
