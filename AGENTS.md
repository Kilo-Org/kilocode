# AGENTS.md

Kilo CLI is an open source AI coding agent that generates code from natural language, automates tasks, and supports 500+ AI models.

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `main`.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.
- You may be running in a git worktree. All changes must be made in your current working directory — never modify files in the main repo checkout.

## Build and Dev

- **Dev**: `bun run dev` (runs from root) or `bun run --cwd packages/opencode --conditions=browser src/index.ts`
- **Dev with params**: `bun dev -- help`
- **Extension**: `bun run extension` (build + launch VS Code with the extension in dev mode). Pass `--no-build` to skip the build.
- **Typecheck**: `bun turbo typecheck` (uses `tsgo`, not `tsc`)
- **Test**: `bun test` from `packages/opencode/` (NOT from root -- root blocks tests)
- **Single test**: `bun test test/tool/tool.test.ts` from `packages/opencode/`
- **SDK regen**: After changing server endpoints in `packages/opencode/src/server/`, run `./script/generate.ts` from root to regenerate `packages/sdk/js/`
- **Knip** (unused exports): `bun run knip` from `packages/kilo-vscode/`. CI runs this — all exported types/functions must be imported somewhere. Remove or unexport unused exports before pushing.
- **Source links**: After adding or changing URLs in `packages/kilo-vscode/`, `packages/kilo-vscode/webview-ui/`, or `packages/opencode/src/`, run `bun run script/extract-source-links.ts` from the repo root and commit the updated `packages/kilo-docs/source-links.md`. CI runs this check — the build fails if the file is stale.
- **kilocode_change check**: `bun run check-kilocode-change` from `packages/kilo-vscode/`. CI runs this — `kilocode_change` is a marker for upstream merge conflicts and must not appear in `packages/kilo-vscode/` or `packages/kilo-ui/` (these are entirely Kilo Code additions). Remove the markers before pushing.
- **opencode annotation check**: `bun run script/check-opencode-annotations.ts` from repo root. CI runs this on PRs touching `packages/opencode/` — every Kilo-specific change in shared opencode files must be annotated with `kilocode_change` markers. Exempt paths (no markers needed): `packages/opencode/src/kilocode/`, `packages/opencode/test/kilocode/`, and any path containing `kilocode` in the name.

## Products

All products are clients of the **CLI** (`packages/opencode/`), which contains the AI agent runtime, HTTP server, and session management. Each client spawns or connects to a `kilo serve` process and communicates via HTTP + SSE using `@kilocode/sdk`.

| Product                | Package                 | Description                                                                                                                                                                          |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kilo CLI               | `packages/opencode/`    | Core engine. TUI, `kilo run`, `kilo serve`, `kilo web`. Fork of upstream OpenCode.                                                                                                   |
| Kilo VS Code Extension | `packages/kilo-vscode/` | VS Code extension. Bundles the CLI binary, spawns `kilo serve` as a child process. Includes the **Agent Manager** — a multi-session orchestration panel with git worktree isolation. |
| OpenCode Desktop       | `packages/desktop/`     | Standalone Tauri native app. Bundles CLI as sidecar. Single-session UI. Unrelated to the VS Code extension. Not actively maintained — synced from upstream fork.                     |
| OpenCode Web           | `packages/app/`         | Shared SolidJS frontend used by both the desktop app and `kilo web` CLI command. Not actively maintained — synced from upstream fork.                                                |

**Agent Manager** refers to a feature inside `packages/kilo-vscode/` (extension code in `src/agent-manager/`, webview in `webview-ui/agent-manager/`). It is not a standalone product. See the extension's `AGENTS.md` for details.

## Monorepo Structure

Turborepo + Bun workspaces. The packages you'll work with most:

| Package                    | Name                       | Purpose                                                                                    |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/opencode/`       | `@kilocode/cli`            | Core CLI -- agents, tools, sessions, server, TUI. This is where most work happens.         |
| `packages/sdk/js/`         | `@kilocode/sdk`            | Auto-generated TypeScript SDK (client for the server API). Do not edit `src/gen/` by hand. |
| `packages/kilo-vscode/`    | `kilo-code`                | VS Code extension with sidebar chat + Agent Manager. See its own `AGENTS.md` for details.  |
| `packages/kilo-gateway/`   | `@kilocode/kilo-gateway`   | Kilo auth, provider routing, API integration                                               |
| `packages/kilo-telemetry/` | `@kilocode/kilo-telemetry` | PostHog analytics + OpenTelemetry                                                          |
| `packages/kilo-i18n/`      | `@kilocode/kilo-i18n`      | Internationalization / translations                                                        |
| `packages/kilo-ui/`        | `@kilocode/kilo-ui`        | SolidJS component library shared by the extension webview and `packages/app/`              |
| `packages/app/`            | `@opencode-ai/app`         | Shared SolidJS web UI for desktop app and `kilo web`                                       |
| `packages/desktop/`        | `@opencode-ai/desktop`     | Tauri desktop app shell                                                                    |
| `packages/util/`           | `@opencode-ai/util`        | Shared utilities (error, path, retry, slug, etc.)                                          |
| `packages/plugin/`         | `@kilocode/plugin`         | Plugin/tool interface definitions                                                          |

## Style Guide

- Keep things in one function unless composable or reusable
- Avoid unnecessary destructuring. Instead of `const { a, b } = obj`, use `obj.a` and `obj.b` to preserve context
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity

### Avoid let statements

We don't like `let` statements, especially combined with if/else statements.
Prefer `const`.

Good:

### Naming Enforcement (Read This)

THIS RULE IS MANDATORY FOR AGENT WRITTEN CODE.

- Use single word names by default for new locals, params, and helper functions.
- Multi-word names are allowed only when a single word would be unclear or ambiguous.
- Do not introduce new camelCase compounds when a short single-word alternative is clear.
- Before finishing edits, review touched lines and shorten newly introduced identifiers where possible.
- Good short names to prefer: `pid`, `cfg`, `err`, `opts`, `dir`, `root`, `child`, `state`, `timeout`.
- Examples to avoid unless truly required: `inputPID`, `existingClient`, `connectTimeout`, `workerPath`.

```ts
const foo = condition ? 1 : 2
```

Bad:

```ts
let foo

