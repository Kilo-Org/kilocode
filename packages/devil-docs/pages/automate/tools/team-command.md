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

Shows stage guidance, the selected task's files/dependencies/verification commands, and persisted summary output when a task has completed. The tab bar exposes agent output plus artifact views for Plan, Activity, Challenge, and Review as they become available.

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
| `ship` | Run final quality gates, persist ship readiness, and mark the phase complete in `ROADMAP.md` | `review` (after passing review) |
| `retro` | Persist retrospective lessons and follow-ups for the phase | `ship` |

### Control Commands

| Command | Description |
|---------|-------------|
| `next` | Advance to the next valid stage automatically |
| `status` | Refresh and display current workflow state |
| `pause` | Pause the build after the current wave finishes. Run `build` again to resume. |
| `approve` | Resolve the canonical stage action (`challenge -> contract`, `contract -> build`, `review -> ship`) |
| `revise` | Send the workflow back one stage where revision is supported (`challenge -> plan`, `contract -> challenge`, `review -> build`) |
| `back` | Return to the chat view |

Free-text input is currently the planning-stage happy path: paste phase requirements while the workflow is in `plan` and the planner will create or update the current phase context.

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
| Enter | Submit the command input |
| Escape | Return to chat view |

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
> implement the auth workflow for API and CLI clients
[PLAN] Phase requirements captured.
[PLAN] Building a wave-structured task list for the new phase...
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
[SHIP] Running final quality gates...
  v TypeCheck: PASS (1.2s)
  v Test Suite: PASS (4.8s)
  v Lint: PASS (0.9s)

Ship ready. ROADMAP.md updated and the ship report was persisted to .planning/phases/01-auth/01-SHIP.md.
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
- Free-text guidance is only wired for the planning stage right now. Later stages are command-driven.
- The maximum review cycle count is 3. After 3 failed reviews, the workflow escalates rather than continuing to loop.
- File lock detection is advisory -- it prevents concurrent modification within the workflow but does not lock files at the OS level.
