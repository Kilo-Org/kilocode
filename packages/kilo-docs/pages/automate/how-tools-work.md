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

{% tabs %}
{% tab label="VSCode" %}

| Category | Purpose | Tool Names |
|:---|:---|:---|
| Read | Access file content and code structure | `read`, `glob`, `grep` |
| Edit | Create or modify files and code | `edit`, `multiedit`, `write`, `apply_patch` |
| Execute | Run commands and perform system operations | `bash` |
| Web | Fetch and search web content | `webfetch`, `websearch`, `codesearch` |
| Workflow | Manage task flow and sub-agents | `question`, `task`, `todowrite`, `todoread`, `plan`, `skill` |

{% /tab %}
{% tab label="VSCode (Legacy)" %}

| Category | Purpose | Tool Names |
|:---|:---|:---|
| Read | Access file content and code structure | `read_file`, `search_files`, `list_files`, `list_code_definition_names` |
| Edit | Create or modify files and code | `apply_diff`, `delete_file`, `write_to_file` |
| Execute | Run commands and perform system operations | `execute_command` |
| Browser | Interact with web content | `browser_action` |
| Workflow | Manage task flow and context | `ask_followup_question`, `attempt_completion`, `switch_mode`, `new_task` |

{% /tab %}
{% /tabs %}

## Example: Using Tools

Here's how a typical tool interaction works:

{% tabs %}
{% tab label="VSCode" %}

{% callout type="info" title="Tool Approval UI" %}
When a tool is proposed, you'll see an approval prompt in the **Permission Dock** at the bottom of the chat. You can approve once, approve always (saves to config), or deny.
{% /callout %}

**User:** Create a file named `greeting.js` that logs a greeting message

**Kilo Code:** (Proposes the `write` tool)

The extension shows the file path and proposed content for review. Click **Approve** to execute or **Deny** to cancel.

{% /tab %}
{% tab label="VSCode (Legacy)" %}

{% callout type="info" title="Tool Approval UI" %}
When a tool is proposed, you'll see Save and Reject buttons along with an optional Auto-approve checkbox for trusted operations.
{% /callout %}

**User:** Create a file named `greeting.js` that logs a greeting message

**Kilo Code:** (Proposes the `write_to_file` tool as shown in the image above)

```xml
<write_to_file>
<path>greeting.js</path>
<content>
function greet(name) {
  console.log(`Hello, ${name}!`);
}

greet('World');
</content>
<line_count>5</line_count>
</write_to_file>
```

**User:** (Clicks "Save" in the interface)

**Kilo Code:** (Confirms file creation)

{% /tab %}
{% /tabs %}

## Tool Safety and Approval

{% tabs %}
{% tab label="VSCode" %}

Every tool use is subject to a permission check. The default action for any tool with no matching rule in your config is **`ask`** — meaning Kilo will pause and prompt you before executing it.

**Default permissions by tool:**

| Tool(s) | Default |
|:---|:---|
| `read`, `glob`, `grep`, `list` | `ask` |
| `edit`, `write`, `multiedit`, `apply_patch` | `ask` |
| `bash` | `ask` (per-command) |
| `external_directory` | `ask` (when accessing paths outside the project) |
| `task` | `ask` |
| `webfetch`, `websearch`, `codesearch` | `ask` |
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

{% /tab %}
{% tab label="VSCode (Legacy)" %}

Every tool use requires your explicit approval. When Kilo proposes a tool, you'll see:

- A "Save" button to approve and execute the tool
- A "Reject" button to decline the proposed tool
- An optional "Auto-approve" setting for trusted operations

This safety mechanism ensures you maintain control over which files are modified, what commands are executed, and how your codebase is changed. Always review tool proposals carefully before saving them.

{% /tab %}
{% /tabs %}

## Core Tools Reference

{% tabs %}
{% tab label="VSCode" %}

| Tool Name | Description | Category |
|:---|:---|:---|
| `read` | Reads file contents with line numbers | Read |
| `glob` | Finds files by glob pattern | Read |
| `grep` | Searches file contents with regex | Read |
| `edit` | Makes precise text replacements in a file | Edit |
| `multiedit` | Multiple edits in a single call | Edit |
| `write` | Creates new files or overwrites existing ones | Edit |
| `apply_patch` | Applies unified diffs (used with certain models) | Edit |
| `bash` | Runs shell commands | Execute |
| `webfetch` | Fetches a URL | Web |
| `websearch` | Searches the web (Kilo/OpenRouter users) | Web |
| `codesearch` | Semantic code search (Kilo/OpenRouter users) | Web |
| `question` | Asks you a clarifying question with selectable options | Workflow |
| `task` | Spawns a sub-agent session | Workflow |
| `todowrite` | Creates and updates a session TODO list | Workflow |
| `todoread` | Reads the current session TODO list | Workflow |
| `plan` | Enters structured planning mode | Workflow |
| `skill` | Invokes a reusable skill (Markdown instruction module) | Workflow |

{% /tab %}
{% tab label="VSCode (Legacy)" %}

| Tool Name | Description | Category |
|:---|:---|:---|
| `read_file` | Reads the content of a file with line numbers | Read |
| `search_files` | Searches for text or regex patterns across files | Read |
| `list_files` | Lists files and directories in a specified location | Read |
| `list_code_definition_names` | Lists code definitions like classes and functions | Read |
| `write_to_file` | Creates new files or overwrites existing ones | Edit |
| `apply_diff` | Makes precise changes to specific parts of a file | Edit |
| `delete_file` | Removes files from the workspace | Edit |
| `execute_command` | Runs commands in the VS Code terminal | Execute |
| `browser_action` | Performs actions in a headless browser | Browser |
| `ask_followup_question` | Asks you a clarifying question | Workflow |
| `attempt_completion` | Indicates the task is complete | Workflow |
| `switch_mode` | Changes to a different operational mode | Workflow |
| `new_task` | Creates a new subtask with a specific starting mode | Workflow |

{% /tab %}
{% /tabs %}

## Learn More About Tools

For more detailed information about each tool, including complete parameter references and advanced usage patterns, see the [Tool Use Overview](/docs/automate/tools) documentation.
