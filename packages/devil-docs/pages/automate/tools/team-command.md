---
title: "/team Command"
description: "Reference for the /team slash command and workflow stage controls"
---

# /team Command

The `/team` command opens the team workflow dashboard in the CLI's TUI (terminal user interface). It provides a mission-control view of your multi-model workflow, showing the current stage, active tasks, wave progress, and stage-specific actions.

## Quick Start

```bash
# Initialize a new workflow
/team init

# Open the workflow dashboard
/team
```

The `/team init` command creates the `.planning/` directory structure and opens the dashboard. If a workflow already exists, it opens the existing dashboard.

## Dashboard Layout

The workflow dashboard has three panels:

```
+----------------------------------------------------------+
| Status Bar: [STAGE] Phase: 01-auth  Wave: 1/3  Tasks: 2 |
+------------------------------+---------------------------+
| Task Panel                   | Detail Panel              |
|                              |                           |
| Wave 1                       | Task: 01-01               |
| v 01-01 [senior] Auth midw   | Role: senior              |
| * 01-02 [worker] Login endp  | Status: in_progress       |
|                              | Files:                    |
| Wave 2                       |   src/auth/middleware.ts   |
| o 01-03 [worker] Route guar  |   src/auth/jwt.ts         |
|                              | Depends on: (none)        |
+------------------------------+---------------------------+
| Command Input: > _                                       |
+----------------------------------------------------------+
```

### Status Bar

Shows the current workflow stage (color-coded), active phase, wave progress, and task count.

Stage colors:

| Stage | Color |
|-------|-------|
| Plan | Cyan |
| Challenge | Yellow |
| Contract | Dark Cyan |
| Build | Green |
| Review | Orange |
| Ship | Blue |
| Retro | Magenta |

### Task Panel

Lists all tasks grouped by wave. Each task shows:

- Status icon: `v` completed, `*` in progress, `o` pending, `x` failed, `^` escalated, `.` blocked
- Task ID
- Role in brackets
- Task title (truncated)

### Detail Panel

Shows full details for the selected task: description, files, dependencies, verification commands, and completion output.

### Command Input

Enter workflow commands to control the stage progression.

## Workflow Commands

These commands are entered in the command input at the bottom of the dashboard.

### Stage Commands

| Command | Description | Valid From Stage |
|---------|-------------|-----------------|
| `plan` | Enter or re-enter the planning stage | `retro`, or to revise from `challenge` |
| `challenge` | Submit plan for challenge review | `plan` |
| `build` | Start building (after contract generation) | `contract` |
| `review` | Submit build for code review | `build` |
| `ship` | Run quality gates and prepare to ship | `review` (after passing review) |
| `retro` | Start retrospective | `ship` |

### Control Commands

| Command | Description |
|---------|-------------|
| `next` | Advance to the next valid stage automatically |
| `status` | Refresh and display current workflow state |
| `pause` | Pause the current stage (tasks keep running) |
| `approve` | Approve the current challenge or review verdict |
| `revise` | Request revision (sends back to previous stage) |
| `back` | Return to the chat view |

### Stage Transitions

The workflow enforces a strict stage transition graph:

```
plan --> challenge
challenge --> plan (revise) or contract (approve)
contract --> challenge (revise) or build (approve)
build --> review
review --> build (fix blockers) or ship (pass)
ship --> retro
retro --> plan (new cycle)
```

Invalid transitions (like `plan -> build`) are rejected with an error message showing valid options.

## Team Configuration

The `/team` command requires a team configuration. See [Team Workflow](/docs/code-with-ai/agents/team-workflow) for the full configuration reference.

