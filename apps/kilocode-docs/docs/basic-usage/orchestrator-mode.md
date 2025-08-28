---
sidebar_label: "Orchestrator Mode"
---

import YouTubeEmbed from '@site/src/components/YouTubeEmbed';

# Orchestrator Mode: Coordinate Complex Workflows

Orchestrator Mode (formerly known as Boomerang Tasks) allows you to break down complex projects into smaller, manageable pieces. Think of it like delegating parts of your work to specialized assistants. Each subtask runs in its own context, often using a different Kilo Code mode tailored for that specific job (like [`code`](/basic-usage/using-modes#code-mode-default), [`architect`](/basic-usage/using-modes#architect-mode), or [`debug`](/basic-usage/using-modes#debug-mode)).

<YouTubeEmbed
  url="https://www.youtube.com/watch?v=20MmJNeOODo"
  caption="Orchestrator Mode explained and demonstrated"
/>

## Why Use Orchestrator Mode?

- **Tackle Complexity:** Break large, multi-step projects (e.g., building a full feature) into focused subtasks (e.g., design, implementation, documentation).
- **Use Specialized Modes:** Automatically delegate subtasks to the mode best suited for that specific piece of work, leveraging specialized capabilities for optimal results.
- **Maintain Focus & Efficiency:** Each subtask operates in its own isolated context with a separate conversation history. This prevents the parent (orchestrator) task from becoming cluttered with the detailed execution steps (like code diffs or file analysis results), allowing it to focus efficiently on the high-level workflow and manage the overall process based on concise summaries from completed subtasks.
- **Streamline Workflows:** Results from one subtask can be automatically passed to the next, creating a smooth flow (e.g., architectural decisions feeding into the coding task).

## How It Works

1.  Using Orchestrator Mode, Kilo can analyze a complex task and suggest breaking it down into a subtask[^1].
2.  The parent task pauses, and the new subtask begins in a different mode[^2].
3.  When the subtask's goal is achieved, Kilo signals completion.
4.  The parent task resumes with only the summary[^3] of the subtask. The parent uses this summary to continue the main workflow.

## Key Considerations

- **Approval Required:** By default, you must approve the creation and completion of each subtask. This can be automated via the [Auto-Approving Actions](/features/auto-approving-actions#subtasks) settings if desired.
- **Context Isolation and Transfer:** Each subtask operates in complete isolation with its own conversation history. It does not automatically inherit the parent's context. Information must be explicitly passed:
    - **Down:** Via the initial instructions provided when the subtask is created.
    - **Up:** Via the final summary provided when the subtask finishes. Be mindful that only this summary returns to the parent.
- **Navigation:** Kilo's interface helps you see the hierarchy of tasks (which task is the parent, which are children). You can typically navigate between active and paused tasks.

Orchestrator Mode provides a powerful way to manage complex development workflows directly within Kilo Code, leveraging specialized modes for maximum efficiency.

:::tip Keep Tasks Focused
Use subtasks to maintain clarity. If a request significantly shifts focus or requires a different expertise (mode), consider creating a subtask rather than overloading the current one.
:::

[^1]: This context is passed via the `message` parameter of the [`new_task`](/features/tools/new-task) tool.

[^2]: The mode for the subtask is specified via the `mode` parameter of the [`new_task`](/features/tools/new-task) tool during initiation.

[^3]: This summary is passed via the `result` parameter of the [`attempt_completion`](/features/tools/attempt-completion) tool when the subtask finishes.
