# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Devil Code (formerly Kilo Code) — an open-source AI coding agent platform. Fork of [OpenCode](https://github.com/anomalyco/opencode) with auth, telemetry, i18n, VS Code extension, Agent Manager, and multi-model support via OpenRouter. Turborepo + Bun workspaces monorepo.

## Essential Commands

```bash
# Development
bun install                  # Install deps (Bun 1.3.10+ required)
bun run dev                  # Run CLI locally (TUI mode)
bun run dev <dir>            # Run CLI against a specific directory
bun run dev .                # Run CLI in repo root
bun run extension            # Build + launch VS Code extension in dev mode
bun run extension --insiders # Use VS Code Insiders
bun run dev:web              # Start web UI
bun run dev:storybook        # Component storybook

# Type checking
bun turbo typecheck          # Full monorepo (uses tsgo, NOT tsc)
bun run typecheck            # From packages/opencode/ (tsgo --noEmit)

# Testing — NEVER run tests from root (bunfig.toml blocks it)
cd packages/opencode && bun test                       # All CLI tests
cd packages/opencode && bun test test/tool/tool.test.ts # Single test
cd packages/devil-vscode && bun run test               # Extension tests
cd packages/devil-vscode && bun run test -- --grep "name" # Single extension test

# Code quality (VS Code extension)
cd packages/devil-vscode && bun run format             # Prettier (run before commits)
cd packages/devil-vscode && bun run format:check       # Check formatting
cd packages/devil-vscode && bun run knip               # Dead export detection (CI enforced)
cd packages/devil-vscode && bun run lint               # ESLint

# Code generation
./script/generate.ts         # Regenerate SDK after server endpoint changes
bun run check-kilocode-change # Verify devilcode_change markers (from devil-vscode/)

# Build
./packages/opencode/script/build.ts --single  # Standalone CLI binary
cd packages/devil-vscode && bun script/local-bin.ts    # Build extension's bundled CLI

# Source links (CI enforced)
bun run script/extract-source-links.ts  # From repo root, after URL changes in devil-vscode/webview-ui/opencode
```

## Architecture Overview

All products are thin clients over the CLI (`packages/opencode/`). The CLI contains the AI agent runtime, tool execution, session management, and an HTTP API server (Hono). Clients spawn `kilo serve` and communicate via HTTP REST + SSE using `@kilocode/sdk`.

```
                    @kilocode/cli (packages/opencode/)
                 ┌────────────────────────────────────┐
                 │  AI agents, tools, sessions,        │
                 │  providers, config, MCP, LSP        │
                 │  Hono HTTP server + SSE + Zod       │
                 └──┬──────────┬──────────┬───────────┘
                    │          │          │
            ┌───────┴──┐ ┌────┴────┐ ┌───┴──────────┐
            │ TUI      │ │ VS Code │ │ Desktop / Web│
            │(SolidJS +│ │Extension│ │ (Tauri/Bun)  │
            │ OpenTUI) │ │(Node.js)│ │              │
            └──────────┘ └─────────┘ └──────────────┘
```

The VS Code extension spawns `bin/kilo serve --port 0`, captures the port from stdout, and authenticates with a random password via `KILO_SERVER_PASSWORD` env var. Multiple webviews (sidebar, Agent Manager, open tabs) share one `KiloConnectionService` singleton.

## Package Map

| Package | Purpose | Active? |
| --- | --- | --- |
| `packages/opencode/` | Core CLI — agents, tools, sessions, server, TUI | Primary |
| `packages/devil-vscode/` | VS Code extension + Agent Manager | Primary |
| `packages/devil-ui/` | SolidJS component library (40+ components on @kobalte/core) | Active |
| `packages/devil-gateway/` | Auth, provider routing, Kilo API | Active |
| `packages/sdk/js/` | Auto-generated SDK — never edit `src/gen/` | Generated |
| `packages/devil-telemetry/` | PostHog + OpenTelemetry | Active |
| `packages/devil-i18n/` | 16 languages | Active |
| `packages/devil-docs/` | Next.js + Markdoc docs site | Active |
| `packages/app/` | Shared SolidJS web UI | Not maintained |
| `packages/desktop/` | Tauri desktop app | Not maintained |

## Key Patterns (CLI — packages/opencode/)

Import aliases: `@/*` → `./src/*`, `@tui/*` → `./src/cli/cmd/tui/*`

