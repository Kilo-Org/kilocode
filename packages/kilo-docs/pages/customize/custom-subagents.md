---
title: "Custom Subagents"
description: "Create and configure custom subagents in Kilo Code's CLI"
---

# Custom Subagents

Kilo Code's CLI supports **custom subagents** — specialized AI assistants that can be invoked by primary agents or manually via `@` mentions. Subagents run in their own isolated sessions with tailored prompts, models, tool access, and permissions, enabling you to build purpose-built workflows for tasks like code review, documentation, security audits, and more.

{% callout type="info" %}
Custom subagents are currently configured through the config file (`kilo.json`) or via markdown agent files. UI-based configuration is not yet available.
{% /callout %}

## What Are Subagents?

Subagents are agents that operate as delegates of primary agents. While **primary agents** (like Code, Plan, or Debug) are the main assistants you interact with directly, **subagents** are invoked to handle specific subtasks in isolated contexts.

Key characteristics of subagents:

- **Isolated context**: Each subagent runs in its own session with separate conversation history
- **Specialized behavior**: Custom prompts and tool access tailored to a specific task
- **Invocable by agents or users**: Primary agents invoke subagents via the Task tool, or you can invoke them manually with `@agent-name`
- **Results flow back**: When a subagent completes, its result summary is returned to the parent agent

### Built-in Subagents

Kilo Code includes two built-in subagents:

| Name        | Description                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **general** | General-purpose agent for researching complex questions and executing multi-step tasks. Has full tool access (except todo).                                        |
| **explore** | Fast, read-only agent for codebase exploration. Cannot modify files. Use for finding files by patterns, searching code, or answering questions about the codebase. |

## Agent Modes

Every agent has a **mode** that determines how it can be used:

| Mode       | Description                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------- |
| `primary`  | User-facing agents you interact with directly. Switch between them with **Tab**.            |
| `subagent` | Only invocable via the Task tool or `@` mentions. Not available as a primary agent.         |
| `all`      | Can function as both a primary agent and a subagent. This is the default for custom agents. |

## Configuring Custom Subagents

There are two ways to define custom subagents: through JSON configuration or markdown files.

### Method 1: JSON Configuration

Add agents to the `agent` section of your `kilo.json` config file. Any key that doesn't match a built-in agent name creates a new custom agent.

```json
{
  "$schema": "https://app.kilo.ai/config.json",
  "agent": {
    "code-reviewer": {
      "description": "Reviews code for best practices and potential issues",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "You are a code reviewer. Focus on security, performance, and maintainability.",
      "permission": {
        "edit": "deny",
        "bash": "deny"
      }
    }
  }
}
```

You can also reference an external prompt file instead of inlining the prompt:

```json
{
  "agent": {
    "code-reviewer": {
      "description": "Reviews code for best practices and potential issues",
      "mode": "subagent",
      "prompt": "{file:./prompts/code-review.txt}"
    }
  }
}
```

The file path is relative to the config file location, so this works for both global and project-specific configs.

### Method 2: Markdown Files

Define agents as markdown files with YAML frontmatter. Place them in:

- **Global**: `~/.config/kilo/agents/`
- **Project-specific**: `.kilo/agents/`

The **filename** (without `.md`) becomes the agent name.

```markdown
---
description: Reviews code for quality and best practices
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
permission:
  edit: deny
  bash: deny
---

You are a code reviewer. Analyze code for:

- Code quality and best practices
- Potential bugs and edge cases
- Performance implications
- Security considerations

Provide constructive feedback without making direct changes.
```

{% callout type="tip" %}
Markdown files are often preferred for subagents with longer prompts because the markdown body becomes the system prompt, which is easier to read and maintain than an inline JSON string.
{% /callout %}

### Method 3: Interactive CLI

Create agents interactively using the CLI:

```bash
kilo agent create
```

This command will:

1. Ask where to save the agent (global or project-specific)
2. Prompt for a description of what the agent should do
3. Generate an appropriate system prompt and identifier using AI
4. Let you select which tools the agent can access
5. Let you choose the agent mode (`all`, `primary`, or `subagent`)
6. Create a markdown file with the agent configuration

You can also run it non-interactively:

```bash
kilo agent create \
  --path .kilo \
  --description "Reviews code for security vulnerabilities" \
  --mode subagent \
  --tools "read,grep,glob"
```

## Configuration Options

The following options are available when configuring a subagent:

| Option        | Type                               | Description                                                                                                                                          |
| ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description` | `string`                           | What the agent does and when to use it. Shown to primary agents to help them decide which subagent to invoke.                                        |
| `mode`        | `"subagent" \| "primary" \| "all"` | How the agent can be used. Defaults to `all` for custom agents.                                                                                      |
| `model`       | `string`                           | Override the model for this agent (format: `provider/model-id`). If not set, subagents inherit the model of the invoking primary agent.              |
| `prompt`      | `string`                           | Custom system prompt. In JSON, can use `{file:./path}` syntax. In markdown, the body is the prompt.                                                  |
| `temperature` | `number`                           | Controls response randomness (0.0-1.0). Lower = more deterministic.                                                                                  |
| `top_p`       | `number`                           | Alternative to temperature for controlling response diversity (0.0-1.0).                                                                             |
| `permission`  | `object`                           | Controls tool access. See [Permissions](#permissions) below.                                                                                         |
| `hidden`      | `boolean`                          | If `true`, hides the subagent from the `@` autocomplete menu. It can still be invoked by agents via the Task tool. Only applies to `mode: subagent`. |
| `steps`       | `number`                           | Maximum agentic iterations before forcing a text-only response. Useful for cost control.                                                             |
| `color`       | `string`                           | Visual color in the UI. Accepts hex (`#FF5733`) or theme names (`primary`, `accent`, `error`, etc.).                                                 |
| `disable`     | `boolean`                          | Set to `true` to disable the agent entirely.                                                                                                         |

