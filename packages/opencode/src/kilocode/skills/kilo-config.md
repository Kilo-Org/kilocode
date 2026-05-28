# Kilo CLI Configuration Reference

All config lives in `kilo.json` (or `kilo.jsonc`). Precedence low-to-high: remote well-known, global (`~/.config/kilo/kilo.json`), env `KILO_CONFIG`, project `./kilo.json`, `.kilo/kilo.json`, `KILO_CONFIG_CONTENT`, managed (see Config File Locations). Deep-merged; later wins.

This also covers where Kilo looks for config files, commands, agents, and skills across project, global, and legacy paths such as `.kilo/`, `.kilocode/`, `.opencode/`, and `~/.config/kilo/`, plus Agent Manager setup/run scripts in the VS Code extension.

## Commands (`.kilo/command/*.md`)

Markdown files with YAML frontmatter. The filename (minus `.md`) becomes the command name invoked via `/name`. Commands can live in `.kilo/`, `.kilocode/`, `.opencode/`, and global config roots, with both `command/` and `commands/` directory names supported. See Config File Locations for the full search order.

```yaml
---
description: Run tests # optional, shown in command list
agent: code # optional, route to a specific agent
model: anthropic/claude-sonnet # optional, override model
subtask: true # optional, run as subtask
---
Run all tests in $1 and fix failures.
Use $ARGUMENTS for the full arg string.
Reference files with @file and shell output with !`cmd`.
```

Template variables: `$1`-`$N` (positional args), `$ARGUMENTS` (full string), `@file` (file contents), `` !`cmd` `` (shell output).

### Finding a named command

When asked where `/name` lives, do not search only the repo root. Search these roots explicitly, and use an explicit search `path` for each one:

1. `~/.config/kilo/`
2. `~/.kilo/`
3. `~/.kilocode/`
4. `~/.opencode/`
5. The `KILO_CONFIG_DIR` directory (if the env var is set)
6. project `.kilo/`, `.kilocode/`, and `.opencode/` directories from the current working directory up to the worktree root

Use exact patterns first:

- `**/command/<name>.md`
- `**/commands/<name>.md`

If found, return the full path. If not found in those roots, explain that the command is not present in the loaded config paths.

## Agents (`.kilo/agent/*.md`)

Also loaded from `.kilocode/` and `.opencode/` directories (legacy), and plural `agents/` variants.

```yaml
---
description: When to use this agent
mode: primary # primary | subagent | all
model: anthropic/claude-sonnet # optional override
steps: 25 # max agentic iterations
hidden: false # hide from @ menu (subagent only)
color: "#FF5733" # hex or theme name
permission: # optional, agent-level permissions
  bash: allow
  edit:
    "src/**": allow
    "*": ask
---
System prompt for this agent.
```

`mode` values: `primary` = selectable as main agent, `subagent` = only via Task tool, `all` = both.

## Workflows (legacy)

Markdown files in `.kilo/workflows/` or `.kilocode/workflows/` (project-level) and `~/.kilo/workflows/` or `~/.kilocode/workflows/` (global). These are automatically converted to commands at startup. The filename (minus `.md`) becomes the command name. Project workflows override global ones with the same name.

## Agent Manager Setup And Run Scripts

Agent Manager setup/run scripts are project files in the main repository's `.kilo/` directory. They are not `kilo.json` settings and should not be configured inside generated `.kilo/worktrees/<name>/` checkouts.

Agent Manager worktrees usually live under `.kilo/worktrees/`. Think of each worktree as a separate checkout on its own branch: it enables parallel edits, but dependencies, build output, caches, databases, and generated files can consume significant disk space across many worktrees.

### Worktree workflow and conflicts

To bring changes back, choose one path: Agent Manager Apply for selected changes, merge the worktree branch into the target branch, or create/update a PR from the worktree. Agent Manager has native PR support and shows PR status on worktrees.

For conflict-heavy work, resolve inside the worktree before integration: merge or rebase the original/base branch into that worktree, ask the agent there to resolve conflicts and run checks, then apply, merge, or update the PR. Do not use `git stash` or autostash because stashes are shared across worktrees.

Agent Manager does not fully orchestrate dependencies across worktrees; users usually choose and sequence worktrees themselves. For larger parallel efforts, suggest stabilizing shared contracts, schemas, interfaces, routes, file layout, or test shape on the original/base branch before creating separate worktrees.

