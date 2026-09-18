# kilocode_change start
ARG REGISTRY=ghcr.io/kilo-org
# kilocode_change end
FROM ${REGISTRY}/build/base:24.04

SHELL ["/bin/bash", "-lc"]

ARG NODE_VERSION=24.4.0
ARG BUN_VERSION=1.3.14

ENV BUN_INSTALL=/opt/bun
ENV PATH=/opt/bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN set -euo pipefail; \
  arch=$(uname -m); \
  node_arch=x64; \
  if [ "$arch" = "aarch64" ]; then node_arch=arm64; fi; \
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
  | tar -xJf - -C /usr/local --strip-components=1; \
  corepack enable

# kilocode_change start - retry the installer and its internal release download
RUN set -euo pipefail; \
  for attempt in 1 2 3 4 5; do \
    if curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}"; then \
      break; \
    fi; \
    if [ "$attempt" -eq 5 ]; then \
      echo "Bun installation failed after 5 attempts" >&2; \
      exit 1; \
    fi; \
    echo "Bun installation failed, retrying ($attempt/5)" >&2; \
    sleep "$((attempt * 5))"; \
  done; \
  bun --version; \
  node --version; \
  npm --version
# kilocode_change end
