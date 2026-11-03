# Agent Manager v1 -> v2 port: working plan

Read this first after a compaction. Companion files in .kilo/plans/:
- `agent-manager-v2-ledger.md`: per-file ledger (copied / adapted / rewritten / removed) and decisions log.
- `agent-manager-v2-conventions.md`: rules, seam API, API and event mapping tables that the subagents followed.
- v1 read-only extract: `/var/folders/6c/3j3r25ds6pd1dw3nlrfnvv280000gp/T/kilo/v1/packages/kilo-vscode` of v1 (`main`). Never edit. Also `git show main:<path>`.

Plans folder: `.kilo/plans/` in the worktree (kept up to date; temp copies are stale).

## Where things are

- Worktree: `/Users/marius/Documents/git/kilocode/.kilo/worktrees/stupendous-borogovia`
- Branch: `am-v2-seam` (the name `agent-manager-v2` is checked out by another busy session `carnelian-pram`; do not touch it).
- Base: `origin/v2` at `6c56b5d0ecb`. Not merged since. Merge `origin/v2` before the first push.
- Commits (local only, nothing pushed, no PR yet):
  - `c8cf64839a0` seam + copied independent modules (checkpoint)
  - `4a2bba7c1b7` orchestration and branch name plugins (checkpoint)
  - About 190 files uncommitted on top: terminals, diff/review, PR UI, orchestration host, provider host, webview app, integration fixes.
- Task prompt is the source of truth (scope, decisions, definition of done, ship rules). Plan doc from research: `/Users/marius/Documents/git/kilocode/.kilo/worktrees/capricious-sprout/.kilo/plans/agent-manager-v2-port.md` (the prompt wins).

## Architecture (done)

Host (extension, Node):
- `src/agent-manager/connection.ts`: one client per server start, one event stream with reconnect, `onEvent(listener, filter)`, `located()`, `view(ids)` -> `session.view` for presence, `server()` url+auth.
- `src/agent-manager/panel.ts`: panel host over shared `wire()` in `src/chat.ts` (view `agentManager`, bundle `dist/agent-manager.js`, ready queue, reveal keeps column).
- `src/shutdown.ts`: `deactivate` interrupts `session.active()` sessions before `server.stop()` (3 s cap).
- `AgentManagerProvider.ts` (1048 lines) split into `provider-messages.ts`, `provider-state.ts`, `provider-api.ts`, `provider-hosts.ts`, `provider-session.ts`, `provider-lifecycle.ts`, `provider-multi-version.ts`.
- Terminals: `terminal-manager.ts`, `terminal-routing.ts`, `ScriptTerminalManager.ts`, `script-terminal-runtime.ts`, `pty-cleanup.ts` (teardown = `client.debug.location.evict`), `pty-relay.ts` (host relays the PTY WebSocket with `ws`, because the server rejects `vscode-webview://` origins; webview uses `terminal/socket.ts`).
- Diff: `src/diff/SourceController.ts`, `src/diff/sources/*`, `src/diff/context.ts`, `worktree-diff-controller.ts`.
- Orchestration: `orchestration-bridge.ts`, `orchestration-domain.ts`, `orchestration-setup.ts`, `tool-start.ts`, `tool-project.ts` over RPC `kilocode.agent-manager`.
- Storage: state file `<root>/.kilo2/agent-manager.json` (`STATE_DIR` in `constants.ts` from `KiloConfigFiles.directories[0]`), one-time read-only import of `.kilo/agent-manager.json`, `version: 1`. Git exclude now includes `.kilo2/agent-manager.json`.
- Settings `kilo-code.v2.agentManager.{autoBranchNaming,branchPrefix,worktreePool,terminalButtonDestination,pushFixes}` + `kilo-code.v2.showShortcutHints`, all in `KILO_SETTING_KEYS`. `chat.ts` lets the AM view write `showTaskTimeline` and `agentManager.pushFixes`.
- `extension.ts`: provider, serializer, 34 commands incl. `openInNewWindow`, shutdown.
- Build guard in `script/build.ts`: fail when `dist/extension.js` contains `import.meta` (a dynamic `import()` in the provider caused activation failure; fixed by static import).

Server (Kilo plugins, rung 1, no shared upstream edits):
- `packages/schema/src/kilocode/{agent-manager,branch-name}.ts`, `packages/kilo-plugin/src/{agent-manager,branch-name}/*`, registered in `KiloPlugins` with `kilo_port(agent-manager:648a508ad347)`.
- `kilocode.agent-manager`: list/reply/reject/removeSnapshot, events start/requested/cancelled; tool hook guards patch/edit/write on `.kilo2/` and `.kilo/agent-manager.json`; permission evaluate hook.
- Tests: kilo-plugin (agent-manager-*, branch-name, snapshot), kilo-cli `agent-manager-rpc.test.ts`, `agent-manager-metadata.test.ts`.