Minimal configuration in `.kilo/config.json`:

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
        "canDelegate": ["worker"],
        "maxConcurrent": 2
      },
      "worker": {
        "displayName": "Worker",
        "provider": "openai",
        "model": "gpt-4o-mini",
        "effort": "medium",
        "tier": 2,
        "canDelegate": [],
        "maxConcurrent": 5
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

## Keyboard Shortcuts

Within the workflow dashboard:

| Key | Action |
|-----|--------|
| Up / Down | Navigate task list |
| Enter | Select task / Submit command |
| Tab | Switch between task panel and command input |
| Escape | Return to chat view |
| q | Quit dashboard (same as `back` command) |

## Examples

### Starting a New Workflow

```
> /team init
v Workflow initialized for project "my-app"
v Created .planning/ directory structure
  Opening dashboard...
```

### Planning Phase

```
> plan
[PLAN] Enter your task description or paste requirements.
The planning agent will break them into wave-structured tasks.
```

### Challenging a Plan

```
> challenge
[CHALLENGE] Submitting plan for adversarial review...
  Reviewer: claude-sonnet-4-20250514
  Tasks reviewed: 5
  Verdict: APPROVED
  Concerns: 0 critical, 1 moderate, 0 minor
> next
[CONTRACT] Generating interface contracts...
```

### Building

```
> build
[BUILD] Starting wave 1 (3 tasks)...
  * 01-01 [senior] Implementing auth middleware
  * 01-02 [worker] Adding login endpoint
  * 01-03 [worker] Adding registration endpoint

  v 01-02 completed (45s)
  v 01-03 completed (38s)
  v 01-01 completed (92s)

[BUILD] Wave 1 complete. Starting wave 2 (2 tasks)...
```

### Review with Findings

```
> review
[REVIEW] Cycle 1 -- reviewing implementation...
  Verdict: FAIL (1 blocker, 2 suggestions)

  BLOCKER R-01 [security] src/auth/jwt.ts:14
    JWT secret hardcoded in source
    Fix: Move to environment variable

  SUGGESTION R-02 [style] src/routes/login.ts:28
    Magic number 3600 -- extract to named constant

> build
[BUILD] Applying fixes for 1 blocker...
```

### Shipping

```
> ship
[SHIP] Running quality gates...
  v TypeCheck: PASS (1.2s)
  v Test Suite: PASS (4.8s)
  v Lint: PASS (0.9s)

All gates passed. Ready to commit.
```

## Monitoring and Diagnostics

### Health Alerts

During the build stage, the dashboard shows health alerts:

```
! STUCK: Task 01-03 has had no activity for 18 minutes
! DEADLOCK: 01-04 -> 01-05 -> 01-04 (circular dependency)
```

### Event Log

All workflow events are logged to `.planning/events.jsonl` in append-only JSONL format:

```json
{"eventType":"plan_created","message":"Phase 01-auth planned","timestamp":"2026-04-06T14:30:00Z"}
{"eventType":"task_started","taskId":"01-01","role":"senior","message":"Task started","timestamp":"2026-04-06T14:31:00Z"}
{"eventType":"task_completed","taskId":"01-01","role":"senior","message":"Task done","durationMs":92000,"timestamp":"2026-04-06T14:32:32Z"}
{"eventType":"quality_gate_passed","message":"TypeCheck: PASS","durationMs":1200,"timestamp":"2026-04-06T14:35:00Z"}
```

### Lessons Learned

After each retrospective, captured lessons appear in future agent prompts:

```
## Lessons Learned (DO NOT repeat these mistakes)

### code_pattern

- **[Fix session handler] TypeError: Cannot read property 'id'**: Added null check before accessing session.id -- used optional chaining
```

Lessons with high confidence (hit count >= 3) are marked as "proven" and given higher weight in prompts.

## Limitations

- Team workflow is currently CLI-only. VS Code extension support requires the extension to poll the workflow API endpoints.
- The workflow state is filesystem-based (`.planning/` directory). It does not persist across machines unless the directory is committed to version control.
- Concurrent task execution depends on the AI provider's rate limits. If a provider rate-limits requests, tasks may queue silently.
- The maximum review cycle count is 3. After 3 failed reviews, the workflow escalates rather than continuing to loop.
- File lock detection is advisory -- it prevents concurrent modification within the workflow but does not lock files at the OS level.
