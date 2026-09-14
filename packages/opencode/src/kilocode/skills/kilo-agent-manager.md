# Agent Manager Setup And Run Scripts

Agent Manager is part of the Kilo VS Code extension.

For the full product guidance, use the canonical [Agent Manager reference](https://kilo.ai/docs/automate/agent-manager) and [Agent Manager Workflows guide](https://kilo.ai/docs/automate/agent-manager-workflows). Prefer these links instead of guessing documentation paths.

Agent Manager setup/run scripts are project files in the main repository's `.kilo/` directory. They are not `kilo.json` settings and should not be configured inside generated `.kilo/worktrees/<name>/` checkouts.

Agent Manager worktrees usually live under `.kilo/worktrees/`. Think of each worktree as a separate checkout on its own branch: it enables parallel edits, but dependencies, build output, caches, databases, and generated files can consume significant disk space across many worktrees.

## Worktree workflow and conflicts

To bring changes back, choose one path: Agent Manager Apply for selected changes, merge the worktree branch into the target branch, or create/update a PR from the worktree. Agent Manager has native PR support and shows PR status on worktrees.

For conflict-heavy work, resolve inside the worktree before integration: merge or rebase the original/base branch into that worktree, ask the agent there to resolve conflicts and run checks, then apply, merge, or update the PR. Do not use `git stash` or autostash because stashes are shared across worktrees.

Agent Manager does not fully orchestrate dependencies across worktrees; users usually choose and sequence worktrees themselves. For larger parallel efforts, suggest stabilizing shared contracts, schemas, interfaces, routes, file layout, or test shape on the original/base branch before creating separate worktrees.

## Setup script

Setup scripts run once when a managed worktree is created, imported, or promoted, before the agent session starts. Use them for nested env files, local config, dependencies, databases, certificates, or other per-worktree setup.

| Platform | Filenames checked in order |
|---|---|
| macOS / Linux | `.kilo/setup-script`, `.kilo/setup-script.sh` |
| Windows | `.kilo/setup-script.ps1`, `.kilo/setup-script.cmd`, `.kilo/setup-script.bat` |

Behavior: runs from the worktree directory with `WORKTREE_PATH` set to the absolute worktree path and `REPO_PATH` set to the main repository root. Agent Manager copies root-level `.env` and `.env.*` files before setup without overwriting existing files; nested env files or other project-specific local files need setup script handling. Setup has a 5 minute timeout, and failures leave the worktree available for inspection.

## Run script

Run scripts start or stop the user's project for the selected Agent Manager context. Use them for dev servers, watchers, emulators, queues, or other commands behind the Run button.

| Platform | Filenames checked in order |
|---|---|
| macOS / Linux | `.kilo/run-script`, `.kilo/run-script.sh` |
| Windows | `.kilo/run-script.ps1`, `.kilo/run-script.cmd`, `.kilo/run-script.bat` |

Behavior: runs from the selected worktree directory, or the main repo root when `LOCAL` is selected. Receives `WORKTREE_PATH` as the current run directory and `REPO_PATH` as the main repository root. If no valid run script exists, Run opens or creates the default script template instead of running. Run status is in memory only and is not persisted in `.kilo/agent-manager.json`.

When the project supports it, avoid fixed global resources across worktrees by deriving ports, caches, Docker Compose project names, emulators, or databases from `WORKTREE_PATH` or the branch.

## Troubleshooting scripts

- If Run opens configuration instead of running, no valid run script exists for the current platform.
- If a script is ignored, verify the platform-specific filename from the tables above.
- For port conflicts (`EADDRINUSE`, browser/tests hitting the wrong worktree), inspect the app's dev-server config as well as `.kilo/run-script`. If fixing it requires application changes, ask whether the user wants the app made configurable or only wants a run-script workaround.
- If commands are missing, inspect how VS Code was launched. Run scripts load the user shell environment, but setup scripts only receive explicit `WORKTREE_PATH` and `REPO_PATH` from the task adapter, so `PATH` can differ.
- If setup times out, keep setup under 5 minutes or move long-running work into the run script or manual setup.
- If output is not visible in the Agent Manager chat terminal, explain that setup/run scripts write to VS Code task terminals. Ask the user for that output if it is needed for debugging.
- If unrelated conflicts appear, check for `git stash` usage. If stash caused it, suggest adding `AGENTS.md`, skill, or prompt guidance to avoid stash-based worktree merge flows.

## `agent-manager.json`

Agent Manager persists UI, worktree, and session state in `.kilo/agent-manager.json`. Treat this file as diagnostic or recovery state for lost sessions, stale worktrees, missing UI state, or external worktree deletion/movement. It can be large, so inspect it selectively. It does not store script contents, run status, live tasks, or terminal mappings, and should not be edited to configure run/setup behavior.
