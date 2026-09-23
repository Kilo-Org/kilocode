---
title: "Session Goals"
description: "Keep an agent working toward a single objective with the /goal command"
---

# Session Goals

A session goal keeps one objective in focus across turns. The agent keeps working until it reports the goal complete or blocked, and you can pause, resume, or clear it at any time.

## Starting a goal

{% tabs %}
{% tab label="VS Code" %}

Type `/goal` to enter goal-composer mode, then enter the objective. The composer shows a **Set goal** header, and the send button changes to **Start goal**. The objective can span multiple lines, and you can attach files or images before you send.

To set a goal without entering composer mode, type `/goal <objective>` and send it directly.

{% /tab %}
{% tab label="CLI" %}

Start a goal with an inline objective:

```text
/goal Fix the failing validation tests
```

To treat a control word as the objective, separate it with `--`:

```text
/goal -- pause
```

The `--` delimiter sets the literal objective `pause` instead of pausing the current goal. The VS Code goal composer adds this delimiter for you.

{% /tab %}
{% /tabs %}

An objective can be up to 10,000 characters.

## Goal controls

| Command | Action |
|---|---|
| `/goal <objective>` | Start a goal, or replace the running objective |
| `/goal` | Show the current goal and help text |
| `/goal pause` | Pause active work and keep the objective |
| `/goal resume` | Continue a paused goal, or restart a complete goal |
| `/goal clear` | Remove the saved objective and report |

The CLI and VS Code also show a goal control next to the composer. Select it to pause, resume, or clear the goal. When a goal is complete, the control label is **Restart goal** instead of **Resume**.

## Agent-started goals

The agent can start or resume a goal itself with the `goal` tool. It calls `goal` with `action: "start"` and an objective, or `action: "resume"` to continue the saved goal after a pause, block, or completion.

Unlike `/goal`, the agent's call does not cancel the current response. The goal becomes active and the goal loop continues after the current turn. The `goal` tool is unavailable while a goal is active; pause or clear the goal first. The tool requests the `goal` permission, which is allowed by default. Set `permission.goal` to `ask` or `deny` to require approval or block agent-started goals. Delegated subagent sessions cannot start a goal.

## Goal statuses

| Status | Meaning |
|---|---|
| Active | The agent is working toward the objective |
| Paused | The objective is saved but not running. Resume to continue |
| Blocked | A request was rejected or execution was blocked. Resolve the blocker, then resume |
| Complete | The working model reported the goal met |

**Complete (model-reported)** means the model reported success. Kilo does not independently verify the result. Review the work before you rely on it.

The objective and the last report stay on the session until you clear the goal. They survive session restarts and forks. Active goals become paused after a backend restart; complete goals stay complete.

## Automatic pauses

Kilo pauses an active goal when progress stops or the session changes direction:

- The agent replies with no successful action and no completion report.
- Work fails, such as a model error or a failed command.
- You press Stop.
- You run a shell command.
- A permission request or tool call is rejected, which marks the goal blocked instead of paused.
- The backend restarts. An active goal becomes paused; a complete goal stays complete.

A new message you send is not an automatic pause. It takes priority for that turn, then the goal continues toward the objective. Use Stop or `/goal pause` to stop active work.

## Completion reports

During a goal, the working model reports the outcome with the `goal_report` tool:

- `complete` with a reason when the objective is met.
- `blocked` with a reason when a genuine blocker prevents safe progress.

Only the root goal worker can call `goal_report`. Delegated workers return their findings to the root. The tool uses the permission name `goal_report`, so goal execution keeps the session's existing permission rules, and a rejected permission request blocks the goal.

A report is the model's own report, not independent verification, and Kilo saves it only after the turn finishes without an error or a rejected request.

## Clarification questions

The `question` tool is unavailable during active goal execution, including delegated work. The agent proceeds with safe, reversible decisions instead of asking for clarification. Ordinary chat outside an active goal keeps the `question` tool.

## Attachments and drafts in VS Code

Goal-composer mode accepts multiline objectives and file or image attachments. If an attachment cannot be read during creation, Kilo keeps the existing goal running and preserves your draft, so you can correct it and try again.

## Limits and integration

- A custom command or an MCP prompt named `goal` is reserved. Kilo rejects it and reports an error; rename it.
- The goal is stored under the `kilo.goal` session metadata key.
- Headless mode supports only status and controls through `kilo run --command goal`, which accepts no argument, `pause`, or `clear`. The agent can still start or resume a goal itself with the `goal` tool.

## Autonomous engine (experimental)

Set `autonomous_goal.enabled: true` in your config to route `/goal` to the autonomous engine instead of the loop above. The engine:

1. Plans with a read-only planner (`cloud_reasoner` model): a goal summary, acceptance criteria, and a dependency-ordered task list.
2. Runs one task at a time with a worker that may edit files and run commands but can never push, commit, publish, or use `sudo`.
3. Runs the project's checks after every task (detected from `package.json` scripts, `pyproject.toml`, `pubspec.yaml`, `Cargo.toml`, `go.mod`, or the `autonomous_goal.checks` list) and a read-only reviewer over the diff.
4. Retries a failed task locally, escalates to the cloud model when the same failure repeats or attempts run out, and blocks the goal when the cloud attempt also fails.
5. After all tasks, re-checks every acceptance criterion against the actual diff, replans missing work, and finishes only after a final review.

Model classes come from `autonomous_goal.models` (`local_small`, `local_coder`, `cloud_reasoner`) and fall back to `small_model`, `subagent_model`, and `model`. Cloud usage is limited by `autonomous_goal.budget`; when a limit is reached the goal pauses with the reason.

The engine remembers each repository: the planner writes a short summary of the project that later goals receive as notes, and a per-project routing history moves a task complexity to a stronger model class once a local class has failed it repeatedly. An objective of the form `#123`, `owner/repo#123`, or a GitHub issue URL is resolved to the issue title and body through the `gh` CLI.

Controls: `/goal <objective>` starts, `/goal status` (or bare `/goal`), `/goal tasks`, and `/goal budget` report progress, `/goal pause`, `/goal resume`, and `/goal clear` work as before. State is saved after every step, so a paused or restarted goal resumes from its task list. The session goal row shows `active`, `paused`, `blocked`, or `complete` as with the standard loop; `complete` here means the checks, goal check, and final review all passed.

## Related

- [Using Agents](/docs/code-with-ai/agents/using-agents) for agent selection and tool access
- [Session History and Search](/docs/code-with-ai/agents/session-history) for resuming and forking sessions
- [CLI](/docs/code-with-ai/platforms/cli) for the full slash-command list
