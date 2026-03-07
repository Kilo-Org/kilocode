---
title: "Custom Agents"
description: "How to configure custom agents in the Kilo CLI"
---

# Custom Agents

Define specialized AI agents with custom prompts, models, and tool access in the Kilo CLI. Custom agents let you create focused workflows for tasks like code review, documentation, debugging, or security auditing.

## Configuration Location

Agents are configured under the `agent` key in your config file:

| Scope       | Recommended Path                     | Also supported              |
| ----------- | ------------------------------------ | --------------------------- |
| **Global**  | `~/.config/kilo/kilo.json`           | `kilo.jsonc`, `config.json` |
| **Project** | `./kilo.json` or `./.kilo/kilo.json` | `kilo.jsonc`                |

Project-level configuration takes precedence over global settings.

## Agent Types

There are two types of agents:

- **Primary agents** — Main agents you interact with directly. Switch between them with the **Tab** key or the `/agents` command. The built-in primary agents are **Build** (full tool access) and **Plan** (read-only, for analysis).
- **Subagents** — Specialized agents that primary agents can invoke for specific tasks. You can also invoke them by **@ mentioning** them in your messages (e.g., `@code-reviewer review this function`).

## Defining a Custom Agent

Add agents to the `agent` object in your config file. Each key becomes the agent's name.

```json
{
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

## Configuration Options

| Option        | Type    | Required | Description                                                                                                                                                     |
| ------------- | ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description` | String  | Yes      | Brief description of what the agent does. Shown in the UI and used by other agents to decide when to invoke it.                                                 |
| `mode`        | String  | No       | `"primary"`, `"subagent"`, or `"all"`. Defaults to `"all"`.                                                                                                     |
| `model`       | String  | No       | Model to use (e.g., `"anthropic/claude-sonnet-4-20250514"`). Primary agents default to the globally configured model. Subagents use the invoking agent's model. |
| `prompt`      | String  | No       | Custom system prompt. Can be inline text or a file reference: `"{file:./prompts/review.txt}"`.                                                                  |
| `temperature` | Number  | No       | Controls response randomness (0.0–1.0). Lower = more deterministic.                                                                                             |
| `top_p`       | Number  | No       | Alternative to temperature for controlling response diversity (0.0–1.0).                                                                                        |
| `steps`       | Number  | No       | Maximum agentic iterations before the agent must respond with text only.                                                                                        |
| `tools`       | Object  | No       | Enable or disable specific tools. See [Tool access](#tool-access).                                                                                              |
| `permission`  | Object  | No       | Per-agent permission overrides. See [Permissions](/docs/code-with-ai/platforms/cli#permissions).                                                                |
| `hidden`      | Boolean | No       | Hide a subagent from the `@` autocomplete menu. It can still be invoked by other agents.                                                                        |
| `disable`     | Boolean | No       | Disable the agent entirely.                                                                                                                                     |
| `color`       | String  | No       | Hex color (e.g., `"#FF5733"`) or theme color (`"primary"`, `"accent"`, etc.) for the UI.                                                                        |

## Tool Access

Control which tools an agent can use. Set individual tools to `true` or `false`:

```json
{
  "agent": {
    "readonly-analyzer": {
      "description": "Analyzes code without making changes",
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

Use wildcards to control multiple tools at once, for example to disable all tools from an MCP server:

```json
{
  "agent": {
    "restricted": {
      "description": "Agent with limited MCP access",
      "tools": {
        "mymcp_*": false,
        "write": false
      }
    }
  }
}
```

Agent-level tool config overrides the global `tools` config.

## Customizing Built-in Agents

Override settings on the built-in agents by referencing them by name:

```json
{
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

## Markdown Agent Files

You can also define agents as markdown files instead of JSON. Place them in:

- **Global:** `~/.config/kilo/agents/`
- **Project:** `.kilo/agents/`

The filename becomes the agent name. For example, `review.md` creates a `review` agent:

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

## Using Agents

- **Switch primary agents** with the **Tab** key or `/agents` command.
- **Invoke subagents** by @ mentioning them: `@code-reviewer check this function`.
- **Create agents interactively** with `kilo agent create`, which walks you through setup and generates a markdown agent file.
- **List agents** with `kilo agent list`.

## Examples

### Documentation Writer

```json
{
  "agent": {
    "docs-writer": {
      "description": "Writes and maintains project documentation",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "You are a technical writer. Create clear, comprehensive documentation with proper structure and code examples.",
      "tools": {
        "bash": false
      }
    }
  }
}
```

### Security Auditor

```json
{
  "agent": {
    "security-auditor": {
      "description": "Performs security audits and identifies vulnerabilities",
      "mode": "subagent",
      "prompt": "You are a security expert. Identify input validation vulnerabilities, auth flaws, data exposure risks, and dependency issues.",
      "tools": {
        "write": false,
        "edit": false
      }
    }
  }
}
```

### Quick Thinker (Limited Steps)

```json
{
  "agent": {
    "quick-thinker": {
      "description": "Fast reasoning with limited iterations",
      "mode": "subagent",
      "prompt": "Solve problems with minimal steps. Be concise.",
      "steps": 5
    }
  }
}
```