### Setup script

Setup scripts run once when a managed worktree is created, imported, or promoted, before the agent session starts. Use them for nested env files, local config, dependencies, databases, certificates, or other per-worktree setup.

| Platform | Filenames checked in order |
|---|---|
| macOS / Linux | `.kilo/setup-script`, `.kilo/setup-script.sh` |
| Windows | `.kilo/setup-script.ps1`, `.kilo/setup-script.cmd`, `.kilo/setup-script.bat` |

Behavior: runs from the worktree directory with `WORKTREE_PATH` set to the absolute worktree path and `REPO_PATH` set to the main repository root. Agent Manager copies root-level `.env` and `.env.*` files before setup without overwriting existing files; nested env files or other project-specific local files need setup script handling. Setup has a 5 minute timeout, and failures leave the worktree available for inspection.

### Run script

Run scripts start or stop the user's project for the selected Agent Manager context. Use them for dev servers, watchers, emulators, queues, or other commands behind the Run button.

| Platform | Filenames checked in order |
|---|---|
| macOS / Linux | `.kilo/run-script`, `.kilo/run-script.sh` |
| Windows | `.kilo/run-script.ps1`, `.kilo/run-script.cmd`, `.kilo/run-script.bat` |

Behavior: runs from the selected worktree directory, or the main repo root when `LOCAL` is selected. Receives `WORKTREE_PATH` as the current run directory and `REPO_PATH` as the main repository root. If no valid run script exists, Run opens or creates the default script template instead of running. Run status is in memory only and is not persisted in `.kilo/agent-manager.json`.

When the project supports it, avoid fixed global resources across worktrees by deriving ports, caches, Docker Compose project names, emulators, or databases from `WORKTREE_PATH` or the branch.

### Troubleshooting scripts

- If Run opens configuration instead of running, no valid run script exists for the current platform.
- If a script is ignored, verify the platform-specific filename from the tables above.
- For port conflicts (`EADDRINUSE`, browser/tests hitting the wrong worktree), inspect the app's dev-server config as well as `.kilo/run-script`. If fixing it requires application changes, ask whether the user wants the app made configurable or only wants a run-script workaround.
- If commands are missing, inspect how VS Code was launched. Run scripts load the user shell environment, but setup scripts only receive explicit `WORKTREE_PATH` and `REPO_PATH` from the task adapter, so `PATH` can differ.
- If setup times out, keep setup under 5 minutes or move long-running work into the run script or manual setup.
- If output is not visible in the Agent Manager chat terminal, explain that setup/run scripts write to VS Code task terminals. Ask the user for that output if it is needed for debugging.
- If unrelated conflicts appear, check for `git stash` usage. If stash caused it, suggest adding `AGENTS.md`, skill, or prompt guidance to avoid stash-based worktree merge flows.

### `agent-manager.json`

Agent Manager persists UI, worktree, and session state in `.kilo/agent-manager.json`. Treat this file as diagnostic or recovery state for lost sessions, stale worktrees, missing UI state, or external worktree deletion/movement. It can be large, so inspect it selectively. It does not store script contents, run status, live tasks, or terminal mappings, and should not be edited to configure run/setup behavior.

## Permissions

Scalar form applies to all patterns. Object form maps glob patterns to actions. Evaluated top-to-bottom; first match wins.

```jsonc
{
  "permission": {
    "bash": "allow", // scalar: allow all bash
    "edit": {
      // object: pattern-matched
      "src/**": "allow",
      "*.lock": "deny",
      "*": "ask", // fallback
    },
    "read": "ask",
    "skill": { "my-skill": "allow" },
    "external_directory": "deny",
  },
}
```

Actions: `"allow"`, `"ask"`, `"deny"`. Set `null` to delete an inherited key.

