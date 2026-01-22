# CLI AGENTS.md

This file provides guidance to AI agents when working with the Kilo Code CLI package.

## Architecture Overview

The CLI is a **standalone Node.js process** that embeds the VSCode extension core. Each CLI instance runs in its own process, enabling **parallel execution** - this is how the agent manager spawns multiple agents working simultaneously.

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

## Build & Run

```bash
# From root: build extension + CLI
pnpm cli:bundle

# Run CLI
cd cli && pnpm start

# Development (watch mode)
cd cli && pnpm start:dev
```

## Key Files

| File | Purpose |
|------|---------|
| [`src/cli.ts`](src/cli.ts) | Main CLI class |
| [`src/host/ExtensionHost.ts`](src/host/ExtensionHost.ts) | Loads extension, routes messages |
| [`src/host/VSCode.ts`](src/host/VSCode.ts) | VSCode API mock |
| [`src/services/extension.ts`](src/services/extension.ts) | Service layer wrapper |
