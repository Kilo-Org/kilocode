# Linux shell sandbox validation — 2026-09-05

The actual `packages/kilo-cli/src/sandbox.ts` Bubblewrap adapter passed a Linux
probe from `script/sandbox-linux-smoke.ts`. This replaces the earlier
source-only Linux evidence, not the explicit shell-only scope limitation.

## Environment and result

- Host checkout: `59b29de40966803e2c7cd734d439843fb773f6a6` plus local Kilo changes.
- Linux: aarch64 Docker Desktop, Debian 13, Node 20.20.2, Bubblewrap
  `0.12.0-1~deb13u1`. The probe bundles the production adapter for Node;
  it does not substitute a fake sandbox backend.
- Base image: `nikolaik/python-nodejs:python3.11-nodejs20`, resolved digest
  `sha256:8f958bdc1b4a422bfafd97cab4f69836401f616ae985d4b57a53d254f5bcb038`.
- Passed: workspace write; outside-root write denied with source unchanged;
  explicit protected-path write denied; local HTTP allowed as a control and
  denied under the network policy; unsupported nonempty Linux `denyNames`
  refused. Repeated after removing unreachable name-scanning code.
- The container had no host repository, home, credentials, or sockets mounted.
  Its external network was disabled during the probe. Only the built probe
  was copied into the image; fixtures were created inside the container.

## Reproduction

From `packages/kilo-cli`, build the probe into an explicit temporary context:

```sh
./dist/interactive/bun build script/sandbox-linux-smoke.ts --target=node --outfile=<context>/sandbox-linux-smoke.mjs
```

The context's Dockerfile used:

```dockerfile
FROM nikolaik/python-nodejs@sha256:8f958bdc1b4a422bfafd97cab4f69836401f616ae985d4b57a53d254f5bcb038
RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq bubblewrap
COPY sandbox-linux-smoke.mjs /sandbox-linux-smoke.mjs
CMD ["node", "/sandbox-linux-smoke.mjs"]
```

```sh
docker build -t kilo2-sandbox-validation:local <context>
docker run --rm --name kilo-linux-sandbox-validation --network none \
  --cap-add SYS_ADMIN --security-opt seccomp=unconfined \
  --security-opt systempaths=unconfined kilo2-sandbox-validation:local
```

Output: `KILO_LINUX_SANDBOX_OK: workspace write, outside/protected denial,
network allow/deny, unsupported names refusal`.

Docker's default masked `/proc` prevented nested Bubblewrap from mounting proc.
SYS_ADMIN plus unconfined seccomp alone was insufficient; the explicit
systempaths option permitted the nested sandbox. These are disposable test
container privileges, not recommended production daemon configuration.

## Scope

The macOS test suite separately passed 7 tests / 26 assertions, including the
actual SDK post-registration hook and model shell invocation. Linux proves the
real OS adapter, not a complete Linux Bun/TUI distribution. Neither proves PTY,
MCP, independent git spawns, read-access confinement, proxy networking, or
future basename-based denials on Linux. Those remain separate plan gaps.

The v1 standalone sandbox package cannot be reused unchanged: it returns
arbitrary executable/argv commands and decorates filesystem/HTTP/spawner
services. The v2 public shell hook only changes the selected shell invocation;
the Kilo-owned launcher is required by that narrower contract. No upstream
spawn override was added.
