# Agent Manager Script Terminals

Status: implementation plan only

Baseline researched: `main` at `a0364858a6e1b69a2e2dc5434a82d5cefbe79ea7` (`v7.4.17`)

Related issues:

- [#12595](https://github.com/Kilo-Org/kilocode/issues/12595), per-worktree session terminals in the embedded side panel
- [#11083](https://github.com/Kilo-Org/kilocode/issues/11083), setup blocks session start and disrupts the terminal layout
- [#7526](https://github.com/Kilo-Org/kilocode/issues/7526), original Agent Manager Run script feature
- [#12597](https://github.com/Kilo-Org/kilocode/issues/12597), multiple side terminals, already implemented
- [#12649](https://github.com/Kilo-Org/kilocode/issues/12649), setup-script migration split from this implementation

## Goal

Setup scripts and Run scripts must execute in first-class terminal tabs inside the Agent Manager right-side terminal panel. Neither action should reveal or require the bottom VS Code terminal panel.

The result must:

- run the existing platform-specific setup and Run script files on Windows, Linux, and macOS;
- preserve the current working directory, environment, exit status, timeout, and one-Run-per-context behavior;
- show live output, accept input for interactive scripts, and retain bounded scrollback after exit;
- stop the correct process and its descendants;
- survive Agent Manager webview reloads and context switching while the extension/backend remain alive;
- reject unsafe script paths and respect VS Code Workspace Trust;
- never construct a shell command string in the webview or inject a command through terminal input.

## Issue Scope Correction

Issue #12595 currently describes routing a plain session/worktree shell through the existing `terminalButtonDestination` preference. Implementing that issue literally does not migrate either script system:

- setup scripts still use `vscode.tasks.executeTask()` through `task-runner.ts`;
- Run scripts still use `vscode.tasks.executeTask()` through `run/task.ts`;
- both task definitions use `TaskRevealKind.Always`, which opens the bottom terminal panel.

Before implementation, revise #12595 or replace its acceptance criteria with this plan. The plain session-terminal routing can remain a small related change, but it is not sufficient for the stated product goal.

This plan addresses only the terminal/output part of #11083. Setup remains awaited before the first worktree session starts in the initial implementation. Making setup asynchronous is a separate lifecycle change and should not be combined with the terminal migration.

## Product Decisions

### Script output always belongs to Agent Manager

Setup and Run are Agent Manager operations, so they always use named side-panel terminals:

- `Setup` for worktree setup
- `Run` for the selected Local or worktree context

They do not follow `kilo-code.new.agentManager.terminalButtonDestination`. That setting continues to control only where an ordinary user-requested interactive shell opens. This keeps the meaning of the setting narrow and avoids adding another preference.

### No automatic VS Code terminal fallback

If script PTY creation fails, show an Agent Manager error and do not execute the script. Automatically falling back after an uncertain PTY failure could execute a setup or Run script twice.

An explicit manual action may open an ordinary VS Code terminal, but it must not silently rerun the script.

### Preserve current lifecycle semantics

- Setup stays best-effort: nonzero exit is visible as a failure, but session creation continues as it does today.
- Setup keeps its five-minute timeout, but the timeout must now terminate the process tree instead of only rejecting the wait.
- Run remains a toggle: invoking Run while active requests Stop rather than starting a second process.
- One Run process exists per Local/worktree context.
- Run status remains in memory and continues to drive the existing Run/Stop button and worktree status badge.

## Current Architecture

### Setup

`SetupScriptRunner` is already platform-neutral and receives an injected `RunTask` callback. It resolves:

| Platform | Script | Executable and arguments |
|---|---|---|
| Linux/macOS | `.kilo/setup-script`, then `.sh` | `sh <absolute-script-path>` |
| Windows | `.ps1`, then `.cmd`, then `.bat` | `powershell.exe ... -File <path>` or `cmd.exe /d /s /c <quoted-path>` |

The VS Code-specific adapter is `packages/kilo-vscode/src/agent-manager/task-runner.ts`.

### Run

`RunController` and `RunScriptManager` already separate discovery, lifecycle, and UI status from the execution adapter. `RunController` passes an explicit executable, argument array, cwd, environment, and completion callback to `startVscodeRunTask()`.

The VS Code-specific adapter is `packages/kilo-vscode/src/agent-manager/run/task.ts`.

### Embedded terminals

Agent Manager already has:

- xterm.js terminals in the right-side inspector;
- multiple side terminals per context;
- direct PTY WebSocket streaming;
- per-context tab selection and ordering;
- persistent mounting while switching terminal tabs, Agent Manager contexts, Diff, and PR views.

The extension-side path is currently:

```text
webview terminal.create
  -> TerminalRouter
  -> TerminalManager
  -> legacy client.pty.create()
  -> kilo serve PTY
  -> WebSocket
  -> xterm.js
```

It currently creates only default interactive shells. It does not expose command, args, or env.

### Existing backend capability

The canonical PTY service already accepts:

```ts
{
  command?: string
  args?: string[]
  cwd?: string
  title?: string
  env?: Record<string, string>
}
```

It also retains bounded output, publishes `pty.exited` with an exit code, and keeps exited PTY metadata until removal. The canonical SDK surface is `client.v2.pty` under `/api/pty`.

## Proposed Architecture

### One execution backend

Use the existing `kilo serve` PTY service as the only new script execution backend. Do not add another `child_process`, `node-pty`, VS Code pseudoterminal, or webview process runner.

The new flow is:

```text
SetupScriptRunner or RunController
  -> PTY-backed execution adapter
  -> ScriptTerminalManager
  -> client.v2.pty.create(command, args, cwd, env)
  -> canonical PTY WebSocket
  -> existing Agent Manager side terminal/xterm.js
```

The executable and argument array are resolved by trusted extension code using the existing platform-specific builders. The webview receives only terminal display and attachment metadata.

### Separate system terminals from user terminals

Add a provider-owned `ScriptTerminalManager` next to the current `TerminalManager`.

Do not send setup or Run processes through the existing webview-created `terminal.created` flow. That flow requires a pending webview `createId` and correctly closes unsolicited terminals. Setup can begin before the webview requests a terminal, so it needs a separate synchronization path.

Suggested record:

```ts
type ScriptTerminalKind = "setup" | "run"
type ScriptTerminalState = "starting" | "running" | "stopping" | "exited" | "failed"

interface ScriptTerminalRecord {
  terminalId: string
  ptyID: string
  worktreeId: string | null
  kind: ScriptTerminalKind
  title: string
  cwd: string
  wsUrl: string
  state: ScriptTerminalState
  exitCode?: number
  startedAt: number
  endedAt?: number
}
```

Registry rules:

- one active `Run` record per context;
- one `Setup` record per worktree setup attempt;
- a new Run replaces the previous exited Run record after removing its retained PTY;
- user-created `Terminal N` tabs remain independently managed by `TerminalRouter`;
- script records survive `TerminalRouter.dispose()` and webview reloads;
- extension/backend shutdown removes all remaining script PTYs.

### Completion and race handling

Subscribe to global `pty.exited` events through `KiloConnectionService` and map backend PTY IDs to script records.

Account for a fast process that exits before the extension registers the returned PTY:

1. Create the PTY.
2. Store the record and backend ID.
3. Immediately call canonical `pty.get()`.
4. If it is already exited, finish from the returned status and exit code.
5. Otherwise rely on `pty.exited`.

On connection restoration, reconcile every running script record with `pty.get()`. A missing PTY is an execution failure, not a successful exit.

### Webview synchronization

Add an extension-to-webview script-terminal snapshot/update protocol, for example:

```ts
type: "agentManager.scriptTerminals"
terminals: ScriptTerminalView[]
```

Send a full snapshot:

- when a script terminal is created;
- when status or exit code changes;
- after `agentManager.requestState`;
- after the webview reloads or reattaches.

The webview terminal state adds script terminals without requiring a pending `createId`. A script terminal is still rendered by the existing `TerminalTab` and side-terminal layer.

Do not send executable paths, args, arbitrary env, or script contents to the webview.

## Required PTY Hardening

These are prerequisites for claiming behavior comparable to VS Code Tasks.

### Do not mutate explicit command arguments

`packages/core/src/pty.ts` currently appends `-l` whenever the executable looks like a login shell. With `command: "sh"` and `args: [scriptPath]`, that produces `sh scriptPath -l`, making `-l` a script argument.

Only add login-shell arguments when the caller did not provide an explicit command. Explicit `command` plus `args` must reach the process unchanged.

### Terminate the process tree

PTY removal currently calls only the PTY process's `kill()`. That does not prove that child and grandchild processes are terminated.

Reuse or generalize `packages/core/src/shell.ts` `killTree()` semantics:

- Windows: `taskkill /pid <pid> /f /t`, hidden window;
- Linux/macOS: signal the process group, then escalate from `SIGTERM` to `SIGKILL`;
- retain the direct PTY kill as a fallback.

Run Stop, worktree deletion, setup timeout, tab close, extension shutdown, and backend shutdown must all use the same tree-termination path.

### Replay exited output

Canonical PTYs retain up to 2 MiB of output and exited metadata, but `Pty.attach()` currently rejects exited sessions. A quick setup can finish before the webview attaches, and a webview reload can occur after a Run exits.

Allow a read-only attachment to an exited retained PTY:

1. replay the requested bounded buffer;
2. send cursor/status metadata;
3. close normally with the exit code available through the state protocol;
4. reject writes after exit.

Keep legacy `/pty` behavior unchanged. Script terminals use canonical `/api/pty`.

### Keep shared-file changes isolated

The PTY hardening touches shared upstream-owned code. Keep the changes minimal, use `kilocode_change` annotations where required, and run the opencode annotation and Promise-facade guards.

## Security Model

### Workspace Trust

Before setup or Run script execution, require `vscode.workspace.isTrusted`. If the workspace is restricted, show the standard trust-management action and do not create a PTY.

VS Code blocks terminals and Tasks in Restricted Mode. Moving execution behind `kilo serve` must not bypass that boundary.

### Script path validation

Run scripts already require a regular file and reject symlinks that resolve outside the root `.kilo` directory. Extract and reuse this validation for setup scripts.

Both script systems must:

- accept only the existing fixed platform-specific filenames;
- require a regular file;
- reject directories, devices, and other special files;
- reject a symlink whose real target escapes the root `.kilo` directory;
- use an absolute script path and validated absolute cwd.

### Command construction

- Resolve executable and args in extension code.
- Pass args as an array to `pty.create()`.
- Never concatenate a POSIX/PowerShell command string.
- Keep the existing `cmd.exe` path quoting helper and add paths-with-spaces and quotes tests.
- Never send a script command by `sendText`, xterm paste, or WebSocket input.

### Environment

Use one environment builder for setup and Run:

- Linux/macOS: cached login-shell environment, preserving user PATH tools such as Homebrew, nvm, pyenv, and Cargo;
- Windows: extension-host process environment;
- overlay `WORKTREE_PATH` and `REPO_PATH`;
- retain PTY-enforced stripping of `KILO_SERVER_PASSWORD` and `KILO_SERVER_USERNAME`;
- do not serialize the environment into webview messages or persisted Agent Manager state.

This intentionally improves setup parity. Setup currently lacks the login-shell environment used by Run.

### Failure behavior

- A PTY create error does not trigger a second execution path.
- A missing exit code is not treated as success.
- A server disconnect marks the script indeterminate until canonical status reconciliation completes.
- If process-tree termination cannot be confirmed, keep the UI in an error/stopping state and log the failure.

## UX

### Run

When the user clicks Run or presses `Cmd/Ctrl+E`:

1. Keep current script discovery/configuration behavior.
2. Open the Agent Manager terminal inspector.
3. Create or replace the semantic `Run` side tab for the current context.
4. Activate and focus it so interactive scripts can accept input.
5. Keep the existing worktree card and toolbar status synchronized.

While running:

- the tab shows a spinner;
- Run changes to Stop as today;
- pressing Run/Stop requests process-tree termination;
- closing the running Run tab means Stop and close;
- hiding the inspector does not stop the process.

After exit:

- exit `0` shows success;
- nonzero exit shows failure and the exit code;
- output remains available until the tab is closed or a new Run replaces it.

### Setup

When setup begins:

1. Add the new worktree context to the UI as today.
2. Open its `Setup` side tab and show live output.
3. Keep the existing setup/session sequencing unchanged.
4. Continue session creation after success or failure, preserving current best-effort behavior.

While setup runs:

- the tab shows a spinner;
- the terminal can accept input if the script prompts;
- the tab cannot be destroyed accidentally; users may hide the inspector;
- the five-minute timeout stops the process tree and marks the tab failed.

After setup exits, the tab becomes closable and retains its output.

### Rendering before a session exists

Setup begins before the first session exists in a new worktree. Update Agent Manager's empty-context logic so a context with a side script terminal renders the detail/inspector host even without a session tab.

Do not place the current blocking setup overlay above the terminal. Keep progress visible in the sidebar/worktree state and in the Setup tab itself.

### Titles and ordering

- Keep `Setup` and `Run` as semantic labels; do not replace them with OSC shell titles.
- User-created terminals continue to use OSC title updates.
- System terminals participate in the existing side tab strip and can retain stable positions.
- The `+` button always creates a user terminal and never another Run or Setup process.

### Accessibility

- Announce starting, running, stopped, succeeded, and failed state changes.
- Include the exit code in accessible status text.
- Preserve existing keyboard tab navigation and terminal focus restoration.
- A hidden terminal inspector remains inert and `aria-hidden` while the PTY continues running.

## Cross-Platform Contract

Use the extension host's platform. In WSL, Remote SSH, and Dev Containers this means the remote Linux environment and POSIX script names, not native Windows script names.

| Environment | Script execution | Important checks |
|---|---|---|
| macOS | `sh <script>` through PTY | GUI-launch PATH, Homebrew/nvm, process-group stop |
| Linux | `sh <script>` through PTY | PATH, signals, child/grandchild stop |
| Windows | PowerShell first, then CMD/BAT through ConPTY | spaces/non-ASCII paths, no console flash, `taskkill /t` |
| WSL | Linux path and scripts in remote extension host | no Windows executable/path leakage, WebSocket forwarding |
| Remote SSH/Container | remote platform and filesystem | loopback WebSocket forwarding and reconnect |

The current embedded terminal transport builds a loopback WebSocket URL directly. Native Windows/Linux/macOS are unaffected, but Remote SSH, WSL, and Dev Containers require an explicit test. If VS Code does not forward the random backend port reliably, route it with the supported webview port mapping or `vscode.env.asExternalUri` and update CSP narrowly for the resolved origin. Do not add a second process runner as a remote fallback.

## Implementation Phases

### Phase 1: Backend safety foundation

- [ ] Prevent login-argument mutation for explicit PTY commands.
- [ ] Add read-only replay attachment for exited canonical PTYs.
- [ ] Add cross-platform PTY process-tree termination.
- [ ] Add core and canonical HTTP/WebSocket tests.
- [ ] Regenerate the SDK only if the public endpoint schema changes.

Likely files:

- `packages/core/src/pty.ts`
- `packages/core/src/shell.ts`
- `packages/core/src/pty/pty.ts`
- `packages/server/src/handlers/pty.ts`
- relevant `packages/core/test/pty/` and server PTY tests

### Phase 2: Script terminal runtime

- [ ] Add a vscode-free `ScriptTerminalManager`.
- [ ] Launch through `client.v2.pty.create()` with explicit command, args, cwd, and env.
- [ ] Build canonical WebSocket attachment URLs.
- [ ] Subscribe to `pty.exited` and reconcile fast exits.
- [ ] Implement stop, remove, timeout, worktree-delete, reload, and shutdown handling.
- [ ] Keep the runtime alive across webview and `TerminalRouter` recreation.

Likely files:

- new `packages/kilo-vscode/src/agent-manager/script-terminal-manager.ts`
- `packages/kilo-vscode/src/agent-manager/AgentManagerProvider.ts`
- `packages/kilo-vscode/src/agent-manager/terminal-routing.ts` or a small shared URL helper
- `packages/kilo-vscode/src/agent-manager/types.ts`

### Phase 3: Swap execution adapters

- [ ] Keep `SetupScriptRunner`, `RunController`, and `RunScriptManager`.
- [ ] Replace `executeVscodeTask` with a PTY-backed setup adapter.
- [ ] Replace `startVscodeRunTask` with a PTY-backed Run adapter.
- [ ] Reuse one environment builder for setup and Run.
- [ ] Add Workspace Trust gating.
- [ ] Reuse Run's regular-file and confined-symlink validation for setup.
- [ ] Make setup timeout terminate the PTY process tree.

Likely files:

- `packages/kilo-vscode/src/agent-manager/SetupScriptRunner.ts`
- `packages/kilo-vscode/src/agent-manager/SetupScriptService.ts`
- `packages/kilo-vscode/src/agent-manager/run/controller.ts`
- `packages/kilo-vscode/src/agent-manager/run/service.ts`
- `packages/kilo-vscode/src/agent-manager/task-runner.ts`
- `packages/kilo-vscode/src/agent-manager/run/task.ts`

After all callers migrate and checks pass, remove the obsolete VS Code Task adapters rather than leaving two automatic execution paths.

### Phase 4: Protocol and side-panel UI

- [ ] Add script-terminal snapshot/update messages.
- [ ] Hydrate script terminals independently of webview create IDs.
- [ ] Add `kind`, state, and exit metadata to side terminal state.
- [ ] Render semantic Setup/Run tabs with status indicators.
- [ ] Preserve script output across context switches and webview reloads.
- [ ] Render the terminal inspector when setup exists before a session.
- [ ] Route Run/Stop and tab-close actions to `ScriptTerminalManager`.
- [ ] Add i18n, accessibility coverage, and visual stories.

Likely files:

- `packages/kilo-vscode/webview-ui/src/types/messages/agent-manager.ts`
- `packages/kilo-vscode/webview-ui/src/types/messages/extension-messages.ts`
- `packages/kilo-vscode/webview-ui/src/types/messages/webview-messages.ts`
- `packages/kilo-vscode/webview-ui/agent-manager/terminal/state.ts`
- `packages/kilo-vscode/webview-ui/agent-manager/terminal/render.tsx`
- `packages/kilo-vscode/webview-ui/agent-manager/terminal/TerminalTab.tsx`
- `packages/kilo-vscode/webview-ui/agent-manager/terminal/SideTerminalPanel.tsx`
- `packages/kilo-vscode/webview-ui/agent-manager/AgentManagerApp.tsx`
- Agent Manager i18n, CSS, stories, and accessibility tests

### Phase 5: Remove bottom-panel dependency

- [ ] Confirm setup and Run no longer create VS Code Tasks.
- [ ] Confirm neither action executes `workbench.action.terminal.toggleTerminal` or reveals the Panel.
- [ ] Keep ordinary manual-shell destination behavior unchanged.
- [ ] Add a user-facing changeset and update Agent Manager script documentation.

## Automated Validation

### Extension unit tests

- [ ] Linux/macOS setup and Run use `sh` plus one absolute script-path argument.
- [ ] Windows PowerShell uses the existing fixed switches and `-File` argument.
- [ ] Windows CMD/BAT handles paths with spaces, quotes, and non-ASCII characters.
- [ ] Setup and Run receive correct cwd, `WORKTREE_PATH`, and `REPO_PATH`.
- [ ] Setup rejects directories, devices, and escaping symlinks.
- [ ] Restricted workspaces cannot execute setup or Run.
- [ ] A fast exit before registration is reconciled correctly.
- [ ] Stop during startup cannot leave an unmanaged process.
- [ ] Worktree deletion and provider disposal stop the process tree.
- [ ] Setup timeout stops the process tree and records failure.
- [ ] A PTY creation error does not invoke a fallback runner.

### Backend integration tests

- [ ] Explicit command args are unchanged, with no injected `-l`.
- [ ] stdout/stderr and interactive input work through the PTY WebSocket.
- [ ] Exit `0` and nonzero exit codes are retained and emitted.
- [ ] A client can replay output after process exit.
- [ ] Removing an exited PTY succeeds.
- [ ] Stopping a script removes a spawned child and grandchild.
- [ ] Windows ConPTY tests run in Windows CI instead of being skipped.

### Webview tests

- [ ] Unsolicited system-terminal snapshots are accepted without a pending `createId`.
- [ ] User terminal create-race protections remain unchanged.
- [ ] Setup appears before a session exists.
- [ ] Run is scoped independently to Local and each worktree.
- [ ] System terminals survive context switching and webview state rehydration.
- [ ] Starting a new Run replaces the previous exited Run terminal only.
- [ ] Closing a running Run routes through Stop.
- [ ] Setup/Run OSC title changes do not replace semantic labels.
- [ ] Status indicators and accessible announcements match runtime state.

### Repository checks

Run the smallest relevant checks while iterating, then before completion:

```text
packages/kilo-vscode: bun run typecheck
packages/kilo-vscode: bun run lint
packages/kilo-vscode: targeted unit tests, then bun run test:unit
packages/kilo-vscode: bun run knip
packages/kilo-vscode: bun run check-kilocode-change
repo root: bun run script/check-opencode-annotations.ts --worktree
repo root: bun run script/check-opencode-promise-facades.ts
packages/opencode: targeted PTY/server tests and bun run typecheck
```

Run source-link extraction if implementation or docs introduce/change URLs in guarded packages.

## Manual Validation Matrix

Use `vscode-self-test` for the local extension flow, then verify native platform behavior where CI cannot exercise the real UI.

### Every platform

- [ ] Keep the bottom VS Code panel closed.
- [ ] Create a worktree with a setup script that prints, waits, accepts input, and exits `0`.
- [ ] Repeat with setup exit `1`; output remains visible and session creation continues.
- [ ] Run a short script and verify success/failure status and retained output.
- [ ] Run a long-lived dev server, switch worktrees, return, and verify it is still attached.
- [ ] Stop the dev server and verify its child process is gone.
- [ ] Reload the Agent Manager webview during a Run and verify output/status recovery.
- [ ] Close and reopen Agent Manager while a Run is active and verify runtime rehydration.
- [ ] Delete a worktree with an active Run and verify process cleanup.
- [ ] Confirm ordinary terminal tabs and the manual-shell destination dropdown still work.

### Windows

- [ ] Test `.ps1`, `.cmd`, and `.bat` precedence.
- [ ] Test a repository path containing spaces and non-ASCII characters.
- [ ] Confirm no console window flashes.
- [ ] Confirm Stop removes child processes through `taskkill /t` semantics.

### Linux and macOS

- [ ] Test login-shell PATH tools not present in a minimal GUI environment.
- [ ] Confirm no extra `-l` reaches the script as `$1`.
- [ ] Confirm Stop terminates the process group and descendants.

### WSL and Remote SSH

- [ ] Confirm Linux script selection in WSL.
- [ ] Confirm terminal WebSocket attachment reaches the remote backend.
- [ ] Disconnect/reconnect and verify status reconciliation or a clear failure state.

## Acceptance Criteria

The work is complete when:

1. Setup and Run never reveal the bottom VS Code panel.
2. Both scripts run through a real PTY with explicit executable and argv on Windows, Linux, and macOS.
3. Run and setup output is live in named Agent Manager side tabs and remains available after exit.
4. Run status and Stop behavior remain synchronized with the existing Agent Manager controls.
5. Setup preserves its current best-effort sequencing and has a real terminating timeout.
6. Workspace Trust, script validation, credential stripping, and process-tree cleanup are enforced.
7. Webview reloads and context switches do not orphan active script processes.
8. Existing user-created side terminals, terminal tabs, and manual VS Code terminal selection do not regress.

## Out of Scope

- Running setup asynchronously with the first agent session.
- Persisting terminal output or live process records to `.kilo/agent-manager.json`.
- Recovering a process after the entire extension host or `kilo serve` process restarts.
- Per-worktree script overrides.
- Multiple simultaneous Run scripts for one context.
- Automatic Run retries or Run history.
- Replacing the ordinary user-terminal destination preference.
