---
title: "What's New in Kilo Code (April 2026)"
description: "The Kilo Code extension has been rebuilt from the ground up on the Kilo CLI — faster, more flexible, and with access to 500+ models."
---

# What's New in Kilo Code

The Kilo Code extension has been completely rebuilt on a portable, open-source core shared across VS Code, the CLI, and Cloud Agents. This is the biggest update since launch: faster execution with parallel tool calls and subagents, the new Agent Manager for running multiple agents side by side, inline code review with line-level comments, multi-model comparisons, and access to 500+ models.

Whether you're writing features in VS Code, debugging over SSH, or reviewing code on Slack, Kilo now goes with you. Read the [full announcement on the Kilo Blog](https://blog.kilo.ai/p/new-kilo-for-vs-code-is-live) for everything that's new.

---

## Adjusting to the new version

A lot has changed under the hood, and some things have moved around. If you're coming from the previous extension, you might have questions about where to find certain features or how things work now. We've collected the most common questions below.

Still stumped after reading this? Come find us in discord at #vscode.

### Where did code indexing go?

Code indexing is temporarily unavailable in the new extension. It is actively being worked on and is expected to return soon. Please follow [this issue](https://github.com/Kilo-Org/kilocode/issues/6144)

### How do checkpoints work in the new extension?

Checkpoints are now called **snapshots** in the new extension.
They use Git-based snapshots of your working directory, taken before and after agent edits.
You can revert any message's changes directly from the chat, and a revert banner appears when you're viewing an earlier state.
See the [Checkpoints documentation](/docs/code-with-ai/features/checkpoints) for details.

### Where is the auto-approve settings UI?

The old auto-confirm commands UI has been replaced by a granular per-tool permission system.
Open **Settings → Auto Approve** to configure each tool (bash, read, edit, glob, grep, etc.) with **Allow**, **Ask**, or **Deny**.
There is no longer a separate command allowlist — shell execution is controlled by the `bash` tool permission.
See [Auto-Approving Actions](/docs/getting-started/settings/auto-approving-actions) for more information.

### Is the context progress graph still available?

The context progress graph is being evaluated for the new extension.
This feature may be reintroduced in a future update.

### Where is the diff view for file changes?

Each message that caused file changes shows a **diff badge** in the chat — click it to open the Diff Viewer and review what changed.
The Agent Manager also includes a built-in diff reviewer that shows every change file by file, in unified or split view.

### How do I do code reviews in the new extension?

You can now trigger local AI-powered code reviews directly by using two commands: **`/local-review`** to review all changes on your current branch vs the base branch, and **`/local-review-uncommitted`** to review staged and unstaged changes.
See the [Code Reviews](/docs/automate/code-reviews/overview) documentation for the full setup and options.

### Where did orchestrator mode go?

Orchestrator mode is deprecated.
Agents with full tool access (Code, Plan, Debug) can now **delegate to subagents automatically** — you no longer need a dedicated orchestrator. Just pick the agent for your task and it will coordinate subagents when helpful.
You can also define your own [custom subagents](/docs/customize/custom-subagents).
See the [Orchestrator Mode](/docs/code-with-ai/agents/orchestrator-mode) page for the full details on what changed.
