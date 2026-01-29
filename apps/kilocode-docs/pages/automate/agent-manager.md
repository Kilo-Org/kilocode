---
title: "Agent Manager"
description: "Manage and orchestrate multiple AI agents"
---

# Agent Manager

The Agent Manager is a dedicated control panel for running and supervising Kilo Code agents as interactive CLI processes. It supports:

- Local sessions
- Resuming existing sessions
- Parallel Mode (with support for Git worktree) for safe, isolated changes
- Viewing and continuing cloud-synced sessions filtered to your current repository

This page reflects the actual implementation in the extension.

## Prerequisites

- Install/update the Kilo Code CLI (latest) — see [CLI setup](/docs/cli)
- Open a project in VS Code (workspace required)
- Authentication: You must be logged in via the extension settings OR use CLI with kilocode as provider (see [Authentication Requirements](#authentication-requirements))

## Opening the Agent Manager

- Command Palette: “Kilo Code: Open Agent Manager”
- Or use the title/menu entry if available in your Kilo Code UI

The panel opens as a webview and stays active across focus changes.

## Sending messages, approvals, and control

- Continue the conversation: Send a follow-up message to the running agent
- Approvals: If the agent asks to use a tool, run a command, launch the browser, or connect to an MCP server, the UI shows an approval prompt
    - Approve or reject, optionally adding a short note
- Cancel vs Stop
    - Cancel sends a structured cancel message to the running process (clean cooperative stop)
    - Stop force-terminates the underlying CLI process, updating status to “stopped”

## Resuming an existing session

You can continue a session later (local or remote):

- If a session is not currently running, the Agent Manager will spawn a new CLI process attached to that session’s ID
- Labels from the original session are preserved whenever possible
- Your first follow-up message becomes the continuation input

## Parallel Mode

Parallel Mode runs the agent in an isolated Git worktree branch, keeping your main branch clean.

- Enable the "Parallel Mode" toggle before starting
- The extension prevents using Parallel Mode inside an existing worktree
    - Open the main repository (where .git is a directory) to use this feature

### Worktree Location

Worktrees are created in `.kilocode/worktrees/` within your project directory. This folder is automatically excluded from git via `.git/info/exclude` (a local-only ignore file that doesn't require a commit).

```
your-project/
├── .git/
│   └── info/
│       └── exclude   # local ignore rules (includes .kilocode/worktrees/)
├── .kilocode/
│   └── worktrees/
│       └── feature-branch-1234567890/   # isolated working directory
└── ...
```

### While Running

The Agent Manager surfaces:

- Branch name created/used
- Worktree path
- A completion/merge instruction message when the agent finishes

### After Completion

- The worktree is cleaned up automatically, but the branch is preserved
- Review the branch in your VCS UI
- Merge or cherry-pick the changes as desired

### Resuming Sessions

If you resume a Parallel Mode session later, the extension will:

1. Reuse the existing worktree if it still exists
2. Or recreate it from the session's branch

## Authentication Requirements

The Agent Manager requires proper authentication for full functionality, including session syncing and cloud features.

### Supported Authentication Methods

1. **Kilo Code Extension (Recommended)**

    - Sign in through the extension settings
    - Provides seamless authentication for the Agent Manager
    - Enables session syncing and cloud features

2. **CLI with Kilo Code Provider**
    - Use the CLI configured with `kilocode` as the provider
    - Run `kilocode config` to set up authentication
    - See [CLI setup](/docs/cli) for details

### BYOK Limitations

**Important:** Bring Your Own Key (BYOK) is not fully supported with the Agent Manager.

If you're using BYOK with providers like Anthropic, OpenAI, or OpenRouter:

- The Agent Manager will not have access to cloud-synced sessions
- Session syncing features will be unavailable
- You must use one of the supported authentication methods above for full functionality

To use the Agent Manager with all features enabled, switch to the Kilo Code provider or sign in through the extension.

## Remote sessions (Cloud)

When signed in (Kilo Cloud), the Agent Manager lists your recent cloud-synced sessions:

- Up to 50 sessions are fetched
- Sessions are filtered to the current repository via normalized Git remote URL
    - If the current workspace has no remote, only sessions without a git_url are shown
- Selecting a remote session loads its message transcript
- To continue the work locally, send a message — the Agent Manager will spawn a local process bound to that session

Message transcripts are fetched from a signed blob and exclude internal checkpoint "save" markers as chat rows (checkpoints still appear as dedicated entries in the UI).

## Troubleshooting

- CLI not found or outdated
    - Install/update the CLI: [CLI setup](/docs/cli)
    - If you see an "unknown option --json-io" error, update to the latest CLI
- "Please open a folder…" error
    - The Agent Manager requires a VS Code workspace folder
- "Cannot use parallel mode from within a git worktree"
    - Open the main repository (where .git is a directory), not a worktree checkout
- Remote sessions not visible
    - Ensure you're signed in and the repo's remote URL matches the sessions you expect to see
    - If using BYOK, session syncing is not available — switch to Kilo Code provider or sign in through the extension
- Authentication errors
    - Verify you're logged in via extension settings or using CLI with kilocode provider
    - BYOK configurations do not support Agent Manager authentication

## Related features

- [Sessions](/docs/advanced-usage/sessions)
- [Auto-approving Actions](/docs/features/auto-approving-actions)
- [CLI](/docs/cli)
