---
title: "Kilo Code for JetBrains: Free Open-Source AI Coding Plugin"
description: "Using Kilo Code in JetBrains IDEs"
---

# Kilo Code for JetBrains: Free AI Coding Plugin

## Installation

{% partial file="install-jetbrains.md" /%}

## Reviewing file changes

When the agent writes or edits files, the session view renders `write`, `edit`, and `apply_patch` results as expandable diff previews instead of generic tool output. Each preview has a header with a clickable file link and aggregate change counts, followed by a syntax-highlighted diff. File links open the exact file in the editor — even when several files share the same name — and show the full path on hover. A multi-file `apply_patch` result renders as a **Patch** with a file-count tag and one clickable section per file, each with its own change badge.

## Queueing prompts

You don't have to wait for the agent to finish before sending your next prompt. While a session is busy, type your follow-up and press **Send** to add it to the session's queue; queued prompts are processed in order. **Stop** remains available while the input is empty — with a draft entered, Send takes its place.

A queued prompt appears in the conversation with a **Queued** badge and a remove action, so you can delete it before it runs.

## Settings

Open **Settings → Tools → Kilo Code** to configure the plugin. The JetBrains plugin reads and writes the same shared `kilo.jsonc` config files as the CLI and the VS Code extension, so changes apply across clients. See [Settings](/docs/getting-started/settings) for config file locations and precedence.

- **Auto-Approve** — set per-tool permission levels (Allow / Ask / Deny) and manage granular command and path exceptions without editing config by hand. Permission prompts offer one-time approvals alongside saved allow/reject rules. See [Auto-Approving Actions](/docs/getting-started/settings/auto-approving-actions) for the shared permission model.
- **Context** — toggle auto-compaction, set the auto-compaction limit (the percentage of the model window that triggers compaction), enable pruning of old tool outputs, and manage file watcher ignore patterns. See [Context Condensing](/docs/customize/context/context-condensing) and [.kilocodeignore](/docs/customize/context/kilocodeignore) for what these settings control.
- **Agent Behavior → Skills** — inspect loaded skills, add extra skill sources (local paths or remote URLs), edit or remove custom skills, and open skill files in the editor. See [Skills](/docs/customize/skills) for the skill format and discovery rules.
- **Agent Behavior → Rules** — manage additional instruction files (the `instructions` config): add files by path, glob, or URL, edit file contents, open them in the editor, or delete them. Includes the **Claude Code Compatibility** toggle to load CLAUDE.md instructions and skills from your Claude Code configuration (requires restart). See [Custom Rules](/docs/customize/custom-rules) for how instruction files are loaded.
