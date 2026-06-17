# kilocode_change start
ARG REGISTRY=ghcr.io/kilo-org
FROM ${REGISTRY}/build/bun-node:24.04

ARG DEBIAN_FRONTEND=noninteractive
ARG GRADLE_VERSION=9.4.1

# Install Java 21 (apt handles multi-arch automatically)
RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-21-jdk-headless \
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
    hash=$(python3 -c '
import hashlib, sys
n = int.from_bytes(hashlib.md5(sys.argv[1].encode()).digest(), "big")
c = "0123456789abcdefghijklmnopqrstuvwxyz"
r = ""
while n: r, n = c[n % 36] + r, n // 36
print(r)
' "${url}"); \
    dir="/gradle-home/wrapper/dists/gradle-${GRADLE_VERSION}-bin/${hash}"; \
    mkdir -p "${dir}"; \
    curl -fsSL "${url}" -o "${dir}/gradle-${GRADLE_VERSION}-bin.zip"; \
    unzip -q "${dir}/gradle-${GRADLE_VERSION}-bin.zip" -d "${dir}"; \
    touch "${dir}/gradle-${GRADLE_VERSION}-bin.zip.ok"; \
    rm "${dir}/gradle-${GRADLE_VERSION}-bin.zip"; \
    java -version; \
    "${dir}/gradle-${GRADLE_VERSION}/bin/gradle" --version
# kilocode_change end
