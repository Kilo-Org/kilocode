# Kilo Code (v2 preview)

This is the preview build of Kilo Code on the Kilo v2 server.

## Install

Install the pre-release build from the command line:

```sh
code --install-extension kilocode.kilo-code-v2 --pre-release
```

You can also install it from the Extensions view: open the extension, select the gear menu, then select **Install Pre-Release Version**.

The preview requires VS Code 1.95 or later.

## Run it next to Kilo Code v1

The preview uses the separate extension id `kilocode.kilo-code-v2` and keeps its server data in a separate `kilo2` directory. You can install it next to Kilo Code v1 and switch between both.

## Try Cloud workspaces in Agent Manager

From the checkout you want to try, launch this worktree’s extension in a separate VS Code window:

```sh
bun install --frozen-lockfile
bun run --cwd packages/kilo-vscode extension "$PWD"
```

Open **Agent Manager** and expand the project. Remote workspaces appear alongside worktrees with **Cloud** on the second line. Select one to see its session tabs and saved conversation. The list uses the project’s Git `origin` and the active Kilo account and organization.

Choose **Create Cloud workspace** from the project’s creation dropdown to start from the remote repository and selected ref. Uncommitted local files are not uploaded. To start another session in that workspace, use the `+` beside the session tabs.

Each tab has its own conversation and permissions. Its agent, sibling agents, and the workspace terminals see the same remote checkout. A new tab can show **Preparing session** while Cloud registers the agent. Closing a tab does not stop the agent or delete its saved history.

Send prompts, answer questions, approve or reject tool requests, or use **Stop** to interrupt an agent. Paste or drop images into a new workspace prompt or an existing conversation. Cloud requires the first prompt in a new *sibling tab* to be text; send images there after that first turn.

Use **Toggle diff** to review the sandbox’s changed files in unified, split, or read-only source view. **Terminal** opens a remote shell; switch agent tabs without disconnecting it, or use the terminal strip’s `+` for another shell. A sleeping sandbox may require a message before its terminal is available. The session menu includes details and cost, rename, and confirmed deletion. **Preview** opens a listening sandbox port when the deployment supports it.

Type `/` to discover the sandbox’s commands. During a run, **Enter** submits a follow-up to Cloud. **Cancel** removes a message while the Cloud worker still has it queued. Once the runtime accepts it, use **Escape** or **Stop** to interrupt. **Cmd+Enter** (Ctrl+Enter on Windows/Linux) stops the current run before submitting the new prompt. Cloud does not expose local worktree steering at the next model-step boundary.

Cloud tabs use the same focus and activity indicators as worktrees. Open an edit card’s **Open in Diff Viewer** action for the captured patch, or use a task card’s open control to inspect a subagent. Restarting Agent Manager restores the selected conversation after account and workspace verification. A disconnected shell offers a fresh terminal; reconnecting to a chat does not resend its prompt. The session menu also supports continuing a conversation in a new Cloud workspace and explicitly sharing an eligible frozen snapshot. A fork copies supported conversation history, not the running shell or uncommitted files.

Cloud currently limits public snapshots to eligible legacy-format sessions. Anchored review comments require a captured diff and an eligible Cloud-web root chat in the same workspace. Saved review comments are restored only after Cloud verifies the source and account again. The Changes panel serves files captured in a diff, rather than an arbitrary remote filesystem tree.

Turn off **Show Cloud workspaces** in **Kilo Settings → Agent Manager** to hide these rows.

## Webview accessibility checks

From `packages/kilo-vscode`, run `bun run playwright-core install --no-shell chromium` once, then `bun run test:accessibility`. The CI gate runs the Agent Manager sidebar search in Chromium with the production webview component and styles. It fails on axe WCAG violations or broken keyboard selection and dismissal. It does not require VS Code, a server, or an account.

## Feedback

Report problems at https://github.com/Kilo-Org/kilocode/issues.
