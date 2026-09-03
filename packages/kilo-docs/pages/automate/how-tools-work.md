---
title: How Tools Work
description: Learn how Kilo Code's tools automate your development workflow
---

# How Tools Work

Kilo Code uses tools to interact with your code and environment. These specialized helpers perform specific actions like reading files, making edits, running commands, or searching your codebase. Tools provide automation for common development tasks without requiring manual execution.

## Tool Workflow

Describe what you want to accomplish in natural language, and Kilo Code will:

1. Select the appropriate tool based on your request
2. Present the tool with its parameters for your review
3. Execute the approved tool and show you the results
4. Continue this process until your task is complete

## Tool Categories

| Category | Purpose | Tool Names |
|:---|:---|:---|
| Read | Access file content and code structure | `read`, `glob`, `grep` |
| Edit | Create or modify files and code | `edit`, `write`, `apply_patch` |
| Execute | Run commands and perform system operations | `bash` |
| Web | Fetch and search web content | `webfetch`, `websearch` |
| Workflow | Manage task flow and sub-agents | `question`, `task`, `todowrite`, `todoread`, `plan`, `skill` |

## Example: Using Tools

Here's how a typical tool interaction works:

{% callout type="info" title="Tool Approval UI" %}
When a tool is proposed, you'll see an approval prompt in the **Permission Dock** at the bottom of the chat. You can approve once, approve always (saves to config), or deny.
{% /callout %}

**User:** Create a file named `greeting.js` that logs a greeting message

**Kilo Code:** (Proposes the `write` tool)

The extension shows the file path and proposed content for review. Click **Approve** to execute or **Deny** to cancel.

## Tool Safety and Approval

Every tool use is subject to a permission check. The default action for any tool with no matching rule in your config is **`ask`** — meaning Kilo will pause and prompt you before executing it.

**Default permissions by tool:**

| Tool(s) | Default |
|:---|:---|
| `read`, `glob`, `grep` | `ask` |
| `edit`, `write`, `apply_patch` | `ask` |
| `bash` | `ask` (per-command) |
| `external_directory` | `ask` (when accessing paths outside the project) |
| `task` | `ask` |
| `webfetch`, `websearch` | `ask` |
| `todowrite`, `todoread`, `question`, `skill` | `ask` |

No tools are auto-approved out of the box. You must explicitly grant `allow` in your config, or approve them at runtime.

**At runtime**, the **Permission Dock** floating UI in the chat panel shows each pending approval. For each tool call you can:

- **Approve once** — execute this call only
- **Approve always** — save an `allow` rule to your config so future matching calls are auto-approved
- **Deny** — cancel the tool call

To pre-configure permissions in your config file:

```json
{
  "permission": {
    "read": "allow",
    "glob": "allow",
    "grep": "allow",
    "edit": "ask",
    "bash": "ask"
  }
}
```

This safety mechanism ensures you maintain control over which files are modified, what commands are executed, and how your codebase is changed.

## Core Tools Reference

| Tool Name | Description | Category |
|:---|:---|:---|
| `read` | Reads file contents with line numbers | Read |
| `glob` | Finds files by glob pattern | Read |
| `grep` | Searches file contents with regex | Read |
| `edit` | Makes precise text replacements in a file | Edit |
| `write` | Creates new files or overwrites existing ones | Edit |
| `apply_patch` | Applies unified diffs (used with certain models) | Edit |
| `bash` | Runs shell commands | Execute |
| `webfetch` | Fetches a URL | Web |
| `websearch` | Searches the web (Kilo/OpenRouter users) | Web |
| `question` | Asks you a clarifying question with selectable options | Workflow |
| `task` | Spawns a sub-agent session | Workflow |
| `todowrite` | Creates and updates a session TODO list | Workflow |
| `todoread` | Reads the current session TODO list | Workflow |
| `plan` | Enters structured planning mode | Workflow |
| `skill` | Invokes a reusable skill (Markdown instruction module) | Workflow |

## Learn More About Tools

For more detailed information about each tool, including complete parameter references and advanced usage patterns, see the [Tool Use Overview](/docs/automate/tools) documentation.
