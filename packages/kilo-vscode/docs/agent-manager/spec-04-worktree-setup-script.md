# Spec 04: Worktree Setup Script Support

**Depends on:** Spec 01 (worktree support)

## Goal

When a new worktree is created for an Agent Manager session, run a user-configurable setup script inside it before the agent starts. This lets users install dependencies, copy env files, run codegen, etc. so the agent starts with a fully prepared environment.

## Reference

Study the old implementation at `kilocode/src/core/kilocode/agent-manager/`:

- `WorktreeManager.ts` — look for setup script invocation after `git worktree add`
- `AgentManager.ts` — how the script path/content was configured and passed to WorktreeManager

Also look at how Schaltwerk implements this in `.schaltwerk/setup.sh` for reference on the concept — it's the same idea.

## What to Build

### Configuration

The setup script path is stored in VS Code workspace settings under `kilo-code.new.agentManager.worktreeSetupScript`. An empty string means no script runs.

Add this to `packages/kilo-vscode/package.json` under `contributes.configuration`.

### `packages/kilo-vscode/src/agent-manager/WorktreeManager.ts`

Add `runSetupScript(worktreePath, scriptPath)`:

- Resolves `scriptPath` relative to workspace root
- Executes the script with `cwd` = worktree path using Node `child_process.execFile`
- Streams stdout/stderr to the session's output channel
- Rejects if the script exits with non-zero — the session creation should surface this error to the user

Call `runSetupScript()` in `createWorktree()` after the git worktree is ready and before returning, if a script path is configured.

### `packages/kilo-vscode/webview-ui/agent-manager/AgentManagerApp.tsx`

Show a spinner/status on the session list item while the setup script is running (new status: `"setting-up"`). Once complete the session transitions to normal state and the agent starts.

## Notes

- The script runs in the worktree directory, not the workspace root
- Failure should be surfaced clearly — show an error state on the session item, log full output to the output channel
- Common use cases: `bun install`, `cp ../.env .env`, `bun run codegen`
