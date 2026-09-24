---
title: "Plugins"
description: "Extend the Kilo CLI with custom hooks, tools, auth providers, and more"
platform: new
---

# Plugins

Plugins extend Kilo by hooking into events, adding custom tools, registering auth or model providers, and customizing runtime behavior. They are TypeScript or JavaScript modules loaded at startup, and work in both the Kilo CLI and the VS Code extension.

## What plugins can do

- **Add custom tools** the model can call (like `read`, `write`, `bash`).
- **Intercept tool calls** to mutate arguments, rewrite output, or block dangerous operations.
- **Subscribe to events** — sessions, messages, permissions, LSP diagnostics, file changes, etc.
- **Register auth providers** — OAuth or API-key flows for model providers.
- **Register model providers** — dynamic model catalogs.
- **Mutate chat parameters or headers** sent to the LLM.
- **Customize compaction** — inject or replace the prompt used when a session is compacted.
- **Inject shell environment variables** for commands executed by the agent or user.

---

## Use a plugin

You can load plugins in several ways.

### Install from the Marketplace

Plugins appear in the **Marketplace** panel in the VS Code extension. Select a plugin, then choose a scope:

- **Project** adds the plugin to the `plugin` array in the project config file.
- **Global** adds the plugin to the `plugin` array in your user config file.

The install dialog shows the destination before it changes anything. You can install registry plugins and git-hosted plugins in the same way.

### From a config file

Add an array of plugin specifiers to your config file:

```json
{
  "$schema": "https://app.kilo.ai/config.json",
  "plugin": [
    "@your-org/your-plugin",
    "your-plugin@1.2.3",
    ["your-plugin", { "apiKey": "{env:MY_API_KEY}" }],
    "./plugins/local.ts",
    "file:///abs/path/plugin.ts",
    "git:github.com/owner/repo@v1.2.3"
  ]
}
```

Each entry can be:

| Form | Loaded from |
|---|---|
| `"package-name"` | Latest version from npm |
| `"package-name@1.2.3"` | Pinned version from npm |
| `["package-name", { options }]` | npm package with options passed to the plugin function |
| `"./path/plugin.ts"` / `"file:///..."` | Local file (relative to the config file or absolute `file:` URL) |
| `"git:github.com/owner/repo@v1.2.3#subdir"` | Git repository, cloned at the pinned ref into the plugin cache |