Any additional options not listed above are passed through to the model provider, allowing you to use provider-specific parameters like `reasoningEffort` for OpenAI models.

### Permissions

The `permission` field controls what tools the subagent can use. Each tool permission can be set to:

- `"allow"` — Allow the tool without approval
- `"ask"` — Prompt for user approval before running
- `"deny"` — Disable the tool entirely

```json
{
  "agent": {
    "reviewer": {
      "mode": "subagent",
      "permission": {
        "edit": "deny",
        "bash": {
          "*": "ask",
          "git diff": "allow",
          "git log*": "allow"
        }
      }
    }
  }
}
```

For bash commands, you can use glob patterns to set permissions per command. Rules are evaluated in order, with the **last matching rule winning**.

You can also control which subagents an agent can invoke via `permission.task`:

```json
{
  "agent": {
    "orchestrator": {
      "mode": "primary",
      "permission": {
        "task": {
          "*": "deny",
          "code-reviewer": "allow",
          "docs-writer": "allow"
        }
      }
    }
  }
}
```

## Using Custom Subagents

Once configured, subagents can be used in two ways:

### Automatic Invocation

Primary agents (especially the Orchestrator) can automatically invoke subagents via the Task tool when the subagent's `description` matches the task at hand. Write clear, descriptive `description` values to help primary agents select the right subagent.

### Manual Invocation via @ Mentions

You can manually invoke any subagent by typing `@agent-name` in your message:

```
@code-reviewer review the authentication module for security issues
```

This creates a subtask that runs in the subagent's isolated context with its configured prompt and permissions.

### Listing Agents

To see all available agents (both built-in and custom):

```bash
kilo agent list
```

This displays each agent's name, mode, and permission configuration.

## Configuration Precedence

Agent configurations are merged from multiple sources. Later sources override earlier ones:

1. **Built-in agent defaults** (native agents defined in the codebase)
2. **Global config** (`~/.config/kilo/config.json`)
3. **Global agent markdown files** (`~/.config/kilo/agents/*.md`)
4. **Project config** (`kilo.json` in the project root)
5. **Project agent markdown files** (`.kilo/agents/*.md`)

When overriding a built-in agent, properties are merged — only the fields you specify are overridden. When creating a new custom agent, unspecified fields use sensible defaults (`mode: "all"`, full permissions inherited from global config).

## Examples

### Documentation Writer

A subagent that writes and maintains documentation without executing commands:

```markdown
---
description: Writes and maintains project documentation
mode: subagent
permission:
  bash: deny
---

You are a technical writer. Create clear, comprehensive documentation.

Focus on:

- Clear explanations with proper structure
- Code examples where helpful
- User-friendly language
- Consistent formatting
```

### Security Auditor

A read-only subagent for security review:

```markdown
---
description: Performs security audits and identifies vulnerabilities
mode: subagent
permission:
  edit: deny
  bash:
    "*": deny
    "git log*": allow
    "grep *": allow
---

You are a security expert. Focus on identifying potential security issues.

Look for:

- Input validation vulnerabilities
- Authentication and authorization flaws
- Data exposure risks
- Dependency vulnerabilities
- Configuration security issues

Report findings with severity levels and remediation suggestions.
```

### Test Generator

A subagent that creates tests for existing code:

```json
{
  "agent": {
    "test-gen": {
      "description": "Generates comprehensive test suites for existing code",
      "mode": "subagent",
      "prompt": "You are a test engineer. Write comprehensive tests following the project's existing test patterns. Use the project's test framework. Cover edge cases and error paths.",
      "temperature": 0.2,
      "steps": 15
    }
  }
}
```

### Restricted Orchestrator

A primary agent that can only delegate to specific subagents:

```json
{
  "agent": {
    "orchestrator": {
      "permission": {
        "task": {
          "*": "deny",
          "code-reviewer": "allow",
          "test-gen": "allow",
          "docs-writer": "allow"
        }
      }
    }
  }
}
```

## Overriding Built-in Agents

You can customize built-in agents by using their name in your config. For example, to change the model used by the `explore` subagent:

```json
{
  "agent": {
    "explore": {
      "model": "anthropic/claude-haiku-4-20250514"
    }
  }
}
```

To disable a built-in agent entirely:

```json
{
  "agent": {
    "general": {
      "disable": true
    }
  }
}
```

## Related

- [Custom Modes](/docs/customize/custom-modes) — Create specialized primary agents with tool restrictions
- [Custom Rules](/docs/customize/custom-rules) — Define rules that apply to specific file types or situations
- [Orchestrator Mode](/docs/code-with-ai/agents/orchestrator-mode) — Legacy mode for task delegation (now built into all agents)
- [Task Tool](/docs/automate/tools/new-task) — The tool used to invoke subagents
