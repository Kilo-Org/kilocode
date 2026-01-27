# Kilocode Migration

This document explains how Kilocode configurations are automatically migrated to Opencode.

## Table of Contents

- [Modes Migration](#modes-migration)
- [Skills Discovery](#skills-discovery)
- [Rules Migration](#rules-migration)
- [Workflows Migration](#workflows-migration)
- [MCP Migration](#mcp-migration)
- [Splash Screen](#splash-screen)

---

# Modes Migration

This section explains how Kilocode custom modes are automatically migrated to Opencode agents.

## Overview

Kilocode stores custom modes in YAML files. When Opencode starts, it reads these files and converts them to Opencode's agent format, injecting them via the `OPENCODE_CONFIG_CONTENT` mechanism.

## Source Locations

The migrator reads custom modes from these locations (in order, later entries override earlier ones):

### Global Modes (VSCode Extension Storage)

| Platform | Path                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/Code/User/globalStorage/kilocode.kilo-code/settings/custom_modes.yaml` |
| Windows  | `%APPDATA%/Code/User/globalStorage/kilocode.kilo-code/settings/custom_modes.yaml`                     |
| Linux    | `~/.config/Code/User/globalStorage/kilocode.kilo-code/settings/custom_modes.yaml`                     |

### Project Modes

| Location         | Description                                  |
| ---------------- | -------------------------------------------- |
| `.kilocodemodes` | Project-specific modes in the workspace root |

## Field Mapping

### Migrated Fields

| Kilocode Field       | Opencode Field | Notes                                                 |
| -------------------- | -------------- | ----------------------------------------------------- |
| `slug`               | Agent key      | Used as the agent identifier                          |
| `roleDefinition`     | `prompt`       | Combined with `customInstructions`                    |
| `customInstructions` | `prompt`       | Appended after `roleDefinition` with `\n\n` separator |
| `groups`             | `permission`   | See permission mapping below                          |
| `description`        | `description`  | Primary source for description                        |
| `whenToUse`          | `description`  | Fallback if no `description`                          |
| `name`               | `description`  | Final fallback                                        |

### Permission Mapping

Kilocode uses "groups" to define what tools a mode can access. These are converted to Opencode's permission system:

| Kilocode Group | Opencode Permission | Notes                      |
| -------------- | ------------------- | -------------------------- |
| `read`         | `read: "allow"`     | File reading               |
| `edit`         | `edit: "allow"`     | File editing               |
| `command`      | `bash: "allow"`     | Shell commands             |
| `browser`      | `bash: "allow"`     | Browser actions (via bash) |
| `mcp`          | `mcp: "allow"`      | MCP server access          |

**Important:** Permissions that are NOT in the groups list are explicitly set to `"deny"`. This ensures that a mode with only `read` and `edit` groups cannot run shell commands or access MCP servers.

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
      "\\.md$": "allow",
      "*": "deny"
    },
    "bash": "deny",
    "mcp": "deny"
  }
}
```

Note: `bash` and `mcp` are explicitly denied because they weren't in the original groups list.

## Default Modes

The following Kilocode default modes are **skipped** during migration because Opencode has native equivalents:

| Kilocode Mode  | Reason                                                   |
| -------------- | -------------------------------------------------------- |
| `code`         | Maps to Opencode's `build` agent                         |
| `architect`    | Maps to Opencode's `plan` agent                          |
| `ask`          | Read-only exploration (use `explore` subagent)           |
| `debug`        | Debugging workflow (use `build` with debug instructions) |
| `orchestrator` | Redundant - all Opencode agents can spawn subagents      |

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
          "src/i18n/.*\\.json$": "allow",
          "*": "deny"
        }
      }
    }
  }
}
```

## Not Migrated (Future Phases)

The following Kilocode features are not yet migrated:

| Feature                            | Status      | Notes                                |
| ---------------------------------- | ----------- | ------------------------------------ |
| Rules (`.kilocode/rules/`)         | Phase 2     | Will map to `instructions` array     |
| Workflows (`.kilocode/workflows/`) | Phase 2     | Will map to custom commands          |
| MCP Servers (`mcp_settings.json`)  | Phase 2     | Will map to `mcp` config             |
| Provider Settings                  | Phase 2     | Will map to `provider` config        |
| Mode-specific API configs          | Phase 2     | Different models per mode            |
| Organization modes                 | Not planned | `source: organization` not preserved |

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

Opencode scans additional directories for skills alongside its native `.opencode/skill/` locations. The `KilocodePaths.skillDirectories()` function provides these paths.

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

| Platform | Path                  |
| -------- | --------------------- |
| All      | `~/.kilocode/skills/` |

### VSCode Extension Storage (Marketplace Skills)

| Platform | Path                                                                               |
| -------- | ---------------------------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/Code/User/globalStorage/kilocode.kilo-code/skills/` |
| Windows  | `%APPDATA%/Code/User/globalStorage/kilocode.kilo-code/skills/`                     |
| Linux    | `~/.config/Code/User/globalStorage/kilocode.kilo-code/skills/`                     |

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

When the same skill name exists in multiple locations, **last one wins**:

1. `.claude/skills/` (lowest priority)
2. `.kilocode/skills/` (walk-up)
3. `~/.kilocode/skills/`
4. VSCode extension storage
5. `.opencode/skill/` (walk-up)
6. `~/.opencode/skill/` (highest priority)

This means Opencode native skills take precedence over Kilocode skills with the same name.

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
.kilocode/skills/shared-skill -> ...  # Symlink
.opencode/skill/shared-skill -> ...   # Symlink
```

The scanner follows symlinks, so a skill installed once can be available to both Kilo VSCode and Opencode CLI.

## Related Files

- [`paths.ts`](../paths.ts) - `skillDirectories()` function
- [`skill.ts`](../../skill/skill.ts) - Skill scanning logic

---

# Rules Migration

Kilocode rules are migrated to Opencode's `instructions` array. See [`rules-migrator.ts`](../rules-migrator.ts).

## Source Locations

| Location                      | Description                   |
| ----------------------------- | ----------------------------- |
| `.kilocoderules`              | Legacy project rules file     |
| `.kilocode/rules/*.md`        | Project rules directory       |
| `~/.kilocode/rules/*.md`      | Global rules directory        |
| `.kilocoderules-{mode}`       | Mode-specific legacy rules    |
| `.kilocode/rules-{mode}/*.md` | Mode-specific rules directory |

---

# Workflows Migration

Kilocode workflows are migrated to Opencode commands. See [`workflows-migrator.ts`](../workflows-migrator.ts).

## Source Locations

| Location                     | Description                     |
| ---------------------------- | ------------------------------- |
| `.kilocode/workflows/*.md`   | Project workflows               |
| `~/.kilocode/workflows/*.md` | Global workflows                |
| VSCode extension storage     | Marketplace-installed workflows |

---

# MCP Migration

Kilocode MCP server configurations are migrated to Opencode's `mcp` config. See [`mcp-migrator.ts`](../mcp-migrator.ts).

## Source Location

| Location                                                    | Description               |
| ----------------------------------------------------------- | ------------------------- |
| VSCode extension storage `settings/cline_mcp_settings.json` | MCP server configurations |

---

# Splash Screen

The splash screen displays the Kilo CLI logo when the CLI starts.

## Default Behavior

When Kilo starts normally, the splash screen shows the Kilo CLI braille logo:

```
⢰⣶⠀⠀⣶⡆⢰⣶⣶⣄⠀⠀⢰⣶⠀⠀⣶⡄⠀⠀⣴⣶⣦⡀      ⢰⣶⣶⣶⣄⠀⠀⢰⣶⠀⠀   ⢰⣶⣶⣄⠀⠀
⢸⣿⠿⠿⣦⡀⠀⠀⢸⣿⠀⠀⢸⣿⠀⠀⠀⠀⢰⣿⠁⠀⣿⡇     ⢸⣿⠀⠀⠀⠀⠀⠀⢸⣿⠀⠀⠀⠀⠀⠀ ⢸⣿⠀⠀
⠸⠿⠀⠀⠿⠃⠘⠿⠿⠿⠿⠇⠘⠿⠿⠿⠿⠇⠈⠻⠿⠿⠀       ⢰⣶⣶⣶⣦⠀⠀⠘⠿⠿⠿⠿⠇ ⠘⠿⠿⠿⠿⠇
```

This displays "KILO" on the left and "CLI" on the right in braille characters.

## `--nosplash` Flag

Use the `--nosplash` flag to completely hide the logo:

```bash
kilo --nosplash
```

This is useful for:

- CI/CD pipelines
- Scripts that programmatically interact with Kilo
- Users who prefer a minimal interface

| Flag         | Logo |
| ------------ | ---- |
| Normal mode  | Show |
| `--nosplash` | Hide |

## Tips

Tips are shown below the prompt and can be toggled via `ctrl+p` > "Hide tips" / "Show tips".

## Related Files

- [`kilo-logo.tsx`](../../cli/cmd/tui/component/kilo-logo.tsx) - Kilo CLI logo component
- [`logo.tsx`](../../cli/cmd/tui/component/logo.tsx) - Logo wrapper component
- [`home.tsx`](../../cli/cmd/tui/routes/home.tsx) - Home route with `--nosplash` logic
- [`thread.ts`](../../cli/cmd/tui/thread.ts) - CLI argument parsing for `--nosplash`
