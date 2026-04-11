---
title: "Team Workflow"
description: "Coordinate multi-model AI teams through a structured plan-build-review lifecycle"
---

# Team Workflow

The team workflow system lets you coordinate multiple AI models working together on complex tasks. Instead of a single model handling everything, you assign different models to different roles -- a senior model for architecture decisions, a faster model for routine implementation, a specialized model for code review -- and the workflow engine manages the lifecycle from planning through shipping.

{% callout type="info" %}
Team workflow is available in the CLI. VS Code extension support for displaying workflow state is planned for a future release.
{% /callout %}

## Why Use Team Workflow?

Single-model sessions work well for focused tasks: fix a bug, write a function, answer a question. But for larger efforts -- building a feature across multiple files, implementing an API with tests, or refactoring a module -- you benefit from:

- **Cost optimization**: Use expensive frontier models for planning and review, cheaper models for routine implementation
- **Parallel execution**: Multiple tasks in the same wave can run concurrently without file conflicts
- **Structured review**: Every implementation goes through a review stage before shipping
- **Institutional learning**: The system captures what went wrong and avoids repeating the same mistakes

## How It Works

The workflow follows a seven-stage lifecycle:

```
plan -> challenge -> contract -> build -> review -> ship -> retro
  ^                                                          |
  +----------------------------------------------------------+
```

### Stage 1: Plan

The planning stage breaks your task into discrete plan tasks. Each task specifies:

- **Role**: Which team member handles it (e.g., `senior`, `worker`)
- **Wave**: Execution order -- wave 1 runs first, wave 2 runs after wave 1 completes
- **Files**: Which files the task will modify (used for conflict detection)
- **Dependencies**: Which tasks must complete before this one starts
- **Verification**: Commands to run after completion to confirm the task worked

### Stage 2: Challenge

A challenge agent (typically a strong reasoning model) reviews the plan for issues:

- Missing dependencies between tasks
- Tasks in the wrong wave order
- Underestimated complexity
- File conflicts within the same wave
- Security risks or incorrect assumptions

The challenger produces a verdict: **approved**, **revise**, or **reject**. If the verdict is "revise," the plan returns to the planning stage with specific concerns to address.

### Stage 3: Contract

Before building, the system generates interface contracts between tasks. If task A produces an API endpoint and task B consumes it, the contract specifies:

- Exact HTTP method and path
- Request and response field names, types, and whether they are required
- Example responses

This prevents integration failures when tasks are built in parallel by different models.

### Stage 4: Build

