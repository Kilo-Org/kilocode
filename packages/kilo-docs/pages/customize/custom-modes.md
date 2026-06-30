---
title: "Custom Modes"
description: "Create and configure custom modes in Kilo Code"
---

# Custom Modes

Kilo Code allows you to create **custom modes** (also called **agents**) to tailor Kilo's behavior to specific tasks or workflows. Custom modes can be **global** (available across all projects), **project-specific** (defined within a single project), or **organization-managed** (provided by your Kilo organization).

{% callout type="info" %}
The current VS Code extension (built on the Kilo CLI) uses **agent Markdown files** to define custom modes. The legacy extension used `custom_modes.yaml` / `.kilocodemodes`. See the tabs below for the relevant approach.
{% /callout %}

## Why Use Custom Modes?

- **Specialization:** Create modes optimized for specific tasks, like "Documentation Writer," "Test Engineer," or "Refactoring Expert"
- **Safety:** Restrict a mode's access to sensitive files or commands. For example, a "Review Mode" could be limited to read-only operations
- **Experimentation:** Safely experiment with different prompts and configurations without affecting other modes
- **Team Collaboration:** Share custom modes with your team to standardize workflows
- **Organization Consistency:** Use organization-managed agents/custom modes so members share the same behavior for common workflows

## Organization-Managed Custom Modes

If your Kilo organization provides custom modes, Kilo adds them to your local experience as organization-sourced agents/custom modes. They appear alongside built-in and personal agents so members can select them directly where Kilo shows user-selectable agents or modes.

Organization-managed modes are controlled at the organization level:

- An organization-managed mode can use the same name as a built-in agent. When it does, the organization-provided definition takes precedence for members of that organization.
- Individual members cannot remove organization-managed modes from their local agent list. Changes need to be made in the organization-managed definition.
- Organization-managed modes are useful for shared prompts, instructions, and tool access expectations that should stay consistent across a team.

For organization members, contact the person or team that manages Kilo for your organization if an organization mode appears unexpectedly, needs different instructions, or needs different tool access. For admins and support teams, keep the purpose and owner of each organization custom mode clear so members know when to use it and where to request changes.

{% tabs %}
{% tab label="VSCode" %}

In the VSCode extension and CLI, custom behavioral profiles are called **agents** instead of modes. Agents are defined as Markdown files with YAML frontmatter or as entries in the `agent` key of your config file.

## What's Included in a Custom Agent?

| Property | Description |
|---|---|
| **name** (filename) | The agent's identifier, derived from the `.md` filename (e.g., `docs-writer.md` creates an agent named `docs-writer`) |
| **description** | A short summary displayed in the agent picker and used by the orchestrator for delegation |
| **model** | Pin a specific model in `provider/model` format (e.g., `anthropic/claude-sonnet-4-20250514`) |
| **prompt** (markdown body) | The system prompt text — the markdown body of the file, injected into the agent's system prompt |
| **mode** | Role classification: `primary` (user-selectable), `subagent` (only invoked by other agents), or `all` (both) |
| **permission** | Per-agent permission overrides controlling which tools the agent can use (e.g., deny `edit`, `bash`) |
| **color** | Hex color (`#FF5733`) or theme keyword (`primary`, `accent`, `warning`, etc.) for the agent picker UI |
| **steps** | Maximum agentic iterations before forcing a text-only response |
| **temperature** / **top_p** | Sampling parameters for the agent's model |
| **variant** | Default model variant |
| **hidden** | If `true`, the agent is hidden from the UI (only meaningful for subagents) |
| **disable** | If `true`, removes the agent entirely |

## Methods for Creating and Configuring Agents

### 1. Ask Kilo! (Recommended)

Ask Kilo to create an agent for you:

```
Create a new agent called "docs-writer" that can only read files and edit Markdown files.
```

Kilo will generate the agent definition and write it to `.kilo/agent/` in your project.

### 2. Using the Settings UI

You can manage agents through the **Settings → Agent Behaviour → Agents** subtab in the extension. This lets you view, create, and edit agent configurations — including the agent's prompt, model, permissions, and other properties.

### 3. Markdown Files with YAML Frontmatter

Create `.md` files in any of these directories:

```
.kilo/agents/my-agent.md
.kilo/agent/my-agent.md
.kilocode/agents/my-agent.md
```

For global agents, place files in your global config directory:

```
~/.config/kilo/agent/my-agent.md
```

The **filename** (minus `.md`) becomes the agent name. Nested directories create namespaced names (e.g., `agents/backend/sql.md` becomes agent `backend/sql`).

**Example agent file** (`.kilo/agents/docs-writer.md`):

```markdown
---
description: Specialized for writing and editing technical documentation
mode: primary
color: "#10B981"
permission:
  edit:
    "*.md": "allow"
    "*": "deny"
  bash: deny
---

You are a technical documentation specialist. Your expertise includes:

- Writing clear, well-structured documentation
- Following markdown best practices
- Creating helpful code examples

Focus on clarity and completeness. Only edit Markdown files.
```

### 4. Config File (`kilo.jsonc`)

Define agents under the `agent` key in your project's `kilo.jsonc`:

```jsonc
{
  "agent": {
    "docs-writer": {
      "description": "Specialized for writing and editing technical documentation",
      "mode": "primary",
      "color": "#10B981",
      "prompt": "You are a technical documentation specialist...",
      "permission": {
        "edit": {
          "*.md": "allow",
          "*": "deny",
        },
        "bash": "deny",
      },
    },
    // Override a built-in agent
    "code": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "temperature": 0.3,
    },
  },
}
```

## Agent Property Reference

### `mode`

Controls where the agent appears:

| Value | Behavior |
|---|---|
| `primary` | Shown in the agent picker — the user can select it directly |
| `subagent` | Only invokable by other agents via the `task` tool |
| `all` | Available both as a top-level pick and as a subagent (default for user-defined agents) |

### `permission`

An ordered set of rules controlling tool access. Permissions support three actions: `allow`, `deny`, and `ask` (prompt the user). You can use glob patterns to scope rules to specific files or commands:

```yaml
permission:
  edit:
    "*.md": "allow"
    "*": "deny"
  bash: deny
  read: allow
```

Known permission types include: `read`, `edit`, `bash`, `glob`, `grep`, `task`, `webfetch`, `websearch`, `todowrite`, `todoread`, and more.

### `model`

Pin a specific model using the `provider/model` format:

```yaml
model: anthropic/claude-sonnet-4-20250514
```

The model selector also **remembers the last model you picked for each agent** across sessions. A config-pinned `model` acts as the default when no manual pick exists. To reset a pick and let the config take over, use the **reset button** in the model selector (visible when your active model differs from what the config specifies).

### `steps`

Limits the number of agentic iterations (tool call rounds) before the agent is forced to respond with text only. Useful for preventing runaway agents:

```yaml
steps: 25
```

## Configuration Precedence

Agent configurations merge from lowest to highest priority:

1. Built-in (native) agent defaults
2. Global config (`~/.config/kilo/kilo.jsonc`)
3. Project config (`kilo.jsonc` at project root)
4. `.kilo/` / legacy `.kilocode/` directory configs and agent `.md` files
5. Environment variable overrides (`KILO_CONFIG_CONTENT`)

When the same agent name appears at multiple levels, properties are merged (not replaced wholesale), so you can override just a model or temperature without redefining the entire agent.

## Overriding Built-in Agents

Override any built-in agent (**code**, **plan**, **debug**, **ask**, **orchestrator**, **explore**, **general**) by defining an agent with the same name:

```jsonc
// kilo.jsonc — override the built-in "code" agent
{
  "agent": {
    "code": {
      "model": "openai/gpt-4o",
      "temperature": 0.2,
      "permission": {
        "edit": {
          "*.py": "allow",
          "*": "deny",
        },
      },
    },
  },
}
```

Or as a `.md` file (`.kilo/agents/code.md`):

```markdown
---
model: openai/gpt-4o
temperature: 0.2
permission:
  edit:
    "*.py": "allow"
    "*": "deny"
---

You are a Python specialist. Only edit Python files.
```

## Migration from VSCode Extension Modes

If you have existing `.kilocodemodes` or `custom_modes.yaml` files from the VSCode extension, the extension automatically migrates them on startup. The migration converts:

