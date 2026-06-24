# kilocode_change start
ARG REGISTRY=ghcr.io/kilo-org
# kilocode_change end
FROM ${REGISTRY}/build/base:24.04

SHELL ["/bin/bash", "-lc"]

ARG NODE_VERSION=24.4.0
# kilocode_change start - pin the Rust Bun canary by immutable upstream revision.
ARG BUN_REVISION=2ad419957431f1f4179f5376283b6639d8b81a7a
# kilocode_change end

ENV BUN_INSTALL=/opt/bun
ENV PATH=/opt/bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN set -euo pipefail; \
  arch=$(uname -m); \
  node_arch=x64; \
  if [ "$arch" = "aarch64" ]; then node_arch=arm64; fi; \
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
  | tar -xJf - -C /usr/local --strip-components=1; \
  corepack enable

# kilocode_change start - use the exact Rust Bun artifact used by CI and Nix.
RUN set -euo pipefail; \
  arch=$(uname -m); \
  bun_arch=x64; \
  if [ "$arch" = "aarch64" ]; then bun_arch=aarch64; fi; \
  curl -fsSL "https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${BUN_REVISION}-canary/bun-linux-${bun_arch}.zip" -o /tmp/bun.zip; \
  unzip -q /tmp/bun.zip -d /tmp/bun; \
  install -Dm755 "/tmp/bun/bun-linux-${bun_arch}/bun" /opt/bun/bin/bun; \
  ln -s /opt/bun/bin/bun /opt/bun/bin/bunx; \
  rm -rf /tmp/bun /tmp/bun.zip; \
  test "$(bun -e 'process.stdout.write(Bun.revision)')" = "$BUN_REVISION"; \
  bun --version; \
  node --version; \
  npm --version
# kilocode_change end
