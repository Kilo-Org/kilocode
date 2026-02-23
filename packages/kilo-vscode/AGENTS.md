# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Product Context

Kilo Code is an open source AI coding agent platform. It ships as multiple products that all build on the same backend. This package (`packages/kilo-vscode/`) is the **VS Code extension** — one of several clients.

### Products and How They Relate

All products are thin clients over the **CLI** (`packages/opencode/`, published as `@kilocode/cli`). The CLI is a fork of upstream [OpenCode](https://github.com/anomalyco/opencode) with Kilo-specific additions (gateway auth, telemetry, migration, code review, branding). It contains the full AI agent runtime, tool execution, session management, provider integrations (500+ models), and an HTTP API server.

Every client spawns or connects to a `kilo serve` process and communicates via HTTP REST + SSE using the auto-generated `@kilocode/sdk`.

```
                        @kilocode/cli  (packages/opencode/)
                     ┌────────────────────────────────┐
                     │  AI agents, tools, sessions,    │
                     │  providers, config, MCP, LSP    │
                     │  Hono HTTP server + SSE         │
                     └──┬──────────┬──────────┬───────┘
                        │          │          │
                ┌───────┴──┐ ┌────┴────┐ ┌───┴──────────┐
                │ TUI      │ │ VS Code │ │ Desktop / Web│
                │ (builtin)│ │Extension│ │              │
                └──────────┘ └─────────┘ └──────────────┘
```

| Product                    | Package                                | What it is                                          | How it uses the CLI                                               |
| -------------------------- | -------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| Kilo CLI (TUI)             | `packages/opencode/`                   | Interactive terminal UI (SolidJS + OpenTUI)         | In-process — TUI and server run together                          |
| Kilo CLI (`kilo run`)      | `packages/opencode/`                   | Non-interactive headless mode for scripting         | In-process — no network socket                                    |
| **Kilo VS Code Extension** | **`packages/kilo-vscode/`**            | VS Code extension with sidebar chat + Agent Manager | Bundles CLI binary, spawns `kilo serve --port 0` as child process |
| OpenCode Desktop           | `packages/desktop/`                    | Standalone native app (Tauri)                       | Bundles CLI binary as sidecar, spawns `kilo serve`                |
| OpenCode Web (`kilo web`)  | `packages/opencode/` + `packages/app/` | Browser-based UI                                    | CLI starts server + opens browser                                 |

**OpenCode Desktop** (`packages/desktop/`) and `kilo web` both render the shared `@opencode-ai/app` SolidJS frontend (`packages/app/`). They differ only in the platform layer (Tauri native APIs vs browser APIs). Neither has any relationship to this extension or the Agent Manager — they are independent clients of the same `kilo serve` backend.

### Kilo-Domain Packages

| Package                    | Name                       | Role                                                                                                                         |
| -------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/kilo-vscode/`    | `kilo-code`                | **This package.** VS Code extension.                                                                                         |
| `packages/kilo-gateway/`   | `@kilocode/kilo-gateway`   | Auth (device flow), AI provider routing (OpenRouter), Kilo API integration (profile, balance, teams)                         |
| `packages/kilo-ui/`        | `@kilocode/kilo-ui`        | SolidJS component library (40+ components, built on `@kobalte/core`). Shared by this extension's webview and `packages/app/` |
| `packages/kilo-telemetry/` | `@kilocode/kilo-telemetry` | PostHog analytics + OpenTelemetry tracing for the CLI                                                                        |
| `packages/kilo-i18n/`      | `@kilocode/kilo-i18n`      | Translation strings (16 languages)                                                                                           |
| `packages/kilo-docs/`      | `@kilocode/kilo-docs`      | Documentation site (Next.js + Markdoc)                                                                                       |

### Upstream OpenCode Packages (not Kilo-specific)

| Package              | Name                   | Role                                                                                     |
| -------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| `packages/opencode/` | `@kilocode/cli`        | Core CLI — forked from upstream OpenCode. AI agents, tools, sessions, server.            |
| `packages/sdk/js/`   | `@kilocode/sdk`        | Auto-generated TypeScript SDK client for the server API. Do not edit `src/gen/` by hand. |
| `packages/app/`      | `@opencode-ai/app`     | Shared SolidJS web UI consumed by desktop app and `kilo web`                             |
| `packages/desktop/`  | `@opencode-ai/desktop` | Tauri desktop app shell                                                                  |
| `packages/ui/`       | `@opencode-ai/ui`      | Shared UI primitives                                                                     |
| `packages/util/`     | `@opencode-ai/util`    | Shared utilities (error, path, retry, slug)                                              |
| `packages/plugin/`   | `@kilocode/plugin`     | Plugin/tool interface definitions                                                        |

## Commands

```bash
bun run compile          # Type-check + lint + build
bun run watch            # Watch mode (esbuild + tsc)
bun run test             # Run tests (requires pretest compilation)
bun run lint             # ESLint on src/
bun run format           # Run formatter (do this before committing to avoid styling-only changes in commits)
```

Single test: `bun run test -- --grep "test name"`

## CLI Binary

The extension bundles its own CLI binary at `bin/kilo` — it does NOT use a system-installed CLI. To build it:

```bash
bun script/local-bin.ts
```

Or use `--force` to rebuild:

```bash
bun script/local-bin.ts --force
```

The script checks for a prebuilt binary in `packages/opencode/dist/`, builds the CLI if needed, and copies it to `bin/kilo`.

## Architecture

### Extension ↔ CLI Backend

The extension is a client of the CLI. At startup it spawns `bin/kilo serve --port 0`, captures the dynamically-assigned port from stdout, and communicates over HTTP + SSE. A random password is generated and passed via `KILO_SERVER_PASSWORD` env var for basic auth.

```
Extension (Node.js)                          CLI Backend (child process)
┌──────────────────────────┐                ┌──────────────────────┐
│ KiloConnectionService    │── HTTP/SSE ──> │ kilo serve --port 0  │
│   ├── ServerManager      │                │   Hono REST API      │
│   ├── HttpClient         │                │   SSE event stream   │
│   └── SSEClient          │                │   Session management │
│                          │                │   AI agent runtime   │
│ KiloProvider (sidebar)   │                └──────────────────────┘
│ KiloProvider (agent mgr) │
│ KiloProvider (open tabs) │
└──────────────────────────┘
```

- **`KiloConnectionService`** (`src/services/cli-backend/connection-service.ts`) is a singleton shared across all webviews. It owns the server process, HTTP client, and SSE connection.
- **`ServerManager`** (`src/services/cli-backend/server-manager.ts`) spawns the CLI binary and manages the process lifecycle.
- Multiple **`KiloProvider`** instances (sidebar, Agent Manager, "open in tab" panels) subscribe to the shared connection. SSE events are filtered per-webview via a `trackedSessionIds` Set.

### Builds

Two separate esbuild builds in [`esbuild.js`](esbuild.js):

- **Extension** (Node/CJS): `src/extension.ts` → `dist/extension.js`
- **Webview** (browser/IIFE): `webview-ui/src/index.tsx` → `dist/webview.js` AND `webview-ui/agent-manager/index.tsx` → `dist/agent-manager.js`

### Non-Obvious Details

- Webview uses **Solid.js** (not React) — JSX compiles via `esbuild-plugin-solid`
- Extension code in `src/`, webview code in `webview-ui/src/` with separate tsconfig
- Tests compile to `out/` via `compile-tests`, not `dist/`
- CSP requires nonce for scripts and `font-src` for bundled fonts — see [`KiloProvider.ts`](src/KiloProvider.ts:777)
- HTML root has `data-theme="kilo-vscode"` to activate kilo-ui's VS Code theme bridge
- Extension and webview have no shared state — communicate via `vscode.Webview.postMessage()`
- For editor panels, use [`AgentManagerProvider`](src/agent-manager/AgentManagerProvider.ts) pattern with `retainContextWhenHidden: true`
- esbuild webview build includes [`cssPackageResolvePlugin`](esbuild.js:29) for CSS `@import` resolution and font loaders (`.woff`, `.woff2`, `.ttf`)
- Avoid `setTimeout` for sequencing VS Code operations — use deterministic event-based waits (e.g. `waitForWebviewPanelToBeActive()`)

## Extension ↔ Webview Feature Pattern

When adding a new feature that requires data from the CLI backend to be displayed in the webview:

1. **Types** (`src/services/cli-backend/types.ts`): Add response types for the backend data
2. **HTTP Client** (`src/services/cli-backend/http-client.ts`): Add a fetch method to retrieve the data
3. **KiloProvider** (`src/KiloProvider.ts`): Add a `fetchAndSend*()` method using the cached message pattern, and handle the corresponding `request*` message from the webview in `handleWebviewMessage()`
4. **Message Types** (`webview-ui/src/types/messages.ts`): Add `*LoadedMessage` (extension→webview) and `Request*Message` (webview→extension) types to the `ExtensionMessage` / `WebviewMessage` unions
5. **Context** (`webview-ui/src/context/`): Subscribe to the loaded message **outside** `onMount` (to catch early pushes before mount), add retry logic for the request message, expose state via context
6. **Component** (`webview-ui/src/components/`): Consume context, render UI

Key patterns:

- **Cached messages** (e.g. `cachedProvidersMessage`, `cachedAgentsMessage` in KiloProvider): Ensures webview refreshes get data immediately without waiting for a new HTTP round-trip
- **Retry timers** (e.g. `agentRetryTimer` in session context): Handles race conditions where the extension's HTTP client isn't ready when the webview first requests data

## Agent Manager

The Agent Manager is a feature within this extension (not a separate product). It opens as an **editor tab** (`Cmd+Shift+M`) and provides multi-session orchestration — running multiple independent AI sessions in parallel, each optionally isolated in its own git worktree.

### How It Differs From the Sidebar

| Aspect        | Sidebar                    | Agent Manager                                           |
| ------------- | -------------------------- | ------------------------------------------------------- |
| Location      | Activity bar sidebar panel | Editor tab (full panel)                                 |
| Sessions      | Single session at a time   | Multiple parallel sessions with tabbed UI               |
| Git isolation | Uses workspace root        | Each session can get its own worktree branch            |
| State         | No dedicated state file    | `.kilocode/agent-manager.json`                          |
| Terminals     | None                       | Dedicated VS Code terminal per session                  |
| Setup scripts | None                       | Configurable `.kilocode/setup-script` runs per worktree |
| Multi-version | Not supported              | Up to 4 parallel worktrees with the same prompt         |

### Architecture

All Agent Manager sessions share the **single `kilo serve` process** managed by `KiloConnectionService`. No separate server is spawned per session. Session isolation comes from directory scoping — worktree sessions pass the worktree path to the CLI backend, which creates a session scoped to that directory.

Extension-side code lives in `src/agent-manager/`, webview code in `webview-ui/agent-manager/`. The webview reuses the sidebar's provider chain and `ChatView` component, adding a `WorktreeModeProvider` and a split layout.

## Webview UI (kilo-ui)

New webview features must use **`@kilocode/kilo-ui`** components instead of raw HTML elements with inline styles. This is a Solid.js component library built on `@kobalte/core`.

- Import via deep subpaths: `import { Button } from "@kilocode/kilo-ui/button"`
- Available components include `Button`, `IconButton`, `Dialog`, `Spinner`, `Card`, `Tabs`, `Tooltip`, `Toast`, `Code`, `Markdown`, and more
- Provider hierarchy in [`App.tsx`](webview-ui/src/App.tsx:113): `ThemeProvider → I18nProvider → DialogProvider → MarkedProvider → VSCodeProvider → ServerProvider → ProviderProvider → SessionProvider`
- Global styles imported via `import "@kilocode/kilo-ui/styles"` in [`index.tsx`](webview-ui/src/index.tsx:2)
- [`chat.css`](webview-ui/src/styles/chat.css) is being progressively migrated — when replacing a component with kilo-ui, remove the corresponding CSS rules from it
- New CSS for components not yet in kilo-ui goes into `chat.css` grouped by comment-delimited sections (`/* Component Name */`). Once a kilo-ui equivalent exists, remove the section.
- **Check the desktop app first**: [`packages/app/src/`](../../packages/app/src/) is the reference implementation for how kilo-ui components are composed together. Always check how the app uses a component before implementing it in the webview — don't just look at the component API in isolation.
- **`data-component` and `data-slot` attributes carry CSS styling** — kilo-ui uses `[data-component]` and `[data-slot]` attribute selectors, not class names. When the app uses e.g. `data-component="permission-prompt"` and `data-slot="permission-actions"`, these get kilo-ui styling for free.
- **Prefer kilo-ui styles**: Always reuse existing kilo-ui CSS variables, tokens, and component styles instead of writing custom CSS. If a style doesn't exist in kilo-ui yet, add it there and reuse it rather than inlining or duplicating styles in the webview.
- **Icons**: kilo-ui has 75+ custom SVG icons in [`packages/ui/src/components/icon.tsx`](../../packages/ui/src/components/icon.tsx). To list all available icon names: `node -e "const c=require('fs').readFileSync('../../packages/ui/src/components/icon.tsx','utf8');[...c.matchAll(/^\\s{2}[\"']?([\\w-]+)[\"']?:\\s*\x60/gm)].map(m=>m[1]).sort().forEach(n=>console.log(n))"`. Icon names use both hyphenated (`arrow-left`) and bare-word (`brain`, `console`, `providers`) keys.

## Debugging

- Extension logs: "Extension Host" output channel (not Debug Console)
- Webview logs: Command Palette → "Developer: Open Webview Developer Tools"
- All debug output must be prepended with `[Kilo New]` for easy filtering

## Naming Conventions

- All VSCode commands must use `kilo-code.new.` prefix (not `kilo-code.`)
- All view IDs must use `kilo-code.new.` prefix (e.g., `kilo-code.new.sidebarView`)

## Coexistence with Old Extension

While the old extension coexists, runtime labels append `(NEW)` — controlled by the flag in [`constants.ts`](src/constants.ts). Static labels in `package.json` must be updated separately. Remove this convention once the old extension is retired.

## Kilocode Change Markers

This package is entirely Kilo-specific — `kilocode_change` markers are NOT needed in any files under `packages/kilo-vscode/`. The markers are only necessary when modifying shared upstream opencode files.

## Style

Follow monorepo root AGENTS.md style guide:

- Prefer `const` over `let`, early returns over `else`
- Single-word variable names when possible
- Avoid `try`/`catch`, avoid `any` type
- ESLint enforces: curly braces, strict equality, semicolons, camelCase/PascalCase imports

## Markdown Tables

Do not pad markdown table cells for column alignment. Use `| content |` with single spaces, not `| content       |` with extra padding. Padding creates spurious diffs. Markdown files are excluded from prettier (via `.prettierignore`) to prevent auto-reformatting of tables.

## Committing

- Before committing, always run `bun run format` so commits don't accidentally include formatting/styling-only diffs.