- `slug` to the agent name (key)
- `roleDefinition` + `customInstructions` to `prompt`
- `groups` (e.g., `["read", "edit", "browser"]`) to `permission` rules
- `whenToUse` / `description` to `description`
- Mode is set to `primary`

Default legacy mode slugs (`code`, `build`, `architect`, `ask`, `debug`, `orchestrator`) are skipped during migration since they map to built-in agents (`build` → `code`, `architect` → `plan`).

### Legacy File Locations

The current VSCode extension reads the legacy `custom_modes.yaml` file from its own global storage directory. Helpful for inspecting or fixing the file before the one-time migration runs:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Code/User/globalStorage/kilocode.kilo-code/settings/custom_modes.yaml` |
| Linux | `~/.config/Code/User/globalStorage/kilocode.kilo-code/settings/custom_modes.yaml` |
| Windows | `%APPDATA%\Code\User\globalStorage\kilocode.kilo-code\settings\custom_modes.yaml` |

Project-level `.kilocodemodes` and workspace-scoped files are handled by the CLI backend that the extension delegates to — see the [CLI tab](#cli) for the full load-order table. After the extension migrates on startup, the legacy file is no longer consulted; remove new modes through the extension UI instead of editing `custom_modes.yaml` directly.

{% /tab %}
{% tab label="CLI" %}

In the CLI, custom behavioral profiles are called **agents** instead of modes. Agents are defined as Markdown files with YAML frontmatter or as entries in the `agent` key of your config file.

{% callout type="warning" %}
**Legacy `custom_modes.yaml` is not loaded from `~/.config/kilo/`.** If you're migrating from the previous VS Code extension, global custom modes are read from `~/.kilocode/cli/global/settings/custom_modes.yaml` (not from the CLI's XDG config directory). The recommended approach is to convert legacy modes to agent `.md` files and place them in `~/.config/kilo/agent/` instead — see [Markdown files](#3-markdown-files-with-yaml-frontmatter) and [Migration](#migration-from-vscode-extension-modes) below.
{% /callout %}

## What's Included in a Custom Agent?

| Property | Description |
|---|---|
| **name** (filename) | The agent's identifier, derived from the `.md` filename (e.g., `docs-writer.md` creates an agent named `docs-writer`) |
| **description** | A short summary displayed in the agent picker and used by the orchestrator for delegation |
| **model** | Pin a specific model in `provider/model` format (e.g., `anthropic/claude-sonnet-4-20250514`) |
| **prompt** (markdown body) | The system prompt text — the markdown body of the file, injected into the agent's system prompt |
| **mode** | Role classification: `primary` (user-selectable), `subagent` (only invoked by other agents), or `all` (both) |
| **permission** | Per-agent permission overrides controlling which tools the agent can use (e.g., deny `edit`, `bash`) |
| **color** | Hex color (`#FF5733`) or theme keyword (`primary`, `accent`, `warning`, etc.) for the agent picker UI |
| **steps** | Maximum agentic iterations before forcing a text-only response |
| **temperature** / **top_p** | Sampling parameters for the agent's model |
| **variant** | Default model variant |
| **hidden** | If `true`, the agent is hidden from the UI (only meaningful for subagents) |
| **disable** | If `true`, removes the agent entirely |

## Methods for Creating and Configuring Agents

### 1. Ask Kilo! (Recommended)

Ask Kilo to create an agent for you:

```
Create a new agent called "docs-writer" that can only read files and edit Markdown files.
```

Kilo will generate the agent definition and write it to `.kilo/agent/` in your project.

### 2. Using `kilo agent create`

The CLI provides an interactive command:

```bash
kilo agent create
```

This walks you through selecting a description, mode, and tools, then uses an LLM to generate the agent's system prompt and writes a `.md` file with YAML frontmatter.

### 3. Markdown Files with YAML Frontmatter

Create `.md` files in any of these directories:

```
.kilo/agents/my-agent.md
.kilo/agent/my-agent.md
.kilocode/agents/my-agent.md
```

For global agents, place files in your global config directory:

```
~/.config/kilo/agent/my-agent.md
```

