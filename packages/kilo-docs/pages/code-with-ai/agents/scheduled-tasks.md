---
title: "Scheduled tasks"
description: "Have Kilo resume a session later or on a recurring schedule"
---

# Scheduled tasks

Kilo can schedule a session to resume itself at a future time, so a long wait does not need you to keep the session open. Ask for a one-shot wakeup or a recurring task, for example:

- "Check the deploy in 20 minutes and report back."
- "Every weekday at 9am, review any new issues in this repository."

When the schedule fires, Kilo resumes the session with the prompt you gave and continues as a normal turn. Fired prompts appear in the transcript marked **Scheduled wakeup** or **Scheduled cron task**, so they are not mistaken for messages you typed.

## One-shot and recurring

| You want | Tool | Behavior |
|---|---|---|
| A single future point | `schedule_wakeup` | Resumes the session once at a relative `delay` or an absolute `when`. |
| A repeating schedule | `cron_create` | Resumes the session each time a 5-field cron expression comes due. It also fires once for a `when` or `delay`. |

Kilo chooses the tool from your request. `cron` is minute-granular, so the smallest recurring interval is one minute.

## Limits and behavior

- A one-shot wait is capped at a seven-day horizon; a longer `delay` or `when` is clamped, and the tool result reports the adjustment.
- A `delay` under 10 seconds is raised to 10 seconds.
- A session can hold up to 10 pending wakeups and 10 scheduled cron tasks.
- A recurring task expires seven days after it is created, so a forgotten loop cannot run forever. A schedule whose next fire would fall past that expiry is rejected.
- A due task waits until the session is idle. Missed fires are not replayed; the next fire is computed from the current time.
- Fire times carry a small jitter so many sessions do not fire at once.

## Managing scheduled tasks

Ask Kilo to list or cancel them, or use the tools directly:

| Tool | Action |
|---|---|
| `cancel_wakeup` | List pending wakeups with their id, due time, and reason, or cancel one by id. |
| `cron_list` | List scheduled tasks with their id, schedule, next fire time, and prompt. |
| `cron_delete` | Delete a scheduled task by id. |

Cancelling an id that has already fired is safe; the tool reports it and does not fail.

## Session status and Keep Awake

While a session is asleep on a pending wakeup, `kilo session list` shows its Status as `scheduled` with the wake time, and Kilo does not treat it as a running turn. [Keep Awake](/docs/getting-started/settings/keep-awake) holds the machine awake while a session has a scheduled wakeup and no other work is running.

## Related

- [Session Goals](/docs/code-with-ai/agents/goals) for keeping one objective in focus across turns
- [Session History and Search](/docs/code-with-ai/agents/session-history) for resuming and searching sessions
