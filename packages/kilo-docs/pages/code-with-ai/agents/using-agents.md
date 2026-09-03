---
title: "Using Agents"
description: "Understanding and using different agents in Kilo Code"
---

# Using Agents

Agents in Kilo Code are specialized personas that tailor the assistant's behavior to your current task. Each agent offers different capabilities, expertise, and access levels to help you accomplish specific goals.

## Why Use Different Agents?

- **Task specialization:** Get precisely the type of assistance you need for your current task
- **Safety controls:** Prevent unintended file modifications when focusing on planning or learning
- **Focused interactions:** Receive responses optimized for your current activity
- **Workflow optimization:** Seamlessly transition between planning, implementing, debugging, and learning

## Switching Agents

{% tabs %}
{% tab label="VSCode" %}

There are several ways to switch agents:

- **Dropdown menu:** Click the agent selector in the sidebar to switch between agents.
- **Slash commands:** Type `/agents` in the chat input to open the agent picker.
- **Keyboard shortcut:** Press `Cmd+.` (macOS) or `Ctrl+.` (Windows/Linux) to cycle through available agents. Add `Shift` to cycle in reverse.

{% /tab %}
{% tab label="CLI" %}

There are several ways to switch agents:

- **Cycle agents:** Press `Tab` to cycle forward through agents, or `Shift+Tab` to cycle backward.
- **Agent picker:** Press `Ctrl+X a` (leader key + `a`) to open the full agent list.
- **Slash commands:** Type `/agents` in the chat input to open the agent picker.
- **Config file:** Set the `default_agent` key in your configuration to change the default agent on startup.

{% /tab %}
{% /tabs %}

## Built-in Agents

{% tabs %}
{% tab label="VSCode" %}

### code (Default)

| Aspect | Details |
|---|---|
| **Description** | A skilled software engineer with expertise in programming languages, design patterns, and best practices |
| **Tool Access** | Full access to all tools: `read`, `edit`, `glob`, `grep`, `bash`, `task`, `webfetch`, plus tools from MCP servers |
| **Ideal For** | Writing code, implementing features, debugging, and general development |
| **Special Features** | No tool restrictions — full flexibility for all coding tasks |

### ask

| Aspect | Details |
|---|---|
| **Description** | A knowledgeable technical assistant focused on answering questions without changing your codebase |
| **Tool Access** | Read-only tools (`read`, `glob`, `grep`, `list`), read-only bash commands (`cat`, `grep`, `git log`, `git diff`, `jq`, etc.), and MCP tools (with user approval). All write operations are blocked. |
| **Ideal For** | Code explanation, concept exploration, technical learning, and project investigation |
| **Special Features** | Can run read-only commands and inspect your project without modifying it. MCP tools require approval for each call. |

### plan

| Aspect | Details |
|---|---|
| **Description** | An experienced technical leader and planner who helps design systems and create implementation plans |
| **Tool Access** | Read-only tools plus restricted file editing (plan files in `.kilo/plans/` only) |
| **Ideal For** | System design, high-level planning, and architecture discussions |
| **Special Features** | Similar to the legacy extension's "Architect" mode, with a planning-focused approach |

### debug

| Aspect | Details |
|---|---|
| **Description** | An expert problem solver specializing in systematic troubleshooting and diagnostics |
| **Tool Access** | Full access to all tools |
| **Ideal For** | Tracking down bugs, diagnosing errors, and resolving complex issues |
| **Special Features** | Uses a methodical approach of analyzing, narrowing possibilities, and fixing issues |

### orchestrator (Deprecated)

| Aspect | Details |
|---|---|
| **Description** | A strategic workflow orchestrator who coordinates complex tasks by delegating them to appropriate specialized agents |
| **Tool Access** | Limited access to create new tasks and coordinate workflows |
| **Ideal For** | Breaking down complex projects into manageable subtasks assigned to specialized agents |
| **Special Features** | Delegates work to other agents; also has access to the **explore** subagent for codebase exploration |

{% callout type="warning" %}
Orchestrator is deprecated and will be removed in a future release. Agents with full tool access (Code, Plan, Debug) now support subagents natively — there's no need for a dedicated orchestrator. See [Orchestrator Mode (Deprecated)](/docs/code-with-ai/agents/orchestrator-mode) for migration details.
{% /callout %}

{% callout type="info" %}
The VSCode extension and CLI do not include a built-in Review agent. Code review workflows can be handled by the **code** agent or via custom agent configurations.
{% /callout %}

{% /tab %}
{% tab label="CLI" %}

### code (Default)

| Aspect | Details |
|---|---|
| **Description** | A skilled software engineer with expertise in programming languages, design patterns, and best practices |
| **Tool Access** | Full access to all tools: `read`, `edit`, `glob`, `grep`, `bash`, `task`, `webfetch`, plus tools from MCP servers |
| **Ideal For** | Writing code, implementing features, debugging, and general development |
| **Special Features** | No tool restrictions — full flexibility for all coding tasks |

### ask

| Aspect | Details |
|---|---|
| **Description** | A knowledgeable technical assistant focused on answering questions without changing your codebase |
| **Tool Access** | Read-only tools (`read`, `glob`, `grep`, `list`), read-only bash commands (`cat`, `grep`, `git log`, `git diff`, `jq`, etc.), and MCP tools (with user approval). All write operations are blocked. |
| **Ideal For** | Code explanation, concept exploration, technical learning, and project investigation |
| **Special Features** | Can run read-only commands and inspect your project without modifying it. MCP tools require approval for each call. |

### plan

| Aspect | Details |
|---|---|
| **Description** | An experienced technical leader and planner who helps design systems and create implementation plans |
| **Tool Access** | Read-only tools plus restricted file editing (plan files in `.kilo/plans/` only) |
| **Ideal For** | System design, high-level planning, and architecture discussions |
| **Special Features** | Similar to the legacy extension's "Architect" mode, with a planning-focused approach |

### debug

| Aspect | Details |
|---|---|
| **Description** | An expert problem solver specializing in systematic troubleshooting and diagnostics |
| **Tool Access** | Full access to all tools |
| **Ideal For** | Tracking down bugs, diagnosing errors, and resolving complex issues |
| **Special Features** | Uses a methodical approach of analyzing, narrowing possibilities, and fixing issues |

### orchestrator (Deprecated)

| Aspect | Details |
|---|---|
| **Description** | A strategic workflow orchestrator who coordinates complex tasks by delegating them to appropriate specialized agents |
| **Tool Access** | Limited access to create new tasks and coordinate workflows |
| **Ideal For** | Breaking down complex projects into manageable subtasks assigned to specialized agents |
| **Special Features** | Delegates work to other agents; also has access to the **explore** subagent for codebase exploration |

{% callout type="warning" %}
Orchestrator is deprecated and will be removed in a future release. Agents with full tool access (Code, Plan, Debug) now support subagents natively — there's no need for a dedicated orchestrator. See [Orchestrator Mode (Deprecated)](/docs/code-with-ai/agents/orchestrator-mode) for migration details.
{% /callout %}

{% callout type="info" %}
The VSCode extension and CLI do not include a built-in Review agent. Code review workflows can be handled by the **code** agent or via custom agent configurations.
{% /callout %}

{% /tab %}
{% /tabs %}

## Custom Agents

Create your own specialized assistants by defining tool access, file permissions, and behavior instructions. Custom agents help enforce team standards or create purpose-specific assistants. See [Custom Modes documentation](/docs/customize/custom-modes) for setup instructions.
