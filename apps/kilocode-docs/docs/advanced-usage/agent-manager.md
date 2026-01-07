# Agent Manager

The Agent Manager is a dedicated control panel for running and supervising Kilo Code agents as interactive CLI processes. It supports:

- Local sessions
- Resuming existing sessions
- Parallel Mode (with support for Git worktree) for safe, isolated changes
- Viewing and continuing cloud-synced sessions filtered to your current repository

This page reflects the actual implementation in the extension.

## Prerequisites

- Install/update the Kilo Code CLI (latest) — see [CLI setup](/cli)
- Open a project in VS Code (workspace required)

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

Worktrees are created in `.kilocode/worktrees/` within your project directory. This folder is automatically added to `.gitignore` to prevent accidental commits.

```
your-project/
├── .kilocode/
│   └── worktrees/
│       └── feature-branch-1234567890/   # isolated working directory
├── .gitignore                           # auto-updated with .kilocode/worktrees/
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

## Remote sessions (Cloud)

When signed in (Kilo Cloud), the Agent Manager lists your recent cloud-synced sessions:

- Up to 50 sessions are fetched
- Sessions are filtered to the current repository via normalized Git remote URL
    - If the current workspace has no remote, only sessions without a git_url are shown
- Selecting a remote session loads its message transcript
- To continue the work locally, send a message — the Agent Manager will spawn a local process bound to that session

Message transcripts are fetched from a signed blob and exclude internal checkpoint “save” markers as chat rows (checkpoints still appear as dedicated entries in the UI).

## Troubleshooting

- CLI not found or outdated
    - Install/update the CLI: [CLI setup](/cli)
    - If you see an “unknown option --json-io” error, update to the latest CLI
- “Please open a folder…” error
    - The Agent Manager requires a VS Code workspace folder
- “Cannot use parallel mode from within a git worktree”
    - Open the main repository (where .git is a directory), not a worktree checkout
- Remote sessions not visible
    - Ensure you’re signed in and the repo’s remote URL matches the sessions you expect to see

## Related features

- [Sessions](/advanced-usage/sessions)
- [Auto-approving Actions](/features/auto-approving-actions)
- [CLI](/cli)
