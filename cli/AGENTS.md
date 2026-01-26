# CLI AGENTS.md

This file provides guidance to AI agents when working with the Kilo Code CLI package.

## Architecture Overview

The CLI is a **standalone Node.js process** that embeds the VSCode extension core. Each CLI instance runs in its own process, enabling **parallel execution** - this is how the agent manager spawns multiple agents working simultaneously. Built with TypeScript (ESM), React/Ink UI, Jotai state, esbuild bundling, and Vitest tests.

### Core Design

1. **Process Isolation**: Each `kilocode` invocation is a separate process with its own state
2. **ClineProvider Wrapper**: The CLI wraps [`ClineProvider`](../src/core/webview/ClineProvider.ts) via [`handleCLIMessage()`](../src/core/webview/ClineProvider.ts:1355) - all webview messages route through this method
3. **VSCode API Mock**: [`cli/src/host/VSCode.ts`](src/host/VSCode.ts) provides a complete mock of the VSCode API
4. **Extension Host**: [`cli/src/host/ExtensionHost.ts`](src/host/ExtensionHost.ts) loads the extension and registers as a webview provider

### Message Flow

```
CLI UI (Ink/React) → Jotai Atoms → ExtensionService → ExtensionHost → ClineProvider.handleCLIMessage()
```

The CLI sends messages to `ClineProvider` the same way the VSCode webview does, just through `handleCLIMessage()` instead of `postMessage()`.

### Dependencies

The CLI bundles `@kilocode/agent-runtime` and depends on `@kilocode/core-schemas`, `@roo-code/types`. The runtime is the core AI agent logic; CLI wraps it with terminal UI.

## Build & Run

Prereqs: Node >= 20.20.0, pnpm.

```bash
# From repo root: install dependencies + build extension core + CLI bundle
pnpm install
pnpm cli:bundle

# Build CLI (from cli/)
pnpm build

# Rebuild on changes (watch, from cli/)
pnpm dev

# Run CLI
cd cli && pnpm start

# Development (watch mode)
cd cli && pnpm start:dev

# Tests (from cli/)
pnpm test
pnpm test:watch
pnpm test:integration
pnpm test:integration:verbose

# Quality checks (from cli/)
pnpm check-types
pnpm lint
pnpm format
```

Config file: `~/.kilocode/cli/config.json`. Logs: `~/.kilocode/cli/logs/cli.txt`.
Environment variables: `docs/ENVIRONMENT_VARIABLES.md`. Provider setup: `docs/PROVIDER_CONFIGURATION.md`.

## Testing

Unit tests live in `src/__tests__/`; integration tests live in `integration-tests/`. Test files use `*.test.ts`.

## Code Style

Uses **tabs** for indentation. TypeScript ESM with strict mode. Components use PascalCase; functions/variables use camelCase.

## Boundaries

- Do not edit `dist/` (generated build output).
- Do not commit tokens or local config; runtime config lives under `~/.kilocode/cli/`.

## Key Files

| File                                                     | Purpose                          |
| -------------------------------------------------------- | -------------------------------- |
| [`src/index.ts`](src/index.ts)                           | CLI entry point                  |
| [`src/cli.ts`](src/cli.ts)                               | Main CLI class                   |
| [`src/commands/`](src/commands/)                         | Slash command implementations    |
| [`src/ui/`](src/ui/)                                     | React/Ink UI components          |
| [`src/state/`](src/state/)                               | Jotai atoms and hooks            |
| [`src/host/ExtensionHost.ts`](src/host/ExtensionHost.ts) | Loads extension, routes messages |
| [`src/host/VSCode.ts`](src/host/VSCode.ts)               | VSCode API mock                  |
| [`src/services/extension.ts`](src/services/extension.ts) | Service layer wrapper            |
