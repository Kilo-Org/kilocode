# Integration Tests for kilo-vscode

## Overview

Integration tests that verify the kilo-vscode extension works end-to-end by spawning a real `kilo serve` process and communicating via the `@kilocode/sdk`. These tests are designed to catch issues at the boundaries between the VS Code extension, the CLI backend, and AI providers.

## What Was Implemented

### Level 2: CLI Backend + SDK Integration Tests ✅

**File:** `packages/kilo-vscode/tests/integration/cli-backend.test.ts`

Standalone bun tests that spawn `kilo serve` and use `@kilocode/sdk` to verify the server API:

- **Health check** — `GET /global/health` responds with 200
- **Session list** — `client.session.list()` returns data
- **Session create** — `client.session.create()` creates a new session

These tests run without VS Code — they directly spawn the CLI binary and use the SDK client, mirroring how `ServerManager` and `KiloConnectionService` work in the extension.

**Key implementation details:**
- Auth uses **Basic auth** with username `kilo` and the password (matching `KiloConnectionService`)
- CLI binary resolved from `packages/kilo-vscode/bin/kilo` (copied by `prepare:cli-binary` during the extension compile step)
- Server port detection uses the same regex as `parseServerPort()`: `/listening on http:\/\/[\w.]+:(\d+)/`
- Override via `KILO_CLI_PATH` env var for local development

### Level 3: Full E2E with Mock LLM ✅

**File:** `packages/kilo-vscode/tests/integration/e2e-mock-llm.test.ts`

The most valuable test — verifies the complete message flow from SDK → CLI → provider → response:

1. Starts a mock OpenAI-compatible HTTP server (`Bun.serve`) that returns canned streaming completions
2. Spawns `kilo serve` with `KILO_CONFIG_CONTENT` injecting a custom provider pointing to the mock server
3. Creates a session, sends a prompt with explicit `model: { providerID: "mock", modelID: "mock-model" }`
4. Polls `session.messages()` until a text part appears in the response
5. Verifies the mock LLM's response ("Hello from mock LLM!") was received

**Key implementation details:**
- Mock LLM serves `/v1/models` and `/v1/chat/completions` (streaming SSE format)
- `KILO_CONFIG_CONTENT` is a supported env var (see `packages/opencode/src/config/config.ts`) that overrides config
- Messages API returns objects with `parts[]` arrays, not flat `{ role: "assistant" }` objects
- 60s test timeout to allow for CLI startup + LLM round-trip

### CI Workflow

**File:** `.github/workflows/integration-test.yml`

- **Triggers:** `workflow_dispatch` (pre-release manual trigger) + weekday nightly schedule (03:00 UTC)
- **Runner:** `blacksmith-4vcpu-ubuntu-2404`
- **Steps:** Build CLI → Compile extension → Run bun integration tests
- **Duration:** ~1 minute total
- **Temporary:** `push` trigger for `mark/integration-tests` branch (remove before merge)

### Supporting Files

| File | Purpose |
|------|---------|
| `packages/kilo-vscode/tsconfig.test.json` | Separate tsconfig for compiling Level 1 mocha tests |
| `packages/kilo-vscode/.vscode-test.mjs` | Updated glob and VS Code launch args for activation tests |
| `packages/kilo-vscode/package.json` | Updated `compile-tests` script to use `tsconfig.test.json` |

## What Was NOT Implemented (and Why)

### Level 1: Extension Activation Tests ⏸️

**File:** `packages/kilo-vscode/src/test/integration/activation.test.ts` (written but not runnable in CI)

Uses `@vscode/test-electron` and mocha to run tests inside a headless VS Code instance:
- Extension activates successfully
- Expected commands are registered
- Sidebar view commands are contributed

**Why it doesn't work yet:**

The extension bundle is too heavy for the VS Code extension host heartbeat. When VS Code loads the Kilo extension (which includes WASM binaries for `web-tree-sitter`, `js-tiktoken`, etc.), it blocks the JavaScript event loop for ~3.5 seconds. VS Code detects this and marks the extension host as "unresponsive," which triggers CPU profiling and prevents the mocha test runner from executing.

Things we tried that didn't help:
- `--disable-extensions` — disables marketplace extensions but built-in extensions still load; our extension is the bottleneck
- `--extensions-unresponsive-timeout` — not a valid VS Code CLI flag
- `--disable-gpu`, `--disable-workspace-trust` — reduces some overhead but not enough

**What needs to happen to fix this:**
1. **Lazy-load heavy modules** in the extension's `activate()` function — defer loading of `web-tree-sitter`, `js-tiktoken`, and other WASM-heavy dependencies until they're actually needed
2. **Or** move the extension host unresponsive detection to a higher threshold using VS Code's internal settings (not currently exposed via CLI args)
3. **Or** use a different testing approach for activation (e.g., spawn VS Code via Playwright instead of `@vscode/test-electron`)

The activation test file is committed and ready to run once the extension startup is optimized.

## Running Locally

### Prerequisites

```bash
# Build the CLI binary
cd packages/opencode && bun run build

# Compile the extension (copies CLI binary to bin/)
cd ../kilo-vscode && bun run compile
```

### Run Levels 2+3

```bash
cd packages/kilo-vscode
bun test tests/integration/
```

### Run with a custom CLI binary

```bash
KILO_CLI_PATH=/path/to/kilo bun test tests/integration/
```

### Run Level 1 locally (may hang)

```bash
cd packages/kilo-vscode
bun run compile-tests
bun run test  # or: ./node_modules/.bin/vscode-test
```

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| **Basic auth** (`kilo:password`) | Matches `KiloConnectionService` in the extension |
| **`KILO_CONFIG_CONTENT`** for mock provider | Supported env var that overrides all config sources |
| **Explicit `model` in prompt** | CLI needs to know which provider/model to route to |
| **`bin/kilo` path** | `prepare:cli-binary` copies the platform binary here during compile |
| **Bun tests (not mocha)** for Levels 2+3 | Don't need VS Code APIs; bun tests are faster and more debuggable |
| **`continue-on-error`** for Level 1 | Allows Levels 2+3 to run even when activation tests hang |
| **Nightly/manual trigger** | Too slow for every PR; run on schedule + pre-release |
