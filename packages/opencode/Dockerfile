FROM alpine AS base

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add libgcc libstdc++ ripgrep

FROM base AS build-amd64
# kilocode_change start
COPY dist/@kilocode/cli-linux-x64-baseline-musl/bin/kilo dist/@kilocode/cli-linux-x64-baseline-musl/bin/bwrap /usr/local/bin/
COPY dist/@kilocode/cli-linux-x64-baseline-musl/bin/licenses /usr/local/share/licenses/kilo
# kilocode_change end

FROM base AS build-arm64
# kilocode_change start
COPY dist/@kilocode/cli-linux-arm64-musl/bin/kilo dist/@kilocode/cli-linux-arm64-musl/bin/bwrap /usr/local/bin/
COPY dist/@kilocode/cli-linux-arm64-musl/bin/licenses /usr/local/share/licenses/kilo
# kilocode_change end

ARG TARGETARCH
FROM build-${TARGETARCH}
RUN kilo --version
ENTRYPOINT ["kilo"]