Tool permissions: `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `webfetch`, `websearch`, `codesearch`, `semantic_search`, `lsp`, `skill`, `external_directory`, `todowrite`, `todoread`, `question`, `doom_loop`.

## MCP Servers

```jsonc
{
  "mcp": {
    "local-server": {
      "type": "local",
      "command": ["node", "server.js"],
      "environment": { "PORT": "3000" },
      "enabled": true,
      "timeout": 10000,
    },
    "remote-server": {
      "type": "remote",
      "url": "https://mcp.example.com",
      "headers": { "Authorization": "Bearer ..." },
      "oauth": { "clientId": "...", "scope": "read" },
      "enabled": true,
    },
  },
}
```

Disable an inherited server: `{ "server-name": { "enabled": false } }`.

### MCP Tool Permissions

MCP tools use the same permission system as built-in tools. Each MCP tool's permission key is `{server}_{tool}` (e.g. `github_create_pull_request`). Glob patterns are supported.

```jsonc
{
  "permission": {
    // Require approval for all tools on this server by default
    "github_*": "ask",

    // Auto-approve a specific safe tool
    "github_get_file_contents": "allow",

    // Block a dangerous tool entirely
    "github_delete_file": "deny",
  },
}
```

Rules are evaluated top-to-bottom — the **last** matching rule wins. Put broad patterns first, then specific overrides after.

## Providers

```jsonc
{
  "provider": {
    "anthropic": {
      "options": {
        "apiKey": "sk-...",
        "baseURL": "https://custom.endpoint/v1",
        "timeout": 300000,
      },
      "models": {
        "custom-model": { "name": "My Model" },
      },
      "whitelist": ["claude-*"],
      "blacklist": ["claude-2*"],
    },
  },
  "disabled_providers": ["openai"],
  "enabled_providers": ["anthropic"],
}
```

### Disabling Built-in Providers

Use `disabled_providers` to prevent specific providers from loading. This is useful when you want to exclude providers that are built-in, or auto-detected via environment variables, from appearing in the model picker.

For example, this configuration will hide all models from the built-in Kilo Gateway as well as any from the OpenAI provider which may be enabled automatically through environment variables.

```jsonc
{
  "$schema": "https://app.kilo.ai/config.json",
  "disabled_providers": ["kilo", "openai"],
}
```

The provider ID is the lowercase name used in the `provider/model` format (e.g., `kilo`, `openai`, `anthropic`, `google`, `groq`).

**Interaction with `enabled_providers`:**

- `disabled_providers` removes specific providers from the auto-loaded set
- `enabled_providers` is more restrictive — when set, ONLY the listed providers will be enabled, ignoring all others
- If both are set, providers must appear in `enabled_providers` and not appear in `disabled_providers`

To disable all auto-detected providers except one:

```jsonc
{
  "enabled_providers": ["anthropic"],
}
```

## Skills

Additional skill directories and remote URLs:

```jsonc
{
  "skills": {
    "paths": ["./my-skills", "~/shared-skills"],
    "urls": ["https://example.com/.well-known/skills/"],
  },
}
```

Skills are markdown files at `skills/<name>/SKILL.md` (or `skill/<name>/SKILL.md`) with `name` and `description` in frontmatter. Discovered inside `.kilo/`, `.kilocode/`, and `.opencode/` directories.

## Other Top-Level Fields

| Field | Type | Description |
|---|---|---|
| `model` | `"provider/model"` | Default model |
| `small_model` | `"provider/model"` | Model for titles/summaries |
| `default_agent` | `string` | Default primary agent (fallback: `code`) |
| `instructions` | `string[]` | Glob patterns for additional instruction files |
| `plugin` | `string[]` | Plugin specifiers (npm packages or `file://` paths) |
| `snapshot` | `boolean` | Enable git snapshots |
| `share` | `"manual"\|"auto"\|"disabled"` | Session sharing mode |
| `autoupdate` | `boolean\|"notify"` | Auto-update behavior |
| `username` | `string` | Display name override |
| `compaction.auto` | `boolean` | Auto-compact when context full (default: true) |
| `compaction.prune` | `boolean` | Prune old tool outputs (default: true) |

## TUI Settings (Ctrl+P Command Palette)

The CLI TUI has runtime settings accessible via `Ctrl+P` (command palette) or slash commands. **These are user-interactive only — the agent cannot change them programmatically.** When users ask to change these settings, tell them which command palette entry, keybind, or slash command to use.

Leader key default: `ctrl+x`. Keybinds below use `<leader>` prefix (e.g. `<leader>t` = `ctrl+x` then `t`).

### Theme & Appearance