Tasks execute in wave order. Within each wave, tasks run concurrently (up to the role's `maxConcurrent` limit). The system:

- Acquires file locks so no two tasks modify the same file simultaneously
- Injects relevant contracts into each agent's prompt
- Tracks task status (pending, in progress, completed, failed, escalated)
- Monitors for stuck tasks and deadlocks

### Stage 5: Review

A review agent examines the implementation and produces findings classified by severity:

- **Blocker**: Must fix before shipping (security flaws, correctness bugs, broken contracts)
- **Warning**: Should fix but can ship with a follow-up issue
- **Suggestion**: Style or minor improvements at the author's discretion

If blockers exist and the review cycle count is under the maximum (3), the workflow returns to the build stage with the fix instructions. Otherwise, it escalates. Review only runs once every build task is completed; it no longer owns the quality-gate step.

### Stage 6: Ship

The ship stage is the final readiness gate. It runs project quality gates automatically:

- TypeCheck (if `tsconfig.json` or a `typecheck` script exists)
- Test suite (if a `test` script exists)
- Lint (if a `lint` script exists)

If all gates pass, the workflow persists a ship report and marks the phase complete in `.planning/ROADMAP.md`. If gates fail, the ship report is still written, but the workflow stays in review until the build is fixed and rerun.

### Stage 7: Retro

The retrospective captures lessons learned:

- What patterns caused failures?
- What commands did not work?
- What fixes were applied?

The phase closeout is stored in `*-RETRO.md`, while individual lessons are stored in `.planning/lessons/` and injected into future agent prompts to avoid repeating mistakes.

## Setting Up Team Configuration

Team workflow requires a team configuration in your project's `.kilo/config.json`:

```json
{
  "team": {
    "enabled": true,
    "roles": {
      "senior": {
        "displayName": "Senior Engineer",
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514",
        "effort": "high",
        "tier": 1,
        "canDelegate": ["worker", "reviewer"],
        "maxConcurrent": 2,
        "capabilities": ["architecture", "security", "review"]
      },
      "worker": {
        "displayName": "Implementation Worker",
        "provider": "openai",
        "model": "gpt-4o-mini",
        "effort": "medium",
        "tier": 2,
        "canDelegate": [],
        "maxConcurrent": 5,
        "capabilities": ["implementation", "tests"]
      },
      "reviewer": {
        "displayName": "Code Reviewer",
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514",
        "effort": "high",
        "tier": 2,
        "canDelegate": [],
        "maxConcurrent": 1,
        "capabilities": ["review", "security"]
      }
    },
    "routing": {
      "strategy": "hierarchical",
      "defaultRole": "worker",
      "escalationEnabled": true
    }
  }
}
```

### Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Enable or disable team mode |
| `roles` | object | Map of role names to role definitions |
| `routing.strategy` | `"hierarchical"` or `"flat"` | Whether to enforce delegation rules |
| `routing.defaultRole` | string | Role used when no specific role is specified |
| `routing.escalationEnabled` | boolean | Allow tasks to escalate to higher-tier roles |

### Role Fields

| Field | Type | Description |
|-------|------|-------------|
| `displayName` | string | Human-readable name shown in the TUI |
| `provider` | string | AI provider ID (e.g., `anthropic`, `openai`, `openrouter`) |
| `model` | string | Model ID for this role |
| `effort` | string | Reasoning effort level: `max`, `xhigh`, `high`, `medium`, `low`, `default` |
| `tier` | number | Hierarchy tier (1 = highest authority) |
| `canDelegate` | string[] | Which roles this role can assign tasks to |
| `maxConcurrent` | number | Maximum simultaneous tasks for this role |
| `capabilities` | string[] | Tags describing what this role is good at |

### Routing Strategies

**Hierarchical** (recommended): Higher-tier roles can delegate to lower-tier roles listed in their `canDelegate` array. A tier-2 worker cannot delegate to a tier-1 senior. This prevents infinite delegation loops.

**Flat**: Any role can delegate to any other role. Simpler but less controlled. Use this for small teams where all models are roughly equivalent.

## The `.planning/` Directory

The workflow engine stores all state in a `.planning/` directory at your project root:

```
.planning/
  STATE.md           -- Current workflow state (YAML frontmatter)
  PROJECT.md         -- Project vision, constraints, success criteria
  ROADMAP.md         -- Phase overview
  locks.json         -- Active file locks
  events.jsonl       -- Append-only audit log
  phases/
    01-auth/
      CONTEXT.md     -- Phase requirements and relevant code
      01-01-PLAN.md  -- Task plan (YAML frontmatter + description)
      01-02-PLAN.md
      01-CHALLENGE.md -- Challenge verdict and concerns
      01-01-SUMMARY.md -- Completion summary
      01-REVIEW.md   -- Review verdict with findings
      01-SHIP.md     -- Final quality-gate report and ship readiness
      01-RETRO.md    -- Retrospective summary and follow-ups
  milestones/
    ...
  lessons/
    L-xxxx.json      -- Captured lessons (trigger, resolution, confidence)
```

{% callout type="warning" %}
Add `.planning/` to your `.gitignore` unless you want to version-control your workflow state. The directory can contain large amounts of intermediate data.
{% /callout %}

## Pre-flight Checks

Before starting a planning run, the workflow runs pre-flight checks:

- **Git installed**: Verifies `git` is available
- **Git repository**: Confirms the working directory is inside a git repo
- **Base branch**: Checks that the base branch (default: `main`) exists
- **Disk space**: Warns if free space is below 5 GB, errors if below 1 GB
- **Working tree**: Warns if there are uncommitted changes

If any error-severity check fails, the workflow will not proceed to the build stage.

## Quality Gates

During the ship stage, the workflow automatically detects and runs quality gates:

| Gate | Detected When | Command |
|------|---------------|---------|
| TypeCheck | `tsconfig.json` exists or `typecheck` script in `package.json` | `npm run typecheck` or `npx tsc --noEmit` |
| Test Suite | `test` script in `package.json` | `npm test -- --run` |
| Lint | `lint` script in `package.json` | `npm run lint` |
| Cargo Test | `Cargo.toml` exists | `cargo test` |
| Cargo Clippy | `Cargo.toml` exists | `cargo clippy -- -W clippy::all` |
| Pytest | `pyproject.toml` or `setup.py` exists | `python -m pytest` |

## Health Monitoring

During the build stage, the workflow monitors for:

- **Stuck tasks**: Tasks with no activity for 15+ minutes trigger an alert
- **Deadlocks**: Circular dependencies between blocked tasks are detected using depth-first search
- **Cascade failures**: When all remaining tasks are blocked, it indicates an upstream dependency failed

## Effort Levels

The `effort` field on a role controls how the model's reasoning features are configured:

| Level | Reasoning | Verbosity | Use Case |
|-------|-----------|-----------|----------|
| `max` | Enabled, high | High | Complex architecture decisions |
| `xhigh` | Enabled, high | High | Senior-level implementation |
| `high` | Enabled, high | Medium | Standard senior work |
| `medium` | Enabled, medium | Medium | Routine implementation |
| `low` | Disabled, low | Low | Simple tasks, quick fixes |
| `default` | Provider default | Provider default | No override |