Webview:
- `webview-ui/agent-manager/v2/panel-data.ts` (one stream, per-directory `createData` stores, retain/release), `v2/sessions.ts`, `v2/activity.ts`, `v2/vscode.ts` + JSX-free `v2/bridge.ts`.
- `webview-ui/src/v2/scope.ts` (`createV2Scope`, JSX-free), `client.tsx`, `shell.tsx` (`WebviewShell`, shared by sidebar and AM), `session-view.tsx` (extracted from chat.tsx; props `speech`, `onAppendReady`, `onPreviewEdit`, `replace`), `history.tsx` `SessionList` generalized (`sessions`, `store`, `rowActions`), `permission.tsx` preview button, `prompt.tsx` optional speech + append hook.
- App split: `AgentManagerApp.tsx` (2244 lines, under 3000 limit), `app-session.ts`, `app-directories.ts`, `app-messages.ts`, `app-keys.ts`, `app-tabs.ts`, `dialog-commands.ts`, `dialog-attachments.ts`, `HistoryView.tsx`.
- AM entry `webview-ui/agent-manager/index.tsx` imports `@kilocode/kilo-ui/styles` and `../src/styles/chat.css`.
- Restored missing kilo-ui components from v1 `packages/ui`: `kilo-ui-base/src/components/{radio-group,resize-handle,avatar,hover-card}.tsx` + kilo-ui re-export wrappers incl. `dropdown-menu`. `kilo-ui/src/pierre/limits.ts` split out.

## Check status (last run)

- `packages/kilo-vscode`: `bun typecheck` clean, `bun run lint` clean (lint now covers `webview-ui/agent-manager` and `webview-ui/diff-viewer`), `bun test` 3117 pass / 77 skip / 0 fail, `bun run build` ok.
- kilo-plugin, schema, kilo-cli: typecheck + tests passed (agent reports, verified the AM ones myself).
- Not yet run: root `bun run check`, duplication check (`script/check-kilocode-duplication.ts`), architecture check, `check-shared-patches`, `check-opencode-annotations`, `placement.ts --imports`, typecheck of kilo-ui/kilo-ui-base (no script; tsc only shows pre-existing asset-module errors).

## Self-test (in progress)