The **filename** (minus `.md`) becomes the agent name. Nested directories create namespaced names (e.g., `agents/backend/sql.md` becomes agent `backend/sql`).

**Example agent file** (`.kilo/agents/docs-writer.md`):

```markdown
---
description: Specialized for writing and editing technical documentation
mode: primary
color: "#10B981"
permission:
  edit:
    "*.md": "allow"
    "*": "deny"
  bash: deny
---

You are a technical documentation specialist. Your expertise includes:

- Writing clear, well-structured documentation
- Following markdown best practices
- Creating helpful code examples

Focus on clarity and completeness. Only edit Markdown files.
```

### 4. Config File (`kilo.jsonc`)

Define agents under the `agent` key in your project's `kilo.jsonc`:

```jsonc
{
  "agent": {
    "docs-writer": {
      "description": "Specialized for writing and editing technical documentation",
      "mode": "primary",
      "color": "#10B981",
      "prompt": "You are a technical documentation specialist...",
      "permission": {
        "edit": {
          "*.md": "allow",
          "*": "deny",
        },
        "bash": "deny",
      },
    },
    // Override a built-in agent
    "code": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "temperature": 0.3,
    },
  },
}
```

## Agent Property Reference

### `mode`

Controls where the agent appears:

| Value | Behavior |
|---|---|
| `primary` | Shown in the agent picker — the user can select it directly |
| `subagent` | Only invokable by other agents via the `task` tool |
| `all` | Available both as a top-level pick and as a subagent (default for user-defined agents) |

### `permission`

An ordered set of rules controlling tool access. Permissions support three actions: `allow`, `deny`, and `ask` (prompt the user). You can use glob patterns to scope rules to specific files or commands:

```yaml
permission:
  edit:
    "*.md": "allow"
    "*": "deny"
  bash: deny
  read: allow
```

Known permission types include: `read`, `edit`, `bash`, `glob`, `grep`, `task`, `webfetch`, `websearch`, `todowrite`, `todoread`, and more.

### `model`

Pin a specific model using the `provider/model` format:

```yaml
model: anthropic/claude-sonnet-4-20250514
```

The TUI also **remembers the last model you picked for each agent** across sessions. A config-pinned `model` acts as the default when no manual pick exists. To reset a pick and let the config take over, use the model picker (`Ctrl+X m`) and select a different model, or remove the saved pick from `~/.local/state/kilo/model.json`.

### `steps`

Limits the number of agentic iterations (tool call rounds) before the agent is forced to respond with text only. Useful for preventing runaway agents:

```yaml
steps: 25
```

## Configuration Precedence

Agent configurations merge from lowest to highest priority:

1. Built-in (native) agent defaults
2. Global config (`~/.config/kilo/kilo.jsonc`)
3. Project config (`kilo.jsonc` at project root)
4. `.kilo/` / legacy `.kilocode/` directory configs and agent `.md` files
5. Environment variable overrides (`KILO_CONFIG_CONTENT`)

When the same agent name appears at multiple levels, properties are merged (not replaced wholesale), so you can override just a model or temperature without redefining the entire agent.

## Overriding Built-in Agents

Override any built-in agent (**code**, **plan**, **debug**, **ask**, **orchestrator**, **explore**, **general**) by defining an agent with the same name:

```jsonc
// kilo.jsonc — override the built-in "code" agent
{
  "agent": {
    "code": {
      "model": "openai/gpt-4o",
      "temperature": 0.2,
      "permission": {
        "edit": {
          "*.py": "allow",
          "*": "deny",
        },
      },
    },
  },
}
```

Or as a `.md` file (`.kilo/agents/code.md`):

```markdown
---
model: openai/gpt-4o
temperature: 0.2
permission:
  edit:
    "*.py": "allow"
    "*": "deny"
---

You are a Python specialist. Only edit Python files.
```

## Migration from VSCode Extension Modes

If you have existing `.kilocodemodes` or `custom_modes.yaml` files from the VSCode extension, the CLI automatically migrates them on startup. The migration converts:

- `slug` to the agent name (key)
- `roleDefinition` + `customInstructions` to `prompt`
- `groups` (e.g., `["read", "edit", "browser"]`) to `permission` rules
- `whenToUse` / `description` to `description`
- Mode is set to `primary`