Git specifiers work in the config array and with the `kilo plugin` command, the same as npm and local plugins. See [Publish your plugin to the Marketplace](#publish-your-plugin-to-the-marketplace) for the full git spec grammar.

A git specifier's repository can also be a local repository. Use an absolute path, a `~/` home path, a `./` or `../` relative path, or a `file:` URL — for example `git:~/repos/my-plugin` or `git:file:///opt/plugins/my-plugin`. Kilo clones the local repository into the plugin cache instead of fetching it from a remote host.

Config files live in the same locations as the rest of your CLI configuration — see the [CLI configuration reference](/docs/code-with-ai/platforms/cli#configuration).

### From a plugin directory

Drop TypeScript or JavaScript files into a `plugin/` or `plugins/` folder inside any config directory:

- Global: `~/.config/kilo/plugin/`
- Project: `.kilo/plugin/` or legacy `.kilocode/plugin/`

Every `.ts` or `.js` file in those directories is auto-registered at startup — no need to list them in the config file.

```text
my-project/
├── kilo.json
└── .kilo/
    └── plugin/
        ├── env-guard.ts
        └── notifications.ts
```

### From the `kilo plugin` command

Install an npm plugin and patch your config in one step:

```bash
# Install into the current project's config
kilo plugin my-plugin

# Install into your global config
kilo plugin my-plugin --global

# Replace an existing entry
kilo plugin my-plugin --force
```

The command resolves the package, reads its `package.json` for plugin entrypoints, and writes the entry into the appropriate config file (`.kilo/opencode.jsonc` / `.kilo/tui.jsonc` for local installs, or `~/.config/kilo/opencode.jsonc` / `~/.config/kilo/tui.jsonc` for `--global`) while preserving JSONC comments.

### How plugins are installed

- **npm plugins** are installed automatically at startup using Bun. Packages and their dependencies are cached under `packages/` in the current CLI XDG cache directory (`~/.cache/opencode/packages/` by default, or `$XDG_CACHE_HOME/opencode/packages/` when `XDG_CACHE_HOME` is set).
- **Pinned npm versions** like `my-plugin@1.2.3` install that exact version and do not check for newer registry versions. Bare package names resolve to `latest` and can refresh when the cached copy becomes stale.
- **Install scripts are disabled** for npm plugins. Kilo installs packages with lifecycle scripts such as `install` and `postinstall` blocked.
- **Local plugins** are loaded directly from the plugin directory. If your plugin imports external packages, add a `package.json` to your config directory (see [Dependencies](#dependencies)) — Kilo runs `bun install` on startup so imports resolve.

### Load order

Plugins from all sources run on every session. They load in this order:

1. Internal built-ins (Kilo Gateway auth, Codex auth, Copilot auth, Cloudflare, etc.)
2. Global config plugin array (`~/.config/kilo/kilo.json`)
3. Global plugin directory (`~/.config/kilo/plugin/`)
4. Project config plugin array (`kilo.json` / `opencode.json`)
5. Project plugin directory (`.kilo/plugin/` and friends)

Duplicates (same package, same version) are deduplicated. Hooks from multiple plugins run sequentially in load order.

### Disabling external plugins

Set the `KILO_PURE=1` environment variable to skip all external plugins — only built-in plugins will load. Useful for reproducible CI runs or debugging.

---

## Create a plugin

A plugin is a module that exports a function returning a set of [hooks](#hooks-reference).

### Basic structure

Create a file in your plugin directory:

```ts
// .kilo/plugin/hello.ts
import type { Plugin } from "@kilocode/plugin"

const hello: Plugin = async ({ project, client, $, directory, worktree }) => {
  console.log("hello plugin loaded")

  return {
    // hook implementations go here
  }
}

export default { id: "hello", server: hello }
```

The plugin function receives a context object:

| Field | Description |
|---|---|
| `project` | Current project metadata. |
| `directory` | Current working directory for this session. |
| `worktree` | Git worktree root for this session. |
| `client` | A Kilo SDK client (`@kilocode/sdk`) for calling the local server. |
| `$` | [Bun's shell API](https://bun.com/docs/runtime/shell). |
| `serverUrl` | URL of the local Kilo server. |
| `experimental_workspace` | Register workspace adaptors (used by Agent Manager). |

The function returns a `Hooks` object. Any second argument is the options object passed via config (e.g. the `{ apiKey: "..." }` from `["my-plugin", { apiKey: "..." }]`).

### Register workspace adaptors

Workspace adaptors let plugins add custom workspace targets to Kilo's workspace creation flow. This API is experimental and may change.

```ts
import type { Plugin } from "@kilocode/plugin"
import { mkdir, rm } from "node:fs/promises"

const WorkspacePlugin: Plugin = async ({ experimental_workspace }) => {
  experimental_workspace.register("folder", {
    name: "Folder",
    description: "Create a blank folder",
    configure(config) {
      return { ...config, directory: `/tmp/kilo-${Date.now()}` }
    },
    async create(config) {
      await mkdir(config.directory!, { recursive: true })
    },
    async remove(config) {
      await rm(config.directory!, { recursive: true, force: true })
    },
    target(config) {
      return { type: "local", directory: config.directory! }
    },
  })

  return {}
}

export default { id: "workspace-folder", server: WorkspacePlugin }
```

An adaptor implements `configure(config)`, `create(config, env, from?)`, `remove(config)`, and `target(config)`. `target` returns either `{ type: "local", directory }` for a local workspace or `{ type: "remote", url, headers? }` for a remote workspace endpoint.

### Module shape

Plugins must default-export a module descriptor. `id` is required for local-file plugins and inferred from `package.json#name` for npm plugins.

```ts
import type { Plugin } from "@kilocode/plugin"

const server: Plugin = async (ctx) => ({
  /* hooks */
})

export default {
  id: "my-plugin",
  server,
}
```

An npm plugin can also expose a TUI entry point (`tui`) for [TUI plugins](#tui-plugins), but `server` and `tui` are separate modules.

### Package manifest for npm plugins

Published npm plugins should declare separate package entrypoints for each runtime they support. Kilo detects install targets from `package.json`:

- `exports["./server"]` marks the package as a server plugin.
- `exports["./tui"]` marks the package as a TUI plugin.
- `main` is a server-only fallback when `exports` is not used.
- `oc-themes` marks a package as a TUI theme package, even when it has no `./tui` export.

```json
{
  "name": "@acme/kilo-plugin",
  "type": "module",
  "main": "./dist/server.js",
  "exports": {
    "./server": {
      "import": "./dist/server.js",
      "config": { "apiKey": "{env:ACME_API_KEY}" }
    },
    "./tui": {
      "import": "./dist/tui.js",
      "config": { "compact": true }
    }
  },
  "engines": {
    "opencode": "^1.0.0"
  }
}
```

The optional `config` object on an export becomes the default options tuple written to the user's config on first install. Keep server and TUI code in separate files; each runtime loads only the entrypoint that matches its target.

Theme-only packages can omit code entrypoints and provide package-relative theme files:

```json
{
  "name": "@acme/kilo-themes",
  "oc-themes": ["themes/acme-dark.json", "themes/acme-light.json"]
}
```

`oc-themes` entries must be relative paths inside the package. Absolute paths, `file://` URLs, and paths that escape the package directory are rejected. Installed theme packages sync their themes on first install and when the package changes.

### TypeScript support

Install the plugin package locally and import its types:

```bash
bun add -d @kilocode/plugin
```

```ts
import type { Plugin } from "@kilocode/plugin"
import { tool } from "@kilocode/plugin/tool"
```

Kilo automatically creates a `package.json` in config directories that contain a `plugin/` folder and installs `@kilocode/plugin` so types resolve out of the box.

### Engine compatibility

Declare a CLI version range to prevent a plugin from loading against an incompatible build:

```json
{
  "name": "my-plugin",
  "engines": { "opencode": "^7.0.0" }
}
```

If the running CLI does not satisfy the range, the plugin is skipped and a warning is surfaced.

### Dependencies

Local plugins and custom tools can use external npm packages. Add a `package.json` to your config directory:

```json
// .kilo/package.json
{
  "dependencies": {
    "shescape": "^2.1.0"
  }
}
```

Kilo runs `bun install` at startup so your plugins can import the packages:

```ts
// .kilo/plugin/escape-bash.ts
import { escape } from "shescape"
import type { Plugin } from "@kilocode/plugin"

const EscapeBash: Plugin = async () => ({
  "tool.execute.before": async (input, output) => {
    if (input.tool === "bash") {
      output.args.command = escape(output.args.command)
    }
  },
})

export default { id: "escape-bash", server: EscapeBash }
```

## Publish your plugin to the Marketplace

The [Kilo Marketplace](https://github.com/Kilo-Org/kilo-marketplace) lists plugins from two sources:

- **Registry plugins** are published to npm. Set the catalog `content` to the package name, for example `my-plugin` or `my-plugin@^1.2.0`.
- **Git-hosted plugins** live in a public git repository. Set the catalog `content` to a git spec.

A git spec uses this grammar:

```text
git:<repo>[@ref][#subpath]
```

- `repo` is `github.com/owner/repo` or a full URL with an `https`, `http`, `git`, or `ssh` scheme. The repo must not contain `@`.
- `ref` (optional) is a branch, tag, or commit after the last `@`.
- `subpath` (optional) is the plugin directory inside the repository, after the first `#`.

The catalog `id` must equal the plugin identity. For a registry plugin, use the npm package name. For a git plugin, use the normalized git identity: `git/` plus the repo without its scheme and without a trailing `.git`, plus the subpath when present. For example, `git:github.com/owner/repo@v1` has the id `git/github.com/owner/repo`.

Git plugins must be self-contained. Kilo clones the repository at the given ref and loads the plugin directly. It does not install npm dependencies for git plugins, so vendor any runtime dependencies into the repository.

The repository or package must contain a `package.json` that declares at least one supported target:

| Target | Manifest entry | Config |
|---|---|---|
| Server | `exports["./server"]`, or the legacy `main` entry | `opencode.json` |
| TUI | `exports["./tui"]`, or `oc-themes` for theme packages | `tui.json` |

For a plugin that supports both targets, use separate `./server` and `./tui` entry modules.

### Submit your plugin

1. Choose the source. Publish and test a registry plugin, or host a self-contained plugin in a public git repository.
2. Add a `PLUGIN.yaml` entry under `plugins/<id>/PLUGIN.yaml` in the [Kilo Marketplace repository](https://github.com/Kilo-Org/kilo-marketplace). The directory path must equal `id`.
3. Regenerate `plugins/marketplace.yaml` with the generator in the marketplace repository. Do not edit it manually.
4. Submit a pull request with the manifest and the regenerated catalog. Describe what the plugin does, its source, and which targets you tested.

See the [plugin README](https://github.com/Kilo-Org/kilo-marketplace/blob/main/plugins/README.md) for the `PLUGIN.yaml` fields and the generator commands, and the [contribution guidelines](https://github.com/Kilo-Org/kilo-marketplace/blob/main/CONTRIBUTING.md) for the review process.

---

## Hooks reference

Every hook is optional. Return only the ones you care about.

### Lifecycle

| Hook | Description |
|---|---|
| `config` | Receives the fully-resolved config at startup. Read-only — useful for inspection. |
| `event` | Called for **every** event on the internal bus (see [Events](#events)). |

### Tools

| Hook | Description |
|---|---|
| `tool` | Map of tool name → [tool definition](#custom-tools). Added tools are callable by the model. |
| `tool.execute.before` | Fires before a tool runs; you can mutate `output.args`. |
| `tool.execute.after` | Fires after a tool returns; you can rewrite `output.title`, `output.output`, `output.metadata`. |
| `tool.definition` | Mutate a tool's `description` and `parameters` before they are sent to the model. |

### Chat

| Hook | Description |
|---|---|
| `chat.message` | Fires when a new user message arrives. Inspect or modify `parts`. |
| `chat.params` | Mutate `temperature`, `topP`, `topK`, `maxOutputTokens`, provider `options`. |
| `chat.headers` | Add or replace HTTP headers on the LLM API call. |
| `permission.ask` | Auto-allow or auto-deny permission prompts. |
| `command.execute.before` | Intercept slash command execution; mutate the resulting `parts`. |
| `shell.env` | Inject environment variables into every shell command Kilo runs. |

### Providers & auth

| Hook | Description |
|---|---|
| `auth` | Register an auth method (OAuth or API key) for a provider, with interactive prompts. |
| `provider` | Dynamically supply a model catalog for a provider (useful for BYO-model gateways). |

Provider hooks can replace or refresh the model catalog for a provider. The hook receives the provider definition and auth context, and returns a map of model ID to model metadata:

```ts
import type { Plugin } from "@kilocode/plugin"

const ProviderPlugin: Plugin = async () => ({
  provider: {
    id: "my-gateway",
    async models(provider, { auth }) {
      const res = await fetch("https://gateway.example.com/models", {
        headers: auth?.type === "api" ? { Authorization: `Bearer ${auth.key}` } : {},
      })
      return await res.json()
    },
  },
})

export default { id: "my-provider", server: ProviderPlugin }
```

Kilo fills provider/model IDs from the returned catalog and uses the returned models in the picker and provider router.

### Experimental

These hooks live behind the `experimental.` prefix and may change between releases.

| Hook | Description |
|---|---|
| `experimental.chat.messages.transform` | Rewrite the full message history before it is sent to the model. |
| `experimental.chat.system.transform` | Modify the system prompt array. |
| `experimental.session.compacting` | Inject extra context (`output.context`) or replace the compaction prompt entirely (`output.prompt`). |
| `experimental.compaction.autocontinue` | Disable the synthetic "continue" turn that follows compaction. |
| `experimental.text.complete` | Post-process final text parts (e.g. append signatures, redact secrets). |

### Events

The `event` hook fires for every event on Kilo's internal bus. Common event types include:

- **Session**: `session.created`, `session.updated`, `session.idle`, `session.error`, `session.deleted`, `session.compacted`, `session.diff`, `session.status`
- **Message**: `message.updated`, `message.removed`, `message.part.updated`, `message.part.removed`
- **Tool**: `tool.execute.before`, `tool.execute.after`
- **Permission**: `permission.asked`, `permission.replied`
- **File**: `file.edited`, `file.watcher.updated`
- **Shell**: `shell.env`
- **Command**: `command.executed`
- **LSP**: `lsp.updated`, `lsp.client.diagnostics`
- **Todo**: `todo.updated`
- **Server**: `server.connected`
- **Installation**: `installation.updated`

```ts
const server: Plugin = async () => ({
  event: async ({ event }) => {
    if (event.type === "session.idle") {
      // session finished responding
    }
  },
})
```

---

## Custom tools

Plugins can register tools the model can call alongside the built-in ones. Use the `tool()` helper for type-safety:

```ts
// .kilo/plugin/database.ts
import type { Plugin } from "@kilocode/plugin"
import { tool } from "@kilocode/plugin/tool"

const DatabasePlugin: Plugin = async () => ({
  tool: {
    query: tool({
      description: "Run a read-only SQL query against the project database",
      args: {
        sql: tool.schema.string().describe("SQL query to execute"),
      },
      async execute(args, context) {
        const { directory, worktree } = context
        // your query logic here
        return `ran: ${args.sql}`
      },
    }),
  },
})

export default { id: "database", server: DatabasePlugin }
```

`args` uses a [Zod](https://zod.dev) schema via `tool.schema`. The tool's `execute` function receives:

- `args` — validated against your schema
- `context` — `{ sessionID, messageID, agent, directory, worktree, abort, metadata, ask }`

### Name precedence

If a custom tool uses the same name as a built-in tool, **the custom tool wins**. Prefer unique names unless you intentionally want to override a built-in (for example, to wrap `bash` with extra validation).

### Alternative: standalone tool files

For tools that don't need the full plugin context, drop them in a `tool/` or `tools/` folder inside any config directory — for example `.kilo/tool/database.ts` or `~/.config/kilo/tool/database.ts`. The filename becomes the tool name, and each file exports a `tool()` definition directly. The layout is identical to the [OpenCode custom tools guide](https://opencode.ai/docs/custom-tools); use `.kilo/`, or legacy `.kilocode/`, instead of `.opencode/`.

---

## Examples

### Configure CLI completion notifications

The CLI has built-in attention alerts for session completion, errors, and prompts that need input. You do not need a plugin or platform-specific notification command.

Configure the `attention` section of `tui.json` or `tui.jsonc` to enable notifications and sounds. See [CLI Notifications and Sounds](/docs/code-with-ai/platforms/cli#cli-notifications-and-sounds) for configuration and custom sound overrides.

### Block reads of `.env` files

```ts
// .kilo/plugin/env-guard.ts
import type { Plugin } from "@kilocode/plugin"

const EnvGuard: Plugin = async () => ({
  "tool.execute.before": async (input, output) => {
    if (input.tool === "read" && String(output.args.filePath).includes(".env")) {
      throw new Error("reading .env files is blocked")
    }
  },
})

export default { id: "env-guard", server: EnvGuard }
```

### Inject environment variables into every shell command

```ts
// .kilo/plugin/inject-env.ts
import type { Plugin } from "@kilocode/plugin"

const InjectEnv: Plugin = async () => ({
  "shell.env": async (input, output) => {
    output.env.MY_API_KEY = "secret"
    output.env.PROJECT_ROOT = input.cwd
  },
})

export default { id: "inject-env", server: InjectEnv }
```

### Structured logging

Prefer `client.app.log()` over `console.log` so entries land in Kilo's log pipeline:

```ts
import type { Plugin } from "@kilocode/plugin"

const Logger: Plugin = async ({ client }) => {
  await client.app.log({
    body: {
      service: "my-plugin",
      level: "info",
      message: "plugin initialized",
      extra: { version: "1.0.0" },
    },
  })
  return {}
}

export default { id: "logger", server: Logger }
```

Levels: `debug`, `info`, `warn`, `error`.

### Inject context during session compaction

```ts
// .kilo/plugin/compaction.ts
import type { Plugin } from "@kilocode/plugin"

const Compaction: Plugin = async () => ({
  "experimental.session.compacting": async (input, output) => {
    output.context.push(
      "## Persist across compaction\n- current task status\n- files being actively edited\n- key decisions",
    )
  },
})

export default { id: "compaction", server: Compaction }
```

Set `output.prompt` to replace the default compaction prompt entirely — when present, `output.context` is ignored.

### Stop auto-continuing after compaction

By default, Kilo sends a synthetic "continue" turn after compaction so the agent resumes the interrupted task. Use `experimental.compaction.autocontinue` to disable that turn for specific sessions or providers:

```ts
const CompactionStop: Plugin = async () => ({
  "experimental.compaction.autocontinue": async (input, output) => {
    if (input.overflow) output.enabled = false
  },
})
```

The hook receives the `sessionID`, `agent`, `model`, `provider`, compacted `message`, and whether the compaction was caused by context overflow. `output.enabled` defaults to `true`.

---

## TUI plugins

Plugins can also target the Kilo TUI itself — registering slash commands, routes, slots, dialogs, and keybinds. TUI plugins are SolidJS modules exported from `"./tui"` in your plugin package, or theme-only packages declared with `oc-themes`.

TUI plugins live in a separate module namespace (`@kilocode/plugin/tui`) and have their own API surface (`TuiPluginApi`). Because the TUI API is larger and still evolving, this guide doesn't cover it exhaustively — use the types in `@kilocode/plugin/tui` as the reference, and look at the built-in TUI plugins under `packages/opencode/src/cli/cmd/tui/feature-plugins/` for working examples.

Common TUI APIs include:

- `api.command.register(...)` to add commands and `api.command.show()` to open the command palette.
- `api.ui.Slot` to render a host slot or a custom plugin slot.
- `api.slots.register(...)` to define reusable custom slots for other plugins.
- `api.ui.Prompt` to render prompt components in prompt replacement slots.

Host slots include `home_prompt_right`, `session_prompt`, `session_prompt_right`, and `home_footer`. The `session_prompt` slot replaces the default session prompt, while the `*_prompt_right` slots add controls next to the prompt metadata row.

---

## Troubleshooting

- **Plugin failed to load** — check the CLI logs with `kilo --print-logs --log-level DEBUG`. Load failures are also surfaced as session errors in the TUI and VS Code extension.
- **Plugin loaded but hooks never fire** — make sure the default export includes `server`:

  ```ts
  export default { id: "my-plugin", server }
  ```

  Named function exports are also accepted for backwards compatibility but should be considered legacy.

- **Package installed but not active in one runtime** — make sure the package exposes the matching entrypoint. Server plugins need `exports["./server"]` or `main`; TUI plugins need `exports["./tui"]` or valid `oc-themes`. Packages that only support the other runtime are skipped with a warning instead of causing a fatal load error.

- **Local plugin can't find an npm import** — add a `package.json` in the config directory so `bun install` picks up the dependency (see [Dependencies](#dependencies)).
- **Plugin loads in dev but not in CI** — verify `KILO_PURE` is not set, and that npm-installed plugins are cached under `packages/` in the current CLI XDG cache directory (`~/.cache/opencode/packages/` by default, or `$XDG_CACHE_HOME/opencode/packages/` when `XDG_CACHE_HOME` is set). Run with `--log-level DEBUG` to see install output.
- **Reset the plugin cache** — delete the plugin package folder under the CLI's `packages/` cache directory (or the `node_modules` cache under your config directory) and restart Kilo.

---

## Reference

- Types: [`@kilocode/plugin`](https://github.com/Kilo-Org/kilocode/tree/main/packages/plugin) — `Plugin`, `Hooks`, `PluginInput`, `ToolDefinition`, `AuthHook`, `ProviderHook`.
- Example plugin: [`packages/plugin/src/example.ts`](https://github.com/Kilo-Org/kilocode/blob/main/packages/plugin/src/example.ts)
- CLI command: [`kilo plugin`](/docs/code-with-ai/platforms/cli-reference#kilo-plugin)
- Upstream docs (behavior is identical to OpenCode): [opencode.ai/docs/plugins](https://opencode.ai/docs/plugins) and [opencode.ai/docs/custom-tools](https://opencode.ai/docs/custom-tools)