| Action | Keybind | Slash | Notes |
|---|---|---|---|
| Switch theme | `<leader>t` | `/themes` | Pick from 35+ built-in themes (kilo, catppuccin, dracula, github, gruvbox, nord, tokyonight, etc.) |
| Toggle appearance (dark/light) | — | — | Ctrl+P → "Toggle appearance" |

Custom themes: place JSON files in `~/.config/kilo/themes/` or `.kilo/themes/`.

### Session

| Action | Keybind | Slash |
|---|---|---|
| List sessions | `<leader>l` | `/sessions` |
| New session | `<leader>n` | `/new`, `/clear` |
| Share session | — | `/share` |
| Rename session | `ctrl+r` | `/rename` |
| Jump to message | `<leader>g` | `/timeline` |
| Fork from message | — | `/fork` |
| Compact/summarize | `<leader>c` | `/compact`, `/summarize` |
| Undo message | `<leader>u` | `/undo` |
| Redo | `<leader>r` | `/redo` |
| Copy last response | `<leader>y` | — |
| Copy transcript | — | `/copy` |

### Agent & Model

| Action | Keybind | Slash |
|---|---|---|
| Switch model | `<leader>m` | `/models` |
| Switch agent | `<leader>a` | `/agents` |
| Toggle MCPs | — | `/mcps` |
| Cycle agent | `tab` / `shift+tab` | — |

### Display Toggles (via Ctrl+P)

Toggle notifications, Toggle animations, Toggle diff wrapping, Toggle sidebar (`<leader>b`), Toggle thinking (`/thinking`), Toggle tool details, Toggle timestamps (`/timestamps`), Toggle scrollbar, Toggle header, Toggle code concealment (`<leader>h`).

### System

| Action | Slash |
|---|---|
| View status | `/status` |
| Help | `/help` |
| Exit | `/exit`, `/quit`, `/q` |
| Open editor | `/editor` |

## Config File Locations

### Config files (kilo.json)

| Scope | Path |
|---|---|
| Project | `./kilo.json`, `./kilo.jsonc`, `./opencode.json` (legacy), `./opencode.jsonc` (legacy) |
| Global | `~/.config/kilo/kilo.json`, `~/.config/kilo/kilo.jsonc`, `~/.config/kilo/opencode.json` (legacy), `~/.config/kilo/opencode.jsonc` (legacy), `~/.config/kilo/config.json` (legacy) |
| Managed | Linux: `/etc/kilo/`, macOS: `/Library/Application Support/kilo/`, Windows: `%ProgramData%\kilo\` — loads `kilo.json`, `kilo.jsonc`, `opencode.json`, `opencode.jsonc` (enterprise, highest priority) |

Each config directory (`.kilo/`, `.kilocode/`, `.opencode/`) can also contain `kilo.json`, `kilo.jsonc`, `opencode.json`, or `opencode.jsonc`.

### Config directories

Three directory names are scanned: `.kilo` (modern), `.kilocode` (legacy), `.opencode` (legacy). All three are checked at each level:

- **Project**: walks up from CWD to the git worktree root, checking for all three at each directory level
- **Home**: `~/.kilo/`, `~/.kilocode/`, `~/.opencode/`
- **XDG global**: `~/.config/kilo/` (always loaded, lowest file-based precedence)

### Commands, agents, modes, plugins

Glob patterns run inside every discovered config directory (including legacy):

| Type | Pattern |
|---|---|
| Command | `{command,commands}/**/*.md` |
| Agent | `{agent,agents}/**/*.md` |
| Mode | `{mode,modes}/*.md` |
| Plugin | `{plugin,plugins}/*.{ts,js}` |

Example: `~/.config/kilo/command/*.md` (modern global), `~/.kilocode/command/*.md` (legacy global), `.opencode/commands/*.md` (legacy project) all load commands.

### Skills and instructions

| Scope | Path |
|---|---|
| Skills | `{skill,skills}/<name>/SKILL.md` inside any config directory |
| Instructions | `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, glob patterns from `instructions` config field |

### Environment variable overrides

| Variable | Description |
|---|---|
| `KILO_CONFIG` | Path to an additional config file (loaded after global) |
| `KILO_CONFIG_DIR` | Path to an additional config directory (appended to search list) |
| `KILO_CONFIG_CONTENT` | Inline JSON config string (high precedence, after project dirs) |
| `KILO_DISABLE_PROJECT_CONFIG` | Skip all project-level config (files and directories) |