Default legacy mode slugs (`code`, `build`, `architect`, `ask`, `debug`, `orchestrator`) are skipped during migration since they map to built-in agents (`build` → `code`, `architect` → `plan`).

### Legacy File Lookup Paths

The CLI reads legacy mode files from the following locations (in load order). When the same slug appears in multiple sources, the **last loaded source wins**:

| Load Order | Path | Format | Scope |
|---|---|---|---|
| 1 | VSCode extension global storage `/settings/custom_modes.yaml` | YAML | Global |
| 2 | `~/.kilocode/cli/global/settings/custom_modes.yaml` | YAML | Global |
| 3 | `~/.kilocodemodes` | YAML | Global |
| 4 | `<project>/.kilocodemodes` | YAML | Project (wins on conflict) |

{% callout type="info" %}
`~/.config/kilo/` is the XDG config directory for the new agent format — legacy `custom_modes.yaml` placed there will **not** be loaded. Use `~/.config/kilo/agent/*.md` or `~/.config/kilo/kilo.jsonc` for new agent definitions instead.
{% /callout %}

{% /tab %}
{% /tabs %}

## Restricting Agent File Access

Agents use ordered permission rules with glob patterns. Each rule can `allow`, `deny`, or `ask`, and the last matching rule wins. Put broad defaults first and more specific exceptions afterward:

```jsonc
{
  "permission": {
    "edit": {
      "*": "deny",
      "*.md": "allow",
      "docs/**": "allow",
    },
  },
}
```

This example prevents the agent from editing files by default while allowing Markdown files and everything under `docs/`. Define rules for other tools such as `read` and `bash` when an agent needs different access per operation.

{% callout type="tip" %}
Ask Kilo to create or validate permission glob patterns when you need more complex file restrictions.
{% /callout %}

## Example Configurations

{% tabs %}
{% tab label="VSCode" %}

### Basic Documentation Writer (`.kilo/agents/docs-writer.md`)

```markdown
---
description: Specialized for writing and editing technical documentation
mode: primary
color: "#10B981"
permission:
  edit:
    "*.md": "allow"
    "*": "deny"
  bash: deny
---

You are a technical writer specializing in clear documentation.
Focus on clear explanations and examples.
```

### Test Engineer (`.kilo/agents/test-engineer.md`)

```markdown
---
description: Focused on writing and maintaining test suites
mode: primary
color: "#F59E0B"
permission:
  edit:
    "*.{test,spec}.{js,ts}": "allow"
    "*": "deny"
---

You are a test engineer focused on code quality.
Use for writing tests, debugging test failures, and improving test coverage.
```

### Security Reviewer (`.kilo/agents/security-review.md`)

```markdown
---
description: Read-only security analysis and vulnerability assessment
mode: primary
color: "#EF4444"
permission:
  edit: deny
  bash: deny
---

You are a security specialist reviewing code for vulnerabilities.

Focus on:

- Input validation issues
- Authentication and authorization flaws
- Data exposure risks
- Injection vulnerabilities
```

### Config File Example (`kilo.jsonc`)

```jsonc
{
  "agent": {
    "docs-writer": {
      "description": "Specialized for writing and editing technical documentation",
      "mode": "primary",
      "color": "#10B981",
      "prompt": "You are a technical writer specializing in clear documentation.",
      "permission": {
        "edit": { "*.md": "allow", "*": "deny" },
        "bash": "deny",
      },
    },
    "test-engineer": {
      "description": "Focused on writing and maintaining test suites",
      "mode": "primary",
      "prompt": "You are a test engineer focused on code quality.",
      "permission": {
        "edit": { "*.{test,spec}.{js,ts}": "allow", "*": "deny" },
      },
    },
  },
}
```

{% /tab %}
{% tab label="CLI" %}

### Basic Documentation Writer (`.kilo/agents/docs-writer.md`)

```markdown
---
description: Specialized for writing and editing technical documentation
mode: primary
color: "#10B981"
permission:
  edit:
    "*.md": "allow"
    "*": "deny"
  bash: deny
---

You are a technical writer specializing in clear documentation.
Focus on clear explanations and examples.
```

### Test Engineer (`.kilo/agents/test-engineer.md`)