Harness helper: `source /tmp/am-st.sh` (defines `st`, `W=/tmp/am-st-ws`, `AM=<frame>`, `ev`, `reopen`, `shot`). Session selector `am-v2-st`, workspace `/tmp/am-st-ws` (git repo, branch `main`). Launch visible (`--headless false`) to take screenshots; `reopen` relaunches and finds the AM frame (opener's `frame.match` does not detect it; the local card id is `<projectId>:local`, same as v1).

Passed:
- Extension activates, panel opens, sidebar/project/local card/intro render with full styles (screenshot `/tmp/am-shot2.png`).

Current bug (investigating):
- AM model picker is empty ("No model results"); the sidebar picker in the same window shows 12 models. AM catalog sync (`app-session.ts` and `selectors.tsx` via chatStore) runs on `connected` but the store has no models. Server log not found in backend dir; output channels show nothing. Next: check AM relay requests reach host (panel `handle` returns false for non-`agentManager.` types so `wire()` should relay), check `connection.status()` of the panel store, check the store directory vs request location, compare with sidebar `V2Provider`.

Remaining flows (definition of done), DeepSeek V4.1 Flash `kilo/deepseek/deepseek-v4.1-flash`:
1. Local session prompt; create worktree + session + prompt; multi-version with 2 models.
2. Sections, tabs, pinned tabs, keybindings.
3. Terminal, setup script.
4. Diff + review comment; PR status + merge action on a `gh` test repo.
5. Second project, routing, clone project; continue in worktree; `agent_manager` tool call from a session.
6. Reload window restores state; close panel mid-turn interrupts; move panel to new window stays.
7. Screenshots + short GIF (pr-guidance; demo-start/stop/publish, public repo, privacy check).
Clean up: `st stop-vscode --cleanup true; st stop; rm -rf /tmp/am-st-ws`.

## Open gaps / follow-ups to decide

- App parity gaps reported: NewWorktreeDialog model mention removed, BYOK/data badges dropped in MultiModelSelector, `agentManager.promptSent` (auto branch naming) must be sent by the webview after the first prompt (host ready) - verify and wire.
- `addSessionToWorktree` with `sessionId` (worktree session created from the composer): verify provider handles it (posted to provider agent; confirm in code).
- Orchestration overview shows `retry` as `busy` (session.active has no retry); consider tracking `session.retry.scheduled`.
- Saved wildcard `agent_manager` approval not hardened (needs a generic seam exposing matched rule) - list in PR.
- Edit preview: producers are permission dock (edit/write `metadata.files`) and tool card `openDiff/openDiffs`.
- History cloud tab not ported (cloud sessions epic #15306).
- `AgentManagerApp.tsx` 2244 lines (limit 3000 OK; target was ~1200) - acceptable unless reviewers object.
- Test file `test/am-pr-status-bridge.test.ts` has a complexity > 20 function (tests not covered by the metric override; fine).
- Verify no unused copied files / exports (knip-style scan) and no TODO/v1 comments: `grep -rn "TODO\|v1\b\|as in main" packages/kilo-vscode/src/agent-manager packages/kilo-vscode/webview-ui/agent-manager`.

## Progress map (to do before PRs)

- `bun script/upstream/progress.ts --list agent-manager|branch-name|caffeination|presence|worktree|snapshot|vscode`.
- Add dispositions to `migration-tracking/progress/dispositions.json` (`by: am-v2-seam`): agent-manager 11 ported (see ledger), branch-name 2, permission 2, snapshot 3 (cleanup.ts, snapshot-repository-cleanup.test.ts, api POST /kilocode/snapshot/remove), vscode AM cells (most close by name), dropped for excluded epics (indexing, sandbox #15309, browser, telemetry, speech, documents, memory/feedback, attached presence).
- `git add` new files, run generator, then `git checkout HEAD -- $(bun script/upstream/progress.ts --outputs)`. Never commit generated files.

## Ship (after everything is green and self-tested)

- Merge `origin/v2` into the branch, recheck.
- Stack of PRs against `v2` (`gh pr create -R Kilo-Org/kilocode --base v2`, stacked ones target the previous branch), titles `feat(vscode): ...`, body per pr-guidance + `## Placement`, `## Progress map`, `## Proof` (v1 vs v2 screenshots), excluded epics with reasons, `Part of #15315`:
  1. seam, panel, build, contributions, worktrees and sessions
  2. multi-project
  3. terminals and scripts
  4. diff, review and PR
  5. orchestration tool and plugins
  6. extras (caffeination, branch name, intro, shortcuts)
  If a split cannot stand alone, merge PRs (one PR allowed). Splitting needs per-PR build + CI green.
- Short branch names (<= 3 words, hyphens). No AI attribution, no em dashes, do not merge. Check CI once, then at most every 7 min (schedule_wakeup).
- Final answer: PR URLs in order, parity checklist, test results, follow-ups for excluded epics.
- server log: /tmp/am-st-user/User/globalStorage/kilocode.kilo-code-v2/profile/data/kilo2/log/opencode-local.log
- FOLLOW-UP: tracked session missing on the server (state file from another profile/DB) shows raw "Session not found: ses_..." in the AM view and binds the composer to it. Check v1 handling (state-recovery / prune) and match.
- FOLLOW-UP: reused user-dir restore: AM panel restored but not visible in main window after relaunch; verify "Reload window" flow explicitly.

## Self-test log (2026-11-03)
- PASS local session prompt (Grep tool, answer 1.2.3).
- PASS quick worktree create (dirt-plough), edit in worktree only, stats +1 -1, session title on card and tab.
- PASS New Worktree dialog: compare 2 models -> 2 worktrees, grouped "2 versions", each right model and answer.
- FIXED: sessionsLoaded never set (dialog would not open); local tab lost after first prompt (v1 parentID null vs v2 undefined); intro covered transcript; duplicate sessions across stores; selectionActivated adapter passed projectId as worktreeId.
- Composer parity with sidebar: speech (provider mounted in AM, dialog has voice), auto-approve and expanded picker sync across views, keybindings + webviewActiveChanged pushed to panel, cycle agent commands target AM when active, dialog default model = agent model then server default.
- Harness note: keypresses do not reach VS Code keybindings from webviews; use run-command.
- Chat view title buttons follow v1 order: new session, history, Agent Manager, profile, settings.
- Sidebar button order verified against v1 for every Agent Manager sidebar group (header icons, project row, worktree/session rows, footer, tab bar, side panel strip, terminal destination); AM components are order-identical to v1. Chat view title order guarded by test/chat-view-title-order.test.ts.
- Verified all Agent Manager webview button groups against v1 source (sidebar header, project row, cards, footer, tab bar, inspector strip, session header, composer, dialogs, intro, PR and subagent panels): order matches v1. v1-only buttons that v2 lacks: transcript search in the session header, documents, browser, sandbox, indexing, marketplace.