if (condition) foo = 1
else foo = 2
```

### Avoid else statements

Prefer early returns or using an `iife` to avoid else statements.

Good:

```ts
function foo() {
  if (condition) return 1
  return 2
}
```

Bad:

```ts
function foo() {
  if (condition) return 1
  else return 2
}
```

### No empty catch blocks

Never leave a `catch` block empty. An empty `catch` silently swallows errors and hides bugs. If you're tempted to write one, ask yourself:

1. Is the `try`/`catch` even needed? (prefer removing it)
2. Should the error be handled explicitly? (recover, retry, rethrow)
3. At minimum, log it so failures are visible

Good:

```ts
try {
  await save(data)
} catch (err) {
  log.error("save failed", { err })
}
```

Bad:

```ts
try {
  await save(data)
} catch {}
```

### Prefer single word naming

Try your best to find a single word name for your variables, functions, etc.
Only use multiple words if you cannot.

Good:

```ts
const foo = 1
const bar = 2
const baz = 3
```

Bad:

```ts
const fooBar = 1
const barBaz = 2
const bazFoo = 3
```

## Testing

You MUST avoid using `mocks` as much as possible.
Tests MUST test actual implementation, do not duplicate logic into a test.

## Commit Conventions

[Conventional Commits](https://www.conventionalcommits.org/) with scopes matching packages: `vscode`, `cli`, `agent-manager`, `sdk`, `ui`, `i18n`, `kilo-docs`, `gateway`, `telemetry`, `desktop`. Omit scope when spanning multiple packages.

## Pull Requests

PR descriptions should be 2-3 lines covering **what** changed and **why**. Focus on intent and context a reviewer can't get from the diff — skip file-by-file inventories, test result summaries, and anything obvious from the code itself.

## Fork Merge Process

Kilo CLI is a fork of [opencode](https://github.com/anomalyco/opencode).

**Very important**: when planning or coding, update shared files with OpenCode as last resort! Everything is shared code from OpenCode, except folders that contain `kilo` in the name or have a parent directory that contains `kilo` in the name. Example of kilo specific folders: `packages/opencode/src/kilocode/` and `packages/kilo-docs/`. Always look for ways to implement your feature or fix in a way that minimizes changes to shared code.

### Minimizing Merge Conflicts

We regularly merge upstream changes from opencode. To minimize merge conflicts and keep the sync process smooth:

1. **Prefer `kilocode` directories** - Place Kilo-specific code in dedicated directories whenever possible:
   - `packages/opencode/src/kilocode/` - Kilo-specific source code
   - `packages/opencode/test/kilocode/` - Kilo-specific tests
   - `packages/kilo-gateway/` - The Kilo Gateway package

2. **Minimize changes to shared files** - When you must modify files that exist in upstream opencode, keep changes as small and isolated as possible.

3. **Use `kilocode_change` markers** - When modifying shared code, mark your changes with `kilocode_change` comments so they can be easily identified during merges.
   Do not use these markers in files within directories with kilo in the name

4. **Avoid restructuring upstream code** - Don't refactor or reorganize code that comes from opencode unless absolutely necessary.

The goal is to keep our diff from upstream as small as possible, making regular merges straightforward and reducing the risk of conflicts.

### Kilocode Change Markers

To minimize merge conflicts when syncing with upstream, mark Kilo Code-specific changes in shared code with `kilocode_change` comments.

**Single line:**

```typescript
const value = 42 // kilocode_change
```

**Multi-line:**

```typescript
// kilocode_change start
const foo = 1
const bar = 2
// kilocode_change end
```

**New files:**

```typescript
// kilocode_change - new file
```

<!-- prettier-ignore -->
**JSX/TSX (inside JSX templates):**

<!-- prettier-ignore -->
```tsx
{/* kilocode_change */}
```

<!-- prettier-ignore -->
```tsx
{/* kilocode_change start */}
<MyComponent />
{/* kilocode_change end */}
```

#### When markers are NOT needed

Code in these paths is Kilo Code-specific and does NOT need `kilocode_change` markers:

- `packages/opencode/src/kilocode/` - All files in this directory
- `packages/opencode/test/kilocode/` - All test files for kilocode
- Any other path containing `kilocode` in filename or directory name

These paths are entirely Kilo Code additions and won't conflict with upstream.
