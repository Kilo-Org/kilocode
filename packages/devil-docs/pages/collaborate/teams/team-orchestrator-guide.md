---
title: "Team Orchestrator Guide"
description: "Complete guide to using the Team Orchestrator for multi-agent workflow execution"
---

# Team Orchestrator Guide

## Overview

The Team Orchestrator lets you run structured multi-agent workflows where different AI models handle different roles — planner, builder, reviewer, and so on. Each run follows a seven-stage pipeline:

| Stage | What happens |
| --- | --- |
| `plan` | Generate a phased task breakdown from your requirements |
| `challenge` | Stress-test the plan for gaps and risks |
| `contract` | Generate task contracts with acceptance criteria |
| `build` | Execute tasks in parallel across team positions |
| `review` | Validate output against the original requirements |
| `ship` | Run final checks and prepare the release |
| `retro` | Capture lessons and update the team knowledge base |

You move through stages by typing commands in the workflow prompt (TUI) or clicking buttons in the VS Code Agent Manager panel.

## Creating a Team

### From the TUI

Load a quickstart template to get started immediately:

```
team init solo-enhanced
```

Available quickstart IDs: `solo-enhanced`, `code-review-pair`, `full-stack-team`, `ci-cd-pipeline`, `research-team`.

To export your active team config to a file:

```
team export ./my-team.json
```

To import a team config from a file:

```
team import ./my-team.json
```

### From VS Code

Open the Agent Manager panel (click the devil Code icon in the Activity Bar), then choose **Teams** and click **New Team**. The team builder walks you through naming positions and assigning providers and models.

## Starting a Workflow

1. Open a project in your terminal or VS Code.
2. Enter the workflow TUI (`/workflow` or `bun run dev .` from the repo root).
3. Paste your phase requirements into the prompt and press Enter.
4. The orchestrator runs `plan` automatically and waits for your approval.

Approve the plan to move to `challenge`:

```
approve
```

Step through the pipeline:

```
next
```

Or jump directly to any stage:

```
build
review
ship
```

## Live Team Editing

**Phase 10 feature** — you can swap a position's provider and model while a workflow is in progress, without restarting.

### TUI syntax

```
team swap <position> <provider> <model>
```

**Examples:**

```
team swap builder anthropic claude-opus-4-5
team swap reviewer openai gpt-4o
team swap planner openrouter meta-llama/llama-3.1-70b-instruct
```

### What happens when you swap

1. The current team config is validated — if the position does not exist, you get an error with code `POSITION_NOT_FOUND`.
2. The new provider/model is written into the team config and persisted via `Config.update()`.
3. Concurrency slots for the affected position are rebalanced.
4. Bus events are emitted (`position-swap:validating`, `position-swap:success` or `position-swap:failed`, optionally `position-swap:rebalance`).
5. Tasks already dispatched to the old model complete with the old model. New tasks dispatched to that position use the new model.

### When to swap

- A model is returning consistently poor output for the current phase.
- You want to try a faster/cheaper model for the remaining build wave.
- A provider is experiencing degraded performance and you need to failover.

### Limitations

- You cannot add or remove positions mid-workflow — only change the provider and model for an existing position.
- Swapping the `planner` position after `plan` has already completed has no effect on the existing plan artifact.
- If a position has a `delegationHierarchy` constraint and the swap would violate it, the swap is rejected with code `DELEGATION_VIOLATION`.

### From VS Code

The Agent Manager webview sends a `teamBuilder.swapPosition` message to the extension, which calls `POST /devilcode/workflow/team/swap` on the CLI backend and posts back a `teamBuilder.swapped` result.

## Monitoring Workflows

### Stage indicator

The TUI shows the current stage at the top of the workflow panel. Run `status` at any time to refresh:

```
status
```

### Pausing

To pause after the current build wave completes:

```
pause
```

Run `build` again to resume.

### Telemetry dashboard

Open the VS Code Agent Manager panel and navigate to the **Analytics** tab to see:

- Success rate by team position
- Stall rate by position (average and p95 wait times)
- Cost by workflow run
- Duration by stage

The aggregations are computed from the append-only event log at `.planning/events/`.

## Troubleshooting

### `No active team config`

You haven't loaded a team. Run `team import <path>` or `team init <quickstart>` first.

### `POSITION_NOT_FOUND`

The position name you passed to `team swap` does not match any key in `teamConfig.roles`. Check the exact position names with `status`.

### `DELEGATION_VIOLATION`

The team uses hierarchical routing and the parent role's `canDelegate` list does not include the target position. Either adjust the team config or swap to a position that is in the delegation list.

### `WORKFLOW_NOT_ACTIVE`

No team config is present in the active project config. Load a team before attempting a swap.

### Build wave stalls

If the build stage hangs, check the event log:

```
# In TUI
status
```

Or from the VS Code Agent Manager → Analytics → Events tab. Look for tasks with no `task.completed` event after a long `task.started`.
