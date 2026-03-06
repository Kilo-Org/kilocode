---
title: "Custom Agents"
description: "Define custom agents in the Kilo CLI with tailored models, prompts, and tool access"
---

# {% $markdoc.frontmatter.title %}

Custom agents let you create specialized AI assistants with their own system prompts, models, and tool permissions. Define agents for specific workflows like code review, documentation, or security auditing.

## Agent Types

| Type       | Description                                                                      |
| ---------- | -------------------------------------------------------------------------------- |
| `primary`  | Main agents you interact with directly. Switch between them with **Tab**.        |
| `subagent` | Specialized agents invoked by primary agents or via `@mention` in your messages. |

The CLI includes two built-in primary agents (**Build** and **Plan**) and two built-in subagents (**General** and **Explore**). You can customize these or create your own.

## Defining Agents in Config

Add an `agent` object to your `opencode.json` config file. Each key becomes the agent's identifier.

| Scope       | Path                                             |
| ----------- | ------------------------------------------------ |
| **Global**  | `~/.config/kilo/opencode.json`                   |
| **Project** | `./opencode.json` or `./.opencode/opencode.json` |

### Example

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
        "edit": false,
        "bash": false
      }
    }
  }
}
```

This creates a read-only `code-reviewer` subagent that you can invoke with `@code-reviewer` in chat.

## Configuration Options

| Option        | Type                        | Required | Description                                                                                                                                |
| ------------- | --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `description` | string                      | Yes      | Brief description of what the agent does.                                                                                                  |
| `mode`        | `"primary"` \| `"subagent"` | No       | How the agent can be used. Defaults to both.                                                                                               |
| `model`       | string                      | No       | Model to use (format: `provider/model-id`). Primary agents default to the global model; subagents inherit from the invoking primary agent. |
| `prompt`      | string                      | No       | Custom system prompt. Use `{file:./path/to/prompt.txt}` to load from a file.                                                               |
| `tools`       | object                      | No       | Enable/disable specific tools (`true`/`false`). Supports wildcards like `"mymcp_*": false`.                                                |
| `permission`  | object                      | No       | Per-agent permission overrides for `edit`, `bash`, and `webfetch` (`"allow"`, `"ask"`, `"deny"`).                                          |
| `temperature` | number                      | No       | Controls response randomness (0.0–1.0). Lower = more deterministic.                                                                        |
| `steps`       | number                      | No       | Max agentic iterations before the agent must respond with text only.                                                                       |
| `hidden`      | boolean                     | No       | Hide from `@` autocomplete. Only applies to subagents.                                                                                     |
| `disable`     | boolean                     | No       | Disable the agent entirely.                                                                                                                |
| `color`       | string                      | No       | UI color. Hex value (e.g. `"#FF5733"`) or theme name (`"primary"`, `"accent"`, etc.).                                                      |
| `top_p`       | number                      | No       | Alternative to temperature for controlling response diversity (0.0–1.0).                                                                   |

Any unrecognized options are passed through to the provider as model-specific parameters (e.g., `"reasoningEffort": "high"` for OpenAI models).

## Defining Agents with Markdown

You can also define agents as markdown files. The filename becomes the agent name.

| Scope       | Path                     |
| ----------- | ------------------------ |
| **Global**  | `~/.config/kilo/agents/` |
| **Project** | `./.opencode/agents/`    |

### Example

Create a file at `.opencode/agents/docs-writer.md`:

```markdown
---
description: Writes and maintains project documentation
mode: subagent
tools:
  bash: false
---

You are a technical writer. Create clear, comprehensive documentation.

Focus on:

- Clear explanations
- Proper structure
- Code examples
- User-friendly language
```

## Customizing Built-in Agents

Override built-in agent settings by using their identifier (`build`, `plan`, `general`, `explore`) as the key:

```json
{
  "$schema": "https://kilo.ai/config.json",
  "agent": {
    "build": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "{file:./prompts/build.txt}"
    },
    "plan": {
      "model": "anthropic/claude-haiku-4-20250514"
    }
  }
}
```

## Tool and Permission Control

Agent-level `tools` and `permission` settings override the global config.

```json
{
  "$schema": "https://kilo.ai/config.json",
  "permission": {
    "edit": "allow"
  },
  "agent": {
    "readonly-reviewer": {
      "description": "Reviews code without making changes",
      "mode": "subagent",
      "tools": {
        "write": false,
        "edit": false
      },
      "permission": {
        "bash": {
          "*": "deny",
          "git diff": "allow",
          "git log*": "allow",
          "grep *": "allow"
        }
      }
    }
  }
}
```

## Managing Agents

| Command             | Description                              |
| ------------------- | ---------------------------------------- |
| `kilo agent create` | Interactive wizard to create a new agent |
| `kilo agent list`   | List all configured agents               |
| `/agents`           | Switch agents in interactive mode        |
| **Tab**             | Cycle through primary agents             |
| `@agent-name`       | Invoke a subagent in chat                |

{% callout type="tip" %}
Run `kilo models` to see available model IDs for the `model` field.
{% /callout %}
