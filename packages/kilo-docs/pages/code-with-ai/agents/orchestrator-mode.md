---
title: "Orchestrator Mode"
description: "Orchestrator mode is no longer needed — agents with full tool access now support subagents natively"
---

# Orchestrator Mode (Deprecated)

{% callout type="warning" title="Deprecated — scheduled for removal" %}
Orchestrator mode is deprecated and will be removed in a future release. In the VSCode extension and CLI, **agents with full tool access (Code, Plan, Debug) can now delegate to subagents automatically**. You no longer need a dedicated orchestrator — just pick the agent for your task and it will coordinate subagents when helpful. (Read-only agents like Ask do not support delegation.)
{% /callout %}

## What Changed

Previously, orchestrator mode was the only way to break complex tasks into subtasks. You had to explicitly switch to orchestrator mode, which would then delegate work to other modes like Code or Architect.

Now, **subagent support is built into agents that have full tool access** (Code, Plan, Debug). When one of these agents encounters a task that would benefit from delegation — like exploring a codebase, running a parallel search, or handling a subtask in isolation — it can launch a subagent directly using the `task` tool. There's no need to switch agents first.

## What You Should Do

- **Just pick the right agent for your task.** Use Code for implementation, Plan for architecture, Debug for troubleshooting. Each will orchestrate subagents where it makes sense.
- **Add custom subagents** if you want specialized delegation behavior. See [Custom Subagents](/docs/customize/custom-subagents) for details.
- **Stop switching to orchestrator mode** before complex tasks. Your current agent already has that capability.

## How Subagents Work

1. The agent analyzes a complex task and decides a subtask would benefit from isolation.
2. It launches a subagent session using the `task` tool (e.g., `general` for autonomous work, `explore` for codebase research).
3. The subagent runs in its own isolated context — separate conversation history, no shared state.
4. When done, the subagent returns a summary to the parent agent, which continues its work.

Agents can launch multiple subagent sessions concurrently for parallel work.
