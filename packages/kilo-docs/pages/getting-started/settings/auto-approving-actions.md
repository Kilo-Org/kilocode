---
title: "Auto-Approving Actions"
description: "Configure automatic approval settings for Kilo Code operations"
---

# Auto-Approving Actions

{% callout type="danger" %}
**Security Warning:** Auto-approve settings bypass confirmation prompts, giving Kilo Code direct access to your system. This can result in data loss, file corruption, or worse. Command line access is particularly dangerous, as it can potentially execute harmful operations that could damage your system or compromise security. Only enable auto-approval for actions you fully trust.
{% /callout %}

Auto-approve settings speed up your workflow by eliminating repetitive confirmation prompts, but they significantly increase security risks. The VS Code extension and CLI share the same permission model; choose the tab that matches how you configure Kilo Code.

{% tabs %}
{% tab label="VSCode" %}

## Overview

The extension uses a granular, per-tool permission system. You can configure permissions through the **Settings → Auto Approve** tab, which provides a UI with per-tool **Allow / Ask / Deny** dropdowns.

The UI reads and writes to the same `kilo.jsonc` config files used by the CLI, so changes made in either place are reflected in both.

## Permission Levels

Each tool permission can be set to one of three values:

| Value | Behavior |
|---|---|
| `"allow"` | The tool runs automatically without prompting |
| `"ask"` | Kilo pauses and asks for approval before running the tool |
| `"deny"` | The tool is blocked entirely |

When no rule matches a permission check, the default action is `ask`.

## Available Tool Permissions

The Auto Approve tab lists the following tool-specific permissions. Some tools are grouped together in the UI and share a single permission level:

| Permission | Controls |
|---|---|
| `external_directory` | Accessing files outside the project directory |
| `bash` | Executing shell commands |
| `read` | Reading file contents |
| `edit` | Editing existing files |
| `glob` | File pattern matching / searching by name |
| `grep` | Searching file contents by regex |
| `task` | Launching sub-agents |
| `agent_manager` | Starting Agent Manager local or worktree sessions |
| `skill` | Loading specialized skills |
| `lsp` | Language server protocol operations |
| `todoread` / `todowrite` | Reading and updating the todo list |
| `websearch` | Performing web searches |
| `webfetch` | Fetching content from URLs |
| `doom_loop` | Allowing the agent to continue after repeated failures |

## Runtime Permission Requests

When a tool is set to `"ask"`, Kilo pauses and displays a permission prompt with two options:

| Option | Behavior |
|---|---|
| **Run** | Allow this specific invocation |
| **Deny** | Block this specific invocation |

Use the shield button in the prompt controls to toggle runtime auto-approve for permission prompts without opening Settings. When enabled, the shield is highlighted and pending permission prompts are approved automatically. The runtime state stays synced across the sidebar, open Kilo tabs, and Agent Manager session views.

Expand **Manage Auto-Approve Rules** to add commands or patterns to your allowed or denied lists. These rules are then appended to the bottom of the approval rules in settings and the config file.

For the `agent_manager` tool, runtime approvals use the requested mode as the pattern: `worktree` or `local`.

## MCP Tool Permissions

MCP tools use the same `allow` / `ask` / `deny` permission system as built-in tools. Each MCP tool's permission key is its namespaced name: `{server}_{tool}` (e.g. `github_create_pull_request`). You can use glob patterns like `github_*` for broad rules.