- **Namespace modules**: Code organized as TS namespaces with Zod schemas, types, and functions (not classes)
- **`Instance.state(init, dispose?)`**: Per-project lazy singletons tied to directory via AsyncLocalStorage
- **`fn(schema, callback)`**: Zod-validated function wrapper
- **`Tool.define(id, init)`**: All tools follow this. Output auto-truncates.
- **`BusEvent.define()` + `Bus.publish()`**: In-process pub/sub
- **`NamedError.create(name, schema)`**: Structured errors
- **`iife()`**: Used to avoid `let` statements per style guide
- **Storage**: Filesystem JSON in `~/.local/share/kilo/storage/` — no database
- **Server**: Hono HTTP + SSE + OpenAPI spec generation
- **Providers**: Vercel AI SDK abstraction layer, models from models.dev

## Key Patterns (VS Code Extension)

Two esbuild builds: Extension (Node/CJS) → `dist/extension.js`, Webview (browser/IIFE) → `dist/webview.js` + `dist/agent-manager.js`.

Webview uses **SolidJS** (not React). Extension and webview communicate via `vscode.Webview.postMessage()` — no shared state.

Feature pattern for new backend→webview data flow:
1. Types in `src/services/cli-backend/types.ts`
2. HTTP method in `src/services/cli-backend/http-client.ts`
3. `fetchAndSend*()` in `src/KiloProvider.ts` + handle `request*` message
4. Message types in `webview-ui/src/types/messages.ts`
5. Context subscription in `webview-ui/src/context/`
6. Component consumption in `webview-ui/src/components/`

Agent Manager code: extension in `src/agent-manager/`, webview in `webview-ui/agent-manager/`. File size caps enforced by tests — extract logic into helpers instead of growing provider files.

## Fork Management (Critical)

This is a fork of upstream OpenCode. To minimize merge conflicts:

1. **Kilo-specific code goes in dedicated paths**: `packages/opencode/src/kilocode/`, `packages/opencode/test/kilocode/`, all `packages/devil-*/`
2. **Mark changes to shared code** with `devilcode_change` comments (single-line: `// devilcode_change`, multi-line: `// devilcode_change start` / `// devilcode_change end`)
3. **Markers NOT needed** in paths containing `kilocode`, or in `packages/devil-vscode/` and `packages/devil-ui/` (entirely Kilo additions)
4. **Don't restructure upstream code** — keep diffs minimal

## Windows Process Spawning

Any `spawn`/`execFile`/`exec` without `windowsHide: true` flashes a cmd.exe window. Use:
- CLI: `Process.spawn` from `src/util/process.ts`
- Extension: `spawn`/`exec` from `src/util/process.ts` (not `child_process` directly)
- `Bun.spawn`/`Bun.spawnSync`: pass `windowsHide` explicitly

## Formatting & Code Quality

- Prettier: 120 char width, no semicolons (run `bun run format` from devil-vscode before commits)
- Markdown tables: no column padding (creates spurious diffs). MD files excluded from prettier via `.prettierignore`
- Knip: all exports must be imported somewhere — CI enforced in devil-vscode
- Source links: CI checks `packages/devil-docs/source-links.md` is up to date after URL changes
- Pre-push hook: verifies Bun version matches `packageManager` field, runs `bun typecheck`

## Commit Conventions

Conventional Commits with package scopes: `vscode`, `cli`, `agent-manager`, `sdk`, `ui`, `i18n`, `kilo-docs`, `gateway`, `telemetry`, `desktop`. Omit scope when spanning multiple packages.

## Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEVIL_API_URL` | `https://api.devil.ai` | Gateway, auth, models, profile |
| `DEVIL_SESSION_INGEST_URL` | `https://ingest.devilsessions.ai` | Session export / cloud sync |
| `DEVIL_MODELS_URL` | `https://models.dev` | Model metadata |
| `KILO_SERVER_PASSWORD` | (generated) | Extension↔CLI auth |
| `KILO_PLATFORM` | — | Set to `vscode` when running inside extension |

## CI Checks That Will Fail Your PR

1. `bun turbo typecheck` — type errors anywhere in monorepo
2. `bun run knip` — unused exports in devil-vscode
3. `bun run format:check` — unformatted code in devil-vscode
4. `bun run check-kilocode-change` — stale `devilcode_change` markers in devil-vscode or devil-ui
5. Source links check — stale `source-links.md` after URL changes
6. PR title must follow conventional commits (`feat:`, `fix:`, `docs:`, etc.)
7. Fix/chore PRs must reference a GitHub issue

## Debugging

- Extension host logs: VS Code "Extension Host" output channel
- Webview logs: Command Palette → "Developer: Open Webview Developer Tools"
- All debug output prefixed with `[Kilo New]`
- VS Code commands use `kilo-code.new.` prefix
- Local backend testing: `DEVIL_API_URL=http://localhost:3000 bun dev`
