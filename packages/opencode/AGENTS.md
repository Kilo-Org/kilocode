# opencode agent guidelines

## Build/Test

- **Run**: `bun run --conditions=browser ./src/index.ts`
- **Test**: `bun test` (all tests) or `bun test test/tool/tool.test.ts` (single test)
- **Typecheck**: `bun run typecheck` (runs `tsgo --noEmit`)

## Import Aliases

- `@/*` maps to `./src/*`
- `@tui/*` maps to `./src/cli/cmd/tui/*`

## Key Patterns

**Namespace modules** -- Code is organized as TypeScript namespaces, not classes. Each module exports a namespace with its Zod schemas, types, and functions:

```ts
export namespace Session {
  export const Info = z.object({ ... })
  export type Info = z.infer<typeof Info>
  export const create = fn(z.object({ ... }), async (input) => { ... })
}
```

**`Instance.state(init, dispose?)`** -- Per-project lazy singleton. Many modules register state this way. The state is tied to the project directory via `AsyncLocalStorage`:

```ts
const state = Instance.state(async () => {
  // initialized once per project, cached
  return { ... }
})
// later: (await state()).someValue
```

**`fn(schema, callback)`** -- Wraps functions with Zod input validation. Used for most exported functions:

```ts
export const get = fn(z.object({ id: z.string() }), async (input) => { ... })
```

**`Tool.define(id, init)`** -- All tools follow this pattern. The `init` returns `{ description, parameters, execute }`. Output is auto-truncated.

**`BusEvent.define(type, schema)` + `Bus.publish()`** -- In-process pub/sub event system for cross-module communication.

**`NamedError.create(name, schema)`** -- Structured errors with Zod schemas. Prefer these over throwing raw errors.

**`iife()`** -- Immediately-invoked function expression helper. Used to avoid `let` statements per style guide.

**Logging** -- Use `Log.create({ service: "name" })` pattern.

## Process Spawning (Windows)

On Windows, any `spawn`/`execFile` call without `windowsHide: true` will flash a cmd.exe console window at the user. Use `Process.spawn` from `src/util/process.ts` — it enforces `windowsHide: true` automatically. For `Bun.spawn`/`Bun.spawnSync`, pass `windowsHide` via the options object if the subprocess could create a visible console.

The MCP `StdioClientTransport` (third-party SDK) is handled separately via a process shim in `src/mcp/index.ts` that sets `process.type = "browser"` when running inside the VS Code extension (`KILO_PLATFORM=vscode`), which causes the SDK's internal `isElectron()` check to return `true` and enable `windowsHide`.

## Storage

Filesystem-based JSON, not a database. Data lives in `~/.local/share/kilo/storage/`. Keys are path arrays: `Storage.write(["session", projectID, sessionID], data)`.

## TUI

Built with **SolidJS + OpenTUI** (`@opentui/solid`) -- a terminal UI framework. JSX renders to the terminal using elements like `<box>`, `<text>`, `<scrollbox>`. The TUI communicates with the server via `@kilocode/sdk`.

## Server

Hono-based HTTP server with OpenAPI spec generation. SSE for real-time events. When you add/change routes, regenerate the SDK (see root AGENTS.md for the command).

## Providers and Models

Uses the **Vercel AI SDK** as the abstraction layer. Providers are loaded from a bundled map or dynamically installed at runtime. Models come from models.dev (external API), cached locally.