For full details and examples, see [MCP Tool Permissions](/docs/automate/mcp/using-in-kilo-code#auto-approve-tools).

## Defaults

Most tools default to `"*": "allow"` for a smooth out-of-the-box experience. Notable exceptions that prompt by default:

- **`.env` files** — reading `.env` files prompts for approval. Files matching `*.env.*` (e.g., `.env.local`, `.env.production`) also trigger an ask, while `*.env.example` is explicitly allowed.
- **`external_directory`** — accessing files outside the project prompts for approval
- **`doom_loop`** — prompts when the agent enters a repeated failure cycle

{% /tab %}
{% tab label="CLI" %}

## Overview

The CLI uses a granular, per-tool permission system configured in `kilo.jsonc`. Instead of broad categories like "read" or "write," each tool has its own permission level with glob-pattern rules for fine-grained control.

## Permission Levels

Each tool permission can be set to one of three values:

| Value | Behavior |
|---|---|
| `"allow"` | The tool runs automatically without prompting |
| `"ask"` | Kilo pauses and asks for approval before running the tool |
| `"deny"` | The tool is blocked entirely |

When no rule matches a permission check, the default action is `ask`.

## Available Tool Permissions

Permissions are configured under the `permission` key in `kilo.jsonc`. The following tool-specific permission levels are available:

| Permission | Controls |
|---|---|
| `external_directory` | Accessing files outside the project directory |
| `bash` | Executing shell commands |
| `read` | Reading file contents |
| `edit` | Editing existing files |
| `glob` | File pattern matching / searching by name |
| `grep` | Searching file contents by regex |
| `task` | Launching sub-agents |
| `skill` | Loading specialized skills |
| `lsp` | Language server protocol operations |
| `todoread` / `todowrite` | Reading and updating the todo list |
| `websearch` | Performing web searches |
| `webfetch` | Fetching content from URLs |
| `doom_loop` | Allowing the agent to continue after repeated failures |

## Glob-Pattern Rules

Instead of a simple `"allow"` or `"deny"`, each tool can use glob-pattern rules for granular control. Patterns are matched against the tool's arguments (command strings, file paths, etc.), and the last matching rule wins.

### Rule Precedence

Permission rules are evaluated in config order. When more than one rule matches the requested permission and target pattern, the last matching rule wins.

Put broad fallbacks first and exceptions after them:

```json
{
  "permission": {
    "bash": {
      "*": "ask",
      "uv *": "allow"
    }
  }
}
```

With that config, `uv pip install ...` is allowed because `uv *` appears after the catch-all `*`.

If you put the catch-all last, it overrides the earlier specific rule:

```json
{
  "permission": {
    "bash": {
      "uv *": "allow",
      "*": "ask"
    }
  }
}
```

With that config, `uv pip install ...` asks because the later `*` rule also matches.

### Example: Shell Commands

Allow git commands automatically, but prompt for everything else:

```json
{
  "permission": {
    "bash": {
      "*": "ask",
      "git *": "allow"
    }
  }
}
```

### Example: File Reading

Prompt before reading `.env` files, but allow all other reads:

```json
{
  "permission": {
    "read": {
      "*": "allow",
      "*.env": "ask"
    }
  }
}
```

### Example: Blocking Dangerous Commands

Deny `rm -rf` commands, allow common dev commands, and ask for anything else:

```json
{
  "permission": {
    "bash": {
      "*": "ask",
      "rm -rf *": "deny",
      "npm *": "allow",
      "bun *": "allow",
      "git *": "allow"
    }
  }
}
```

## Per-Agent Permission Overrides

Different agents can have different permission levels. Override the default permissions for a specific agent under the `agent.<name>.permission` key:

```json
{
  "permission": {
    "bash": { "*": "ask" }
  },
  "agent": {
    "code": {
      "permission": {
        "bash": { "*": "ask", "git *": "allow" }
      }
    },
    "plan": {
      "permission": {
        "bash": { "*": "deny" }
      }
    }
  }
}
```

In this example, the `code` agent can run `git` commands automatically and asks for other shell commands, while the `plan` agent cannot run shell commands at all.

## Markdown Agent Files

If you define agents in Markdown files, the `permission` frontmatter uses the same `allow` / `ask` / `deny` values and glob patterns as `kilo.jsonc`:

```markdown
---
description: Reviews code for quality and best practices
mode: subagent
permission:
  bash:
    "*": ask
    "git *": allow
  read:
    "*": allow
    "*.env": ask
---
```

This is the same permission shape described in [Agent Permissions](/docs/customize/agent-permissions), just shown in the agent-file format.

## Runtime Permission Requests

When a tool is set to `"ask"`, Kilo pauses and displays a permission prompt. You have three options:

| Option | Behavior |
|---|---|
| **Allow once** | Allow this specific invocation only |
| **Allow always** | Save an allow rule for the matching tool or pattern in your global config |
| **Reject** | Block this specific invocation |

For shell commands, saved approvals are written under `permission.bash` and apply across CLI sessions.

## Defaults

Most tools default to `"*": "allow"` for a smooth out-of-the-box experience. Notable exceptions that prompt by default:

- **`.env` files** — reading `.env` files prompts for approval. Files matching `*.env.*` (e.g., `.env.local`, `.env.production`) also trigger an ask, while `*.env.example` is explicitly allowed.
- **`external_directory`** — accessing files outside the project prompts for approval
- **`doom_loop`** — prompts when the agent enters a repeated failure cycle

## MCP Tool Permissions

MCP tools use the same `allow` / `ask` / `deny` permission system as built-in tools. Each MCP tool's permission key is its namespaced name: `{server}_{tool}` (e.g. `github_create_pull_request`). You can use glob patterns like `github_*` for broad rules.

For full details and examples, see [MCP Tool Permissions](/docs/automate/mcp/using-in-kilo-code#auto-approve-tools).

## Full Configuration Example

{% callout type="info" %}
This is a custom example showing the available configuration options — it does not represent the shipped defaults.
{% /callout %}

```json
{
  "permission": {
    "read": { "*": "allow", "*.env": "ask" },
    "edit": { "*": "allow", "*.env": "ask" },
    "glob": { "*": "allow" },
    "grep": { "*": "allow" },
    "list": { "*": "allow" },
    "bash": { "*": "ask", "git *": "allow", "npm *": "allow" },
    "task": { "*": "allow" },
    "skill": { "*": "allow" },
    "lsp": { "*": "allow" },
    "todoread": { "*": "allow" },
    "todowrite": { "*": "allow" },
    "webfetch": { "*": "allow" },
    "websearch": { "*": "allow" },
    "external_directory": { "*": "ask" },
    "doom_loop": { "*": "ask" }
  },
  "agent": {
    "code": {
      "permission": {
        "bash": { "*": "ask", "git *": "allow", "npm *": "allow" }
      }
    }
  }
}
```

{% /tab %}
{% /tabs %}
