---
title: "Custom Agents"
description: "Configure custom agents in the Kilo CLI"
---

# {% $markdoc.frontmatter.title %}

Custom agents are specialized AI assistants you can configure for specific tasks and workflows. They let you define focused tools with their own system prompts, models, tool access, and permissions.

The Kilo CLI ships with two built-in primary agents (**Build** and **Plan**) and two built-in subagents (**General** and **Explore**). You can customize these or create entirely new agents.

## Agent Types

| Type | Description |
| --- | --- |
| **Primary** | Main agents you interact with directly. Switch between them with **Tab**. |
| **Subagent** | Specialized agents invoked by primary agents or via `@mention` in your messages. |

## Creating Agents

### Interactive

Use the built-in command to scaffold a new agent:

```bash
kilo agent create
```

This walks you through choosing a save location (global or project), writing a description, selecting tools, and generating a markdown agent file.

### JSON Configuration

Add an `agent` key to your `opencode.json` config file:

```json
{
  "$schema": "https://kilo.ai/config.json",
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

### Markdown Configuration

You can also define agents as markdown files. Place them in:

- **Global:** `~/.config/kilo/agents/`
- **Per-project:** `.opencode/agents/`

The filename becomes the agent name. For example, `review.md` creates a `review` agent.

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

## Configuration Options

### Required

| Field | Type | Description |
| --- | --- | --- |
| `description` | `string` | Brief description of what the agent does and when to use it. |

### Common Options

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `"primary"` \| `"subagent"` \| `"all"` | `"all"` | How the agent can be used. |
| `model` | `string` | Inherited | Model ID in `provider/model-id` format. Primary agents default to the globally configured model; subagents use the invoking agent's model. |
| `prompt` | `string` | — | Custom system prompt, or a file reference like `{file:./prompts/review.txt}`. Path is relative to the config file location. |
| `tools` | `object` | — | Enable or disable specific tools. Set tool names to `true` or `false`. Supports wildcards (e.g., `"mymcp_*": false`). |
| `temperature` | `number` | Model default | Controls response randomness (0.0–1.0). Lower = more deterministic. |
| `steps` | `number` | Unlimited | Maximum agentic iterations before the agent must respond with text only. |
| `disable` | `boolean` | `false` | Set `true` to disable the agent. |
| `hidden` | `boolean` | `false` | Hide a subagent from the `@` autocomplete menu. It can still be invoked by other agents via the Task tool. |
| `color` | `string` | — | Hex color (e.g., `#FF5733`) or theme color (`primary`, `accent`, `warning`, etc.) for the agent's UI appearance. |
| `top_p` | `number` | — | Alternative to temperature for controlling response diversity (0.0–1.0). |

### Permissions

Override global permissions per agent using the `permission` key:

```json
{
  "$schema": "https://kilo.ai/config.json",
  "agent": {
    "build": {
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

Permission values: `"allow"`, `"ask"`, or `"deny"`. Bash permissions support glob patterns, with the last matching rule winning.

You can also control which subagents an agent can invoke via `permission.task`:

```json
{
  "$schema": "https://kilo.ai/config.json",
  "agent": {
    "orchestrator": {
      "mode": "primary",
      "permission": {
        "task": {
          "*": "deny",
          "orchestrator-*": "allow"
        }
      }
    }
  }
}
```

### Pass-Through Options

Any additional fields in your agent configuration are passed directly to the provider as model options. This lets you use provider-specific parameters:

```json
{
  "$schema": "https://kilo.ai/config.json",
  "agent": {
    "deep-thinker": {
      "description": "Uses high reasoning effort for complex problems",
      "model": "openai/gpt-5",
      "reasoningEffort": "high"
    }
  }
}
```

Check your provider's documentation for available parameters.

## Example: Customizing Built-in Agents

You can override any built-in agent's settings:

```json
{
  "$schema": "https://kilo.ai/config.json",
  "agent": {
    "build": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "{file:./prompts/build.txt}",
      "tools": {
        "write": true,
        "edit": true,
        "bash": true
      }
    },
    "plan": {
      "model": "anthropic/claude-haiku-4-20250514",
      "tools": {
        "write": false,
        "edit": false,
        "bash": false
      }
    }
  }
}
```

## Usage

- **Switch primary agents** during a session with the **Tab** key.
- **Invoke subagents** by `@` mentioning them in your message (e.g., `@code-reviewer check this function`).
- **List agents** with `kilo agent` or the `/agents` slash command.