```markdown
---
description: Focused on writing and maintaining test suites
mode: primary
color: "#F59E0B"
permission:
  edit:
    "*.{test,spec}.{js,ts}": "allow"
    "*": "deny"
---

You are a test engineer focused on code quality.
Use for writing tests, debugging test failures, and improving test coverage.
```

### Security Reviewer (`.kilo/agents/security-review.md`)

```markdown
---
description: Read-only security analysis and vulnerability assessment
mode: primary
color: "#EF4444"
permission:
  edit: deny
  bash: deny
---

You are a security specialist reviewing code for vulnerabilities.

Focus on:

- Input validation issues
- Authentication and authorization flaws
- Data exposure risks
- Injection vulnerabilities
```

### Config File Example (`kilo.jsonc`)

```jsonc
{
  "agent": {
    "docs-writer": {
      "description": "Specialized for writing and editing technical documentation",
      "mode": "primary",
      "color": "#10B981",
      "prompt": "You are a technical writer specializing in clear documentation.",
      "permission": {
        "edit": { "*.md": "allow", "*": "deny" },
        "bash": "deny",
      },
    },
    "test-engineer": {
      "description": "Focused on writing and maintaining test suites",
      "mode": "primary",
      "prompt": "You are a test engineer focused on code quality.",
      "permission": {
        "edit": { "*.{test,spec}.{js,ts}": "allow", "*": "deny" },
      },
    },
  },
}
```

{% /tab %}
{% /tabs %}

## Troubleshooting

{% tabs %}
{% tab label="VSCode" %}

### Common Issues

- **Agent not appearing:** Ensure the `.md` file is in a recognized directory (`.kilo/agents/`, `.kilo/agent/`, `.kilocode/agents/`). Check that the `mode` property is `primary` or `all` if you expect it in the agent picker.
- **Permission errors:** Permission rules are evaluated last-match-wins. If an agent can't use a tool you expect, check that an `allow` rule appears after any `deny` rules for that permission.
- **YAML frontmatter parse errors:** Ensure the frontmatter block starts and ends with `---` on its own line. Validate that YAML keys match expected property names (e.g., `top_p` not `topP`).
- **Agent overrides not working:** Config merges from global to project level. If a global config sets a property, your project config can override it, but both must use the same agent name.

### Tips for Agent Definitions

- **Keep prompts focused:** The markdown body is your system prompt — write it as if briefing a colleague
- **Use `mode: subagent`** for helper agents that shouldn't be directly selectable by users
- **Use the Settings UI** to view and edit agents through the **Settings → Agent Behaviour → Agents** subtab
- **Legacy modes are auto-migrated:** If you have `.kilocodemodes` files, they'll be converted on startup — no manual migration needed

{% /tab %}
{% tab label="CLI" %}

### Common Issues

- **Agent not appearing:** Ensure the `.md` file is in a recognized directory (`.kilo/agents/`, `.kilo/agent/`, `.kilocode/agents/`). Check that the `mode` property is `primary` or `all` if you expect it in the agent picker.
- **Permission errors:** Permission rules are evaluated last-match-wins. If an agent can't use a tool you expect, check that an `allow` rule appears after any `deny` rules for that permission.
- **YAML frontmatter parse errors:** Ensure the frontmatter block starts and ends with `---` on its own line. Validate that YAML keys match expected property names (e.g., `top_p` not `topP`).
- **Agent overrides not working:** Config merges from global to project level. If a global config sets a property, your project config can override it, but both must use the same agent name.

### Tips for Agent Definitions

- **Keep prompts focused:** The markdown body is your system prompt — write it as if briefing a colleague
- **Use `mode: subagent`** for helper agents that shouldn't be directly selectable by users
- **Test with `kilo agent create`** to see how the CLI generates agent definitions, then customize from there
- **Legacy modes are auto-migrated:** If you have `.kilocodemodes` files, they'll be converted on startup — no manual migration needed

{% /tab %}
{% /tabs %}

## Community Gallery

Ready to explore more? Check out the [Show and Tell](https://github.com/Kilo-Org/kilocode/discussions/categories/show-and-tell) to discover and share custom modes and agents created by the community!
