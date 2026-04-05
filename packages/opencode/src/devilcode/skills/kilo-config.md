# Kilo CLI Configuration Reference

All config lives in `kilo.json` (or `kilo.jsonc`). Precedence low-to-high: remote well-known, global (`~/.config/kilo/kilo.json`), env `KILO_CONFIG`, project `./kilo.json`, `.kilo/kilo.json`, `KILO_CONFIG_CONTENT`, managed (see Config File Locations). Deep-merged; later wins.

## Commands (`.kilo/command/*.md`)

Markdown files with YAML frontmatter. The filename (minus `.md`) becomes the command name invoked via `/name`.

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

## Agents (`.kilo/agent/*.md`)

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

Tool permissions: `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `webfetch`, `websearch`, `codesearch`, `lsp`, `skill`, `external_directory`, `todowrite`, `todoread`, `question`, `doom_loop`.

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

Skills are markdown files at `skills/<name>/SKILL.md` with `name` and `description` in frontmatter.

## Other Top-Level Fields

| Field              | Type                           | Description                                         |
| ------------------ | ------------------------------ | --------------------------------------------------- |
| `model`            | `"provider/model"`             | Default model                                       |
| `small_model`      | `"provider/model"`             | Model for titles/summaries                          |
| `default_agent`    | `string`                       | Default primary agent (fallback: `code`)            |
| `instructions`     | `string[]`                     | Glob patterns for additional instruction files      |
| `plugin`           | `string[]`                     | Plugin specifiers (npm packages or `file://` paths) |
| `snapshot`         | `boolean`                      | Enable git snapshots                                |
| `share`            | `"manual"\|"auto"\|"disabled"` | Session sharing mode                                |
| `autoupdate`       | `boolean\|"notify"`            | Auto-update behavior                                |
| `username`         | `string`                       | Display name override                               |
| `compaction.auto`  | `boolean`                      | Auto-compact when context full (default: true)      |
| `compaction.prune` | `boolean`                      | Prune old tool outputs (default: true)              |

## TUI Settings (Ctrl+P Command Palette)

The CLI TUI has runtime settings accessible via `Ctrl+P` (command palette) or slash commands. **These are user-interactive only — the agent cannot change them programmatically.** When users ask to change these settings, tell them which command palette entry, keybind, or slash command to use.

Leader key default: `ctrl+x`. Keybinds below use `<leader>` prefix (e.g. `<leader>t` = `ctrl+x` then `t`).

### Theme & Appearance

| Action                         | Keybind     | Slash     | Notes                                                                                              |
| ------------------------------ | ----------- | --------- | -------------------------------------------------------------------------------------------------- |
| Switch theme                   | `<leader>t` | `/themes` | Pick from 35+ built-in themes (kilo, catppuccin, dracula, github, gruvbox, nord, tokyonight, etc.) |
| Toggle appearance (dark/light) | —           | —         | Ctrl+P → "Toggle appearance"                                                                       |

Custom themes: place JSON files in `~/.config/kilo/themes/` or `.kilo/themes/`.

### Session

| Action             | Keybind     | Slash                    |
| ------------------ | ----------- | ------------------------ |
| List sessions      | `<leader>l` | `/sessions`              |
| New session        | `<leader>n` | `/new`, `/clear`         |
| Share session      | —           | `/share`                 |
| Rename session     | `ctrl+r`    | `/rename`                |
| Jump to message    | `<leader>g` | `/timeline`              |
| Fork from message  | —           | `/fork`                  |
| Compact/summarize  | `<leader>c` | `/compact`, `/summarize` |
| Undo message       | `<leader>u` | `/undo`                  |
| Redo               | `<leader>r` | `/redo`                  |
| Copy last response | `<leader>y` | —                        |
| Copy transcript    | —           | `/copy`                  |

### Agent & Model

| Action       | Keybind             | Slash     |
| ------------ | ------------------- | --------- |
| Switch model | `<leader>m`         | `/models` |
| Switch agent | `<leader>a`         | `/agents` |
| Toggle MCPs  | —                   | `/mcps`   |
| Cycle agent  | `tab` / `shift+tab` | —         |

### Display Toggles (via Ctrl+P)

Toggle notifications, Toggle animations, Toggle diff wrapping, Toggle sidebar (`<leader>b`), Toggle thinking (`/thinking`), Toggle tool details, Toggle timestamps (`/timestamps`), Toggle scrollbar, Toggle header, Toggle code concealment (`<leader>h`).

### System

| Action      | Slash                  |
| ----------- | ---------------------- |
| View status | `/status`              |
| Help        | `/help`                |
| Exit        | `/exit`, `/quit`, `/q` |
| Open editor | `/editor`              |

## Config File Locations

| Scope        | Path                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project      | `./kilo.json`, `./.kilo/kilo.json`                                                                                                                         |
| Global       | `~/.config/kilo/kilo.json`                                                                                                                                 |
| Managed      | Linux: `/etc/kilo/kilo.json`, macOS: `/Library/Application Support/kilo/kilo.json`, Windows: `%ProgramData%\kilo\kilo.json` (enterprise, highest priority) |
| Commands     | `.kilo/command/*.md` (project), `~/.config/kilo/command/*.md` (global)                                                                                     |
| Agents       | `.kilo/agent/*.md` (project), `~/.config/kilo/agent/*.md` (global)                                                                                         |
| Skills       | `.kilo/skill/*/SKILL.md`, `.kilo/skills/*/SKILL.md`                                                                                                        |
| Instructions | `AGENTS.md`, `.kilo/instructions.md`, glob patterns from `instructions`                                                                                    |
