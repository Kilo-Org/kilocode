# Kilocode Migration

This document explains how Kilocode configurations are automatically migrated to Opencode.

## Table of Contents

- [Modes Migration](#modes-migration)
- [Skills Discovery](#skills-discovery)
- [Rules Migration](#rules-migration)
- [Workflows Migration](#workflows-migration)
- [MCP Migration](#mcp-migration)
- [Kilo Notifications](#kilo-notifications)

---

# Modes Migration

This section explains how Kilocode custom modes are automatically migrated to Opencode agents.

## Overview

Kilocode stores custom modes in YAML files. When Opencode starts, it reads these files and converts them to Opencode's agent format, injecting them via the `OPENCODE_CONFIG_CONTENT` mechanism.

## Source Locations

The migrator reads custom modes from these locations (in order, later entries override earlier ones):

### Global Modes (VSCode Extension Storage)

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Code/User/globalStorage/kilocode.kilo-code/settings/custom_modes.yaml` |
| Windows | `%APPDATA%/Code/User/globalStorage/kilocode.kilo-code/settings/custom_modes.yaml` |
| Linux | `~/.config/Code/User/globalStorage/kilocode.kilo-code/settings/custom_modes.yaml` |

### Project Modes

| Location | Description |
|---|---|
| `.kilocodemodes` | Project-specific modes in the workspace root |

## Field Mapping

### Migrated Fields

| Kilocode Field | Opencode Field | Notes |
|---|---|---|
| `slug` | Agent key | Used as the agent identifier |
| `roleDefinition` | `prompt` | Combined with `customInstructions` |
| `customInstructions` | `prompt` | Appended after `roleDefinition` with `\n\n` separator |
| `groups` | `permission` | See permission mapping below |
| `description` | `description` | Primary source for description |
| `whenToUse` | `description` | Fallback if no `description` |
| `name` | `description` | Final fallback |

### Permission Mapping

Kilocode uses "groups" to define what tools a mode can access. These are converted to Opencode's permission system:

| Kilocode Group | Opencode Permission | Notes |
|---|---|---|
| `read` | `read: "allow"` | File reading |
| `edit` | `edit: "allow"` | File editing |
| `command` | `bash: "allow"` | Shell commands |
| `browser` | `browser_open: "allow"` | Integrated Browser navigation |
| `mcp` | `<server>_*: "allow"` per migrated server | One key per MCP server the same migration writes |

There is no `mcp` permission key: an `mcp` group grants the tools of each migrated server through a `<server name>_*` key, with characters outside `[a-zA-Z0-9_-]` replaced by `_`. That replacement is the CLI's own MCP tool-id naming: one leaf module ([`tool-id.ts`](../../kilocode/mcp/tool-id.ts)) defines it, and every path that names an MCP server in this migration reuses that definition instead of repeating the rule, so a migrated grant always names the tools the CLI registers. One character outside that class becomes one `_` per code point, matching the plugin, so a name containing a character outside the Basic Multilingual Plane produces the same key in both languages. Two legacy server names that differ only outside that class, such as `a.b` and `a_b`, produce the same `<server>_*` key and therefore share one rule. A mode without an `mcp` group denies those keys.

An `mcp` group grants the tools of every server the loader that ran the migration converted, with no per-server narrowing by where the entry came from: a converted global-store server counts the same as a project one, because the legacy group meant all MCP tools. Which stores are read is a separate, existing decision of each loader. The loader that runs for the CLI reads project stores only unless its platform is the VS Code extension or a Console daemon, so the terminal, the JetBrains plugin and the CLI under other clients grant the project servers; a loader asked to include global paths grants the global-store servers as well. A mode whose `mcp` group lost a server reports that through a distinct migration message: a skipped store is opened only to answer what it declared, and a server it declared is a loss when the migration can grant it and no converted server's `<server>_*` key covers it, because the group can grant only the servers that were converted. The migration can grant an entry that is not marked `disabled` and that has a `command`, or a `url` for a remote entry; an entry it cannot grant is silent. A server the project store names as well is covered, provided that project entry itself converts, so a skipped store whose every server the project store also names and converts loses nothing and reports nothing. Two independent conditions produce that group's message, and both appear when both hold: the group lost a server of a skipped store, and the group granted nothing while a store this load read declared a server.

**Important:** Permissions that are NOT in the groups list are explicitly set to `"deny"` (`read`, `edit`, `bash`, `browser_open`, and the per-server keys). This ensures that a mode with only `read` and `edit` groups cannot run shell commands or access MCP servers.

A group option outside `fileRegex` and `description` means the group was not read fully, so its permission is set to `"ask"` rather than granted.

An entry that holds only options, as in the YAML shape `groups: ["edit", { fileRegex: "^docs/" }]` or `groups: [edit, fileRegex: "^docs/"]`, is not a group of its own. The migration reads it as the options of the plain group name just before it, so that group is set to `"ask"` with a warning instead of granted. An options entry with no plain group name before it grants nothing.

### File Restrictions

Kilocode supports restricting edit access to specific file patterns:

```yaml
groups:
  - read
  - - edit
    - fileRegex: "\\.md$"
      description: "Markdown files only"
```

This converts to:

```json
{
  "permission": {
    "read": "allow",
    "edit": {
      "*": "deny",
      "*.md": "allow"
    },
    "bash": "deny",
    "browser_open": "deny"
  }
}
```

The `fileRegex` is translated into permission wildcard globs, with the catch-all `"*": "deny"` written first because the CLI resolves the last matching rule. The supported subset is the same one the JetBrains plugin migrator uses ([`permission-glob.ts`](../permission-glob.ts)): anchors, literal characters, `\`-escaped ASCII punctuation, `.` and `.*`, `(...)` alternation, alternation at the top level, and an optional `?` after any of the supported atoms. A top-level `|` splits the pattern into alternatives that each carry their own anchors, so `^src/.*|^test/.*` grants the same files as `^(src/.*|test/.*)$`. A backslash may escape only an ASCII punctuation character that the glob carries literally: backslash, `*` and `?` are excluded because the glob syntax cannot express them. A pattern outside that subset (a character class, `+`, a `\d`-style escape, nested groups, an arm of only digits, an arm the CLI would expand to an absolute home path, one alternative the translator cannot express while other alternatives can) sets that permission to `"ask"` and reports a migration warning, so the mode asks instead of silently losing the restriction. One untranslatable alternative rejects the whole pattern, because a rule that kept only the other alternatives would refuse files the legacy pattern allowed. An arm of only digits is outside the subset because JavaScript enumerates such a key before `"*"`, which would make the catch-all deny win. An empty alternative matches the empty string. A pattern whose empty alternative is its whole body matches every path; when the alternative sits inside a longer pattern, it matches that pattern's surrounding characters instead. With both anchors the empty alternative is dropped so the alternatives that name a path survive, and a pattern whose every alternative is empty is reported and asks.

`bash` and `browser_open` are explicitly denied because they weren't in the original groups list. A migrated mode carries no `skill` rule, so it keeps the CLI default and its skill access is unchanged; the JetBrains plugin migration records its own `skill` denial in the migration report it prints.

| Channel | What it carries |
|---|---|
| Migration warning | A condition the user has to resolve: an `mcp` group that lost a server of a skipped store this load did not cover, an `mcp` group that granted nothing while a store this load read declared a server, a group option that was not read, a file restriction that could not be translated, a repeated group that resolves to a different rule |
| Migration note | An expected outcome worth explaining: an organization mode's `mcp` group, which attaches no MCP server at config load |

When one mode lists the same group more than once, the migration keeps the narrower rule: `ask` over a file restriction over a plain grant. Two different file restrictions for the same group are not combined, so that group asks. A repeat that resolves to a different rule is reported as a migration warning that names the permission key; a repeat of the same rule produces no message.

## Default Modes

The following Kilocode default modes are **skipped** during migration because Opencode has native equivalents:

| Kilocode Mode | Reason |
|---|---|
| `code` | Maps to Opencode's `build` agent |
| `architect` | Maps to Opencode's `plan` agent |
| `ask` | Read-only exploration (use `explore` subagent) |
| `debug` | Debugging workflow (use `build` with debug instructions) |
| `orchestrator` | Redundant - all Opencode agents can spawn subagents |

## Example Conversion

### Kilocode Mode (YAML)

```yaml
customModes:
  - slug: translate
    name: Translate
    roleDefinition: You are a linguistic specialist focused on translation.
    customInstructions: |
      When translating:
      - Maintain consistent terminology
      - Preserve formatting
    groups:
      - read
      - - edit
        - fileRegex: "src/i18n/.*\\.json$"
          description: "Translation files only"
    description: Translate content between languages
```

### Opencode Agent (JSON)

```json
{
  "agent": {
    "translate": {
      "mode": "primary",
      "description": "Translate content between languages",
      "prompt": "You are a linguistic specialist focused on translation.\n\nWhen translating:\n- Maintain consistent terminology\n- Preserve formatting",
      "permission": {
        "read": "allow",
        "edit": {
          "*": "deny",
          "*src/i18n/*.json": "allow"
        },
        "bash": "deny",
        "browser_open": "deny"
      }
    }
  }
}
```

## Not Migrated (Future Phases)

The following Kilocode features are not yet migrated:

| Feature | Status | Notes |
|---|---|---|
| Rules (`.kilocode/rules/`) | Phase 2 | Will map to `instructions` array |
| Workflows (`.kilocode/workflows/`) | Phase 2 | Will map to custom commands |
| Provider Settings | Phase 2 | Will map to `provider` config |
| Mode-specific API configs | Phase 2 | Different models per mode |
| Organization modes | Not planned | `source: organization` not preserved |

## Troubleshooting

### Mode not appearing

1. Check the file exists at the expected location
2. Verify YAML syntax is valid
3. Ensure the mode has a unique `slug`
4. Check it's not a default mode (which are skipped)

### Permissions not working

1. Verify the `groups` array is correctly formatted
2. For file restrictions, ensure `fileRegex` is a valid regex
3. Check the permission mapping table above

## Related Files

- [`modes-migrator.ts`](../modes-migrator.ts) - Core migration logic
- [`config-injector.ts`](../config-injector.ts) - Config building and injection

---

# Skills Discovery

Kilocode skills are automatically discovered and made available in Opencode. This is **not a migration** - skills remain in their original locations and can be managed independently by the Kilo VSCode extension.

## How It Works

Kilo scans canonical `.kilo/skill/` and `.kilo/skills/` directories alongside legacy `.kilocode/` equivalents. The `KilocodePaths.skillDirectories()` function provides these paths.

## Source Locations

Skills are discovered from these locations (in order, later entries override earlier ones):

### Project Skills (Walk-up Discovery)

The scanner walks up from the current directory to the git worktree root, finding all `.kilocode/skills/` directories:

```
your-project/
├── .kilocode/
│   └── skills/
│       └── project-skill/
│           └── SKILL.md
└── packages/
    └── my-package/           # If you run from here
        └── .kilocode/
            └── skills/
                └── package-skill/
                    └── SKILL.md
```

Running from `packages/my-package/` discovers both `package-skill` and `project-skill`.

### Global Skills

| Platform | Path |
|---|---|
| All | `~/.kilocode/skills/` |

### VSCode Extension Storage (Marketplace Skills)

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Code/User/globalStorage/kilocode.kilo-code/skills/` |
| Windows | `%APPDATA%/Code/User/globalStorage/kilocode.kilo-code/skills/` |
| Linux | `~/.config/Code/User/globalStorage/kilocode.kilo-code/skills/` |

## Skill File Format

Skills use the same `SKILL.md` format as Opencode:

```markdown
---
name: my-skill
description: When to use this skill
---

# Instructions

Detailed instructions for the agent...
```

## Priority / Override Behavior

When the same skill name exists in multiple locations, **last one wins**. Canonical `.kilo/` skills take precedence over legacy `.kilocode/` skills at the same project level. Explicit external skill paths and compatibility directories are loaded according to the configured scan order.

## Mode-Specific Skills

Kilocode supports mode-specific skills in `skills-{mode}/` directories (e.g., `skills-code/`, `skills-architect/`). These are **not currently migrated** to Opencode.

If you need mode-specific behavior, use Opencode's agent permission system:

```json
{
  "agent": {
    "build": {
      "permission": {
        "skill": {
          "translation": "deny"
        }
      }
    }
  }
}
```

## Symlink Support

Skills can be symlinked from a shared location:

```
.agents/skills/shared-skill/          # Actual skill
.kilocode/skills/shared-skill -> ...  # Legacy symlink
.kilo/skill/shared-skill -> ...       # Canonical symlink
```

The scanner follows symlinks, so a skill installed once can be available to both Kilo VSCode and Opencode CLI.

## Related Files

- [`paths.ts`](../paths.ts) - `skillDirectories()` function
- [`skill.ts`](../../skill/skill.ts) - Skill scanning logic

---

# Rules Migration

Kilocode rules are migrated to Opencode's `instructions` array. See [`rules-migrator.ts`](../rules-migrator.ts).

## Source Locations

| Location | Description |
|---|---|
| `.kilocoderules` | Legacy project rules file |
| `.kilocode/rules/*.md` | Project rules directory |
| `~/.kilocode/rules/*.md` | Global rules directory |
| `.kilocoderules-{mode}` | Mode-specific legacy rules |
| `.kilocode/rules-{mode}/*.md` | Mode-specific rules directory |

---

# Workflows Migration

Kilocode workflows are migrated to Opencode commands. See [`workflows-migrator.ts`](../workflows-migrator.ts).

## Source Locations

| Location | Description |
|---|---|
| `.kilocode/workflows/*.md` | Project workflows |
| `~/.kilocode/workflows/*.md` | Global workflows |
| VSCode extension storage | Marketplace-installed workflows |

---

# MCP Migration

Kilocode MCP server configurations are migrated to Opencode's `mcp` config. See [`mcp-migrator.ts`](../mcp-migrator.ts).

## Config file location

The CLI reads global config from `~/.config/kilo/` (see [`global/index.ts`](../../global/index.ts): `Global.Path.config` = `xdgConfig` + `"kilo"`). It merges, in order, `config.json`, `opencode.json`, and `opencode.jsonc` in that directory. You can put MCP config in **`opencode.json`** or **`opencode.jsonc`**.

- **macOS / Linux:** `~/.config/kilo/opencode.json` (or `opencode.jsonc`)
- **Windows:** Config directory depends on `xdg-basedir` (often under `%LOCALAPPDATA%` or `%USERPROFILE%`); filename is still `opencode.json` or `opencode.jsonc`.

Use a top-level `"mcp"` object. Each key is the server name. For a local server, value must have `type: "local"` and `command: ["executable", "arg1", ...]`. Optional: `environment` (env vars), `enabled` (boolean), `timeout` (ms). See `Config.McpLocal` in [`config.ts`](../../config/config.ts). Restart the CLI after editing.

## Source Location (migration from Kilocode)

| Location | Description |
|---|---|
| VSCode extension storage `settings/cline_mcp_settings.json` | MCP server configurations |

---

# Kilo Notifications

When connected to Kilo Gateway, the CLI fetches and displays notifications from the Kilo API. This allows Kilo to communicate important announcements, feature updates, and tips to users.

## How It Works

1. **On startup**, if the user is authenticated with Kilo Gateway, the CLI fetches notifications from `https://api.kilo.ai/api/users/notifications`
2. **Filtering**: Only notifications with `showIn` containing `"cli"` (or no `showIn` restriction) are displayed
3. **Display**: The first notification is shown as a toast notification after a 2-second delay

## Notification Data Structure

```typescript
interface KilocodeNotification {
  id: string // Unique identifier
  title: string // Notification title (e.g., "Agent skills now supported!")
  message: string // Description text
  action?: {
    actionText: string // Link text (e.g., "Learn More")
    actionURL: string // URL destination
  }
  showIn?: string[] // Target platforms: ["cli", "vscode"]
}
```

## Example Notification

```
Title: Agent skills now supported!
Message: Define reusable skills and workflows for your AI agent.
Action: Learn More -> https://docs.kilo.ai/skills
```

## Display Conditions

| Condition | Notifications Shown |
|---|---|
| Connected to Kilo Gateway | Yes |
| Not connected to Kilo | No |
| No notifications from API | No |

## Related Files

- [`notifications.ts`](../../../../kilo-gateway/src/api/notifications.ts) - Fetch function and types
- [`routes.ts`](../../../../kilo-gateway/src/server/routes.ts) - Server endpoint `/kilo/notifications`
- [`app.tsx`](../../cli/cmd/tui/app.tsx) - TUI notification display logic
