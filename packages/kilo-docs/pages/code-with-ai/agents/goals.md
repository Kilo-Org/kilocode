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
| Waiting | The goal is suspended until a scheduled wakeup, a cron task, or a background process fires. It resumes itself when the wait ends |
| Complete | The working model reported the goal met |

**Complete (model-reported)** means the model reported success. Kilo does not independently verify the result. Review the work before you rely on it.

The objective and the last report stay on the session until you clear the goal. They survive session restarts and forks. Active goals become paused after a backend restart; a waiting goal resumes when its wait fires; complete goals stay complete.

## Automatic pauses

Kilo pauses an active goal when progress stops or the session changes direction:

- The agent replies with no successful action and no completion report.
- Work fails, such as a model error or a failed command.
- You press Stop.
- You run a shell command.
- A permission request or tool call is rejected, which marks the goal blocked instead of paused.
- The backend restarts. An active goal becomes paused; a waiting goal resumes when its wait fires; a complete goal stays complete.

A new message you send is not an automatic pause. It takes priority for that turn, then the goal continues toward the objective. Use Stop or `/goal pause` to stop active work.

## Waiting on time

A goal can wait on time instead of spinning. When the agent schedules a wakeup with `schedule_wakeup`, creates a recurring task with `cron_create`, or starts a non-terminal `background_process`, the goal suspends and no further goal turn runs until the wait fires or the process exits. Scheduling a wait is normal goal progress, not a blocker. When the objective is to wait for a deploy, build, or CI job, the agent schedules that wait immediately instead of exploring the repository first.

While a goal waits, its status is **Waiting** and it names what it waits for. When a wakeup or cron task fires, the goal resumes as a goal turn that carries the objective, so a recurring task re-suspends the goal after each resumed turn. A background process resumes the goal when it exits or fails.

- `/goal pause` and `/goal clear` cancel the goal's armed wakeups and cron tasks. Completing, blocking, pausing, or clearing a goal leaves no armed wakeup or cron task behind.
- Cancelling or deleting the awaited wakeup or cron task resumes or settles the goal with a reason you can read, and leaves the session's other reminders alone.
- A waiting goal survives a backend restart. The armed timer resumes it, or it settles with a user-readable reason.
- A wait longer than seven days is clamped to the seven-day horizon and reported in the tool result. A recurring cron schedule whose next fire falls past the task's seven-day expiry is rejected instead.
- Each session can hold at most 10 pending wakeups and 10 cron tasks. Cancel or delete one before scheduling more.

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

## Related

- [Using Agents](/docs/code-with-ai/agents/using-agents) for agent selection and tool access
- [Session History and Search](/docs/code-with-ai/agents/session-history) for resuming and forking sessions
- [CLI](/docs/code-with-ai/platforms/cli) for the full slash-command list
