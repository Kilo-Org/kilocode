---
title: "Custom Agents"
description: "Configure custom agents in the Kilo CLI"
---

# Custom Agents

Custom agents are specialized AI assistants you define in your config file. Each agent can have its own model, system prompt, tool access, and permissions — letting you tailor behavior for specific tasks like code review, documentation, or security auditing.

## Agent Types

There are two types of agents:

| Type         | Description                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------- |
| **Primary**  | Main agents you interact with directly. Switch between them with **Tab** or the `/agents` command. |
| **Subagent** | Specialized agents invoked by primary agents for subtasks, or manually via `@agent-name` mentions. |

Kilo CLI ships with two built-in primary agents (**Build** and **Plan**) and two built-in subagents (**General** and **Explore**). You can customize these or create entirely new agents.

## Configuration

Define agents in the `agent` section of your `opencode.json` config file.

### Config file locations

| Scope       | Path                              |
| ----------- | --------------------------------- |
| **Global**  | `~/.config/kilo/opencode.json`    |
| **Project** | `./opencode.json` in project root |

Project-level configuration takes precedence over global settings.

### JSON configuration

```json
{
  "$schema": "https://app.kilo.ai/config.json",
  "agent": {
    "code-reviewer": {
      "description": "Reviews code for best practices and potential issues",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "You are a code reviewer. Focus on security, performance, and maintainability.",
      "tools": {
        "write": false,
        "edit": false
      }
    }
  }
}
```

### Markdown configuration

You can also define agents as markdown files. Place them in:

- **Global:** `~/.config/kilo/agents/`
- **Per-project:** `.opencode/agents/`

The filename becomes the agent name (e.g., `review.md` creates a `review` agent).

```markdown
---
description: Reviews code for quality and best practices
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
tools:
  write: false
  edit: false
  bash: false
---

You are in code review mode. Focus on:

- Code quality and best practices
- Potential bugs and edge cases
- Performance implications
- Security considerations

Provide constructive feedback without making direct changes.
```

## Configuration Fields

### Required

| Field         | Type   | Description                                                  |
| ------------- | ------ | ------------------------------------------------------------ |
| `description` | string | Brief description of what the agent does and when to use it. |

### Optional

| Field         | Type    | Default   | Description                                                                                                                           |
| ------------- | ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`        | string  | `"all"`   | Agent type: `"primary"`, `"subagent"`, or `"all"`.                                                                                    |
| `model`       | string  | inherited | Model ID in `provider/model-id` format. Primary agents inherit the global model; subagents inherit from their invoking primary agent. |
| `prompt`      | string  | —         | Custom system prompt. Use `{file:./path/to/prompt.txt}` to load from a file.                                                          |
| `temperature` | number  | —         | Controls response randomness (0.0–1.0). Lower = more deterministic.                                                                   |
| `top_p`       | number  | —         | Alternative to temperature for controlling response diversity.                                                                        |
| `steps`       | number  | —         | Maximum agentic iterations before the agent must respond with text.                                                                   |
| `tools`       | object  | —         | Enable/disable specific tools. Set tool names to `true` or `false`.                                                                   |
| `permission`  | object  | —         | Per-agent permission overrides for `edit`, `bash`, and `webfetch`.                                                                    |
| `hidden`      | boolean | `false`   | Hide a subagent from the `@` autocomplete menu.                                                                                       |
| `disable`     | boolean | `false`   | Disable the agent entirely.                                                                                                           |
| `color`       | string  | —         | Hex color (e.g., `"#FF5733"`) or theme color for the agent's UI appearance.                                                           |

{% callout type="tip" %}
Any additional options in the agent config are passed through directly to the provider as model options. This lets you use provider-specific parameters like `reasoningEffort` for OpenAI models.
{% /callout %}

### Tools

Control tool access per agent:

```json
{
  "agent": {
    "readonly": {
      "description": "Read-only analysis agent",
      "mode": "subagent",
      "tools": {
        "write": false,
        "edit": false,
        "bash": false
      }
    }
  }
}
```

Wildcards are supported for disabling groups of tools (e.g., all tools from an MCP server):

```json
{
  "agent": {
    "no-mcp": {
      "description": "Agent without MCP tools",
      "tools": {
        "mymcp_*": false
      }
    }
  }
}
```

### Permissions

Override global permissions per agent. Each tool permission can be `"allow"`, `"ask"`, or `"deny"`:

```json
{
  "agent": {
    "cautious-builder": {
      "description": "Builder that asks before running commands",
      "mode": "primary",
      "permission": {
        "edit": "ask",
        "bash": {
          "*": "ask",
          "git status *": "allow"
        }
      }
    }
  }
}
```

## Creating Agents via CLI

Use the interactive agent creation command:

```bash
kilo agent create
```

This walks you through selecting a save location, writing a description, choosing tools, and generates a markdown agent file.

## Example: Documentation Writer

```json
{
  "$schema": "https://app.kilo.ai/config.json",
  "agent": {
    "docs-writer": {
      "description": "Writes and maintains project documentation",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "You are a technical writer. Create clear, comprehensive documentation with proper structure, code examples, and user-friendly language.",
      "tools": {
        "bash": false
      }
    }
  }
}
```

## Switching and Invoking Agents

- **Primary agents:** Press **Tab** to cycle through them, or use the `/agents` command.
- **Subagents:** Type `@agent-name` in your message to invoke a specific subagent (e.g., `@docs-writer help me document this module`).
- **Automatic:** Primary agents can invoke subagents automatically based on their descriptions.
