# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Package Context

VSCode extension for Kilo Code. Part of a Bun/Turbo monorepo using Bun workspace dependencies.

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

The extension bundles a CLI backend binary. To build it:

```bash
bun script/local-bin.ts
```

Or use `--force` to rebuild:

```bash
bun script/local-bin.ts --force
```

The script automatically handles building the opencode package if needed.

## Architecture (Non-Obvious)

- Two separate esbuild builds in [`esbuild.js`](esbuild.js): extension (Node/CJS) and webview (browser/IIFE)
- Webview uses **Solid.js** (not React) - JSX compiles via `esbuild-plugin-solid`
- Extension code in `src/`, webview code in `webview-ui/src/` with separate tsconfig
- Tests compile to `out/` via `compile-tests`, not `dist/`
- CSP requires nonce for scripts and `font-src` for bundled fonts - see [`KiloProvider.ts`](src/KiloProvider.ts:777)
- HTML root has `data-theme="kilo-vscode"` to activate kilo-ui's VS Code theme bridge
- Extension and webview have no shared state - communicate via `vscode.Webview.postMessage()`
- For editor panels, use [`AgentManagerProvider`](src/agent-manager/AgentManagerProvider.ts) pattern with `retainContextWhenHidden: true`
- The Agent Manager is a multi-session parallel agent runner — see [`docs/agent-manager/AGENTS.md`](docs/agent-manager/AGENTS.md) for full context and [`docs/agent-manager/`](docs/agent-manager/) for feature specs
- esbuild webview build includes [`cssPackageResolvePlugin`](esbuild.js:29) for CSS `@import` resolution and font loaders (`.woff`, `.woff2`, `.ttf`)
- [`KiloConnectionService`](src/services/cli-backend/connection-service.ts) is the shared singleton managing server lifecycle, HTTP, SSE — sidebar and editor tabs share one instance
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

## Shared Connection Architecture

- [`KiloConnectionService`](src/services/cli-backend/connection-service.ts) is the shared singleton managing server lifecycle, HTTP client, and SSE connection
- Multiple `KiloProvider` instances (sidebar + editor tabs) subscribe via `onEvent()` / `onStateChange()`
- Each `KiloProvider` tracks its own session IDs via a `trackedSessionIds` Set
- SSE events are filtered per-webview using `onEventFiltered()` so tabs only see their own sessions
- `KiloProvider.dispose()` only unsubscribes from the service; `KiloConnectionService.dispose()` kills the server
- Session→message mapping (`recordMessageSessionId`) enables resolving `message.part.updated` events to the correct session

## Webview UI (kilo-ui)

New webview features must use **`@kilocode/kilo-ui`** components instead of raw HTML elements with inline styles. This is a Solid.js component library built on `@kobalte/core`.

- Import via deep subpaths: `import { Button } from "@kilocode/kilo-ui/button"`
- Available components include `Button`, `IconButton`, `Dialog`, `Spinner`, `Card`, `Tabs`, `Tooltip`, `Toast`, `Code`, `Markdown`, and more — see the [component migration table](docs/ui-implementation-plan.md#6-component-migration-reference-table) for the full list
- Provider hierarchy in [`App.tsx`](webview-ui/src/App.tsx:113): `ThemeProvider → I18nProvider → DialogProvider → MarkedProvider → VSCodeProvider → ServerProvider → ProviderProvider → SessionProvider`
- Global styles imported via `import "@kilocode/kilo-ui/styles"` in [`index.tsx`](webview-ui/src/index.tsx:2)
- [`chat.css`](webview-ui/src/styles/chat.css) is being progressively migrated — when replacing a component with kilo-ui, remove the corresponding CSS rules from it
- New CSS for components not yet in kilo-ui goes into `chat.css` grouped by comment-delimited sections (`/* Component Name */`). Once a kilo-ui equivalent exists, remove the section.
- See [`docs/ui-implementation-plan.md`](docs/ui-implementation-plan.md) for the full migration plan and phased rollout
- **Check the desktop app first**: [`packages/app/src/`](../../packages/app/src/) is the reference implementation for how kilo-ui components are composed together. Always check how the app uses a component before implementing it in the webview — don't just look at the component API in isolation.
- **`data-component` and `data-slot` attributes carry CSS styling** — kilo-ui uses `[data-component]` and `[data-slot]` attribute selectors, not class names. When the app uses e.g. `data-component="permission-prompt"` and `data-slot="permission-actions"`, these get kilo-ui styling for free.
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
