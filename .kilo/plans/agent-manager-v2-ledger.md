# Agent Manager v2 port - working ledger

Worktree: /Users/marius/Documents/git/kilocode/.kilo/worktrees/stupendous-borogovia
Branch: am-v2-seam (agent-manager-v2 is checked out by another busy session, carnelian-pram)
v1 extract: /var/folders/6c/3j3r25ds6pd1dw3nlrfnvv280000gp/T/kilo/v1/packages/kilo-vscode

## Limits (checked on v1 source)
- oxlint kilo-vscode: max-lines 3000/file, complexity 20/function. No new per-file caps.
- file-size-ratchet.test.ts caps listed files only (no AM files).
- jscpd duplication over packages/kilo-vscode/src and webview-ui (tests excluded).
- v1 violations (complexity): AgentManagerProvider.ts:622 (48), WorktreeManager.ts:398 (27),
  WorktreeStateManager.ts:778 (21), kilo-provider-utils.ts:205 (21) :329 (24) :670 (23),
  AgentManagerApp.tsx:223 (37) :1151 (45) :1281 (27) :1373 (50).
- Large files to split: AgentManagerProvider.ts 1899, AgentManagerApp.tsx 2563, WorktreeManager.ts 1637,
  types.ts 1395, NewWorktreeDialog.tsx 1378, terminal/state.ts 1048, PRStatusPoller.ts 981.

## Decisions
- globalState not shared: v1 id kilocode.kilo-code, v2 id kilocode.kilo-code-v2. Keys keep v1 names.
- AM protocol types: src/agent-manager/types.ts, imported by host and webview.
- Fan-out: one connection per panel, events routed by location.directory, broadcast when no location
  or session.moved.

## Ledger (copied | adapted | rewritten | stubbed(dep) | removed(epic))
### Wave 1 host (agent ses_e61ca2eb)
- copied unchanged: 87 files (AM host independent part, util/process, git-executable, serialize, shared/branch-slug, pr-comment-*, pr-patch, review-comments, diff/shared/*, diff/types, path-utils, pr/pr-types)
- adapted: WorktreeManager (complexity split), WorktreeStateManager (split), constants (-PLATFORM), local-diff-cache+project/route (zeroID), project/session-view, project/state-gate (-browser), prune-subagents (PruneSessionSource), worktree-create (-telemetry), worktree-importer, types.ts (-excluded), host.ts (-SessionProvider etc), util/spotlight
- new: shared/zero-id.ts, agent-manager/errors.ts
- stubbed: project/wiring.ts needs project/settings (boundary, mine)
- tests: 47 files, 1132 pass, 1 fail local-diff timer race (investigate)
### Wave UI-A (agent ses_e61c2331)
- copied 77 unchanged, 39 import-only, 10 adapted (css -documents, side-panel-layout/state -browser/-documents, state-handlers -browser, progress -clearFailedDelete, hydration inline needsLocalDraft, session-filter time.created, navigate, tab-drag, TabBar -telemetry, TerminalTab)
- left out (boundary, mine): initial-message, ProjectSidebarBody, pr/PRMerge (update-from-base), pr/review (edit-preview), ProjectList, apply-to-local, project/local-tabs, pr/PRComments, PRConversation, PRPanelHost
- contract: webview-ui/src/types/messages/agent-manager.ts (aliases ExtensionMessage/WebviewMessage, check usage)
- issue: diff/sources/types.ts pulls Node host modules into webview program
- tests: 19 files, 198 pass
- adapted: local-diff-cache.ts schedule setImmediate->setTimeout(0) (bun test runs immediates between due timers)
- diff/types.ts: PanelContext moved out (saved in T/kilo/diff-panel-context.ts) -> restore as src/diff/context.ts with diff subsystem (PR4)
### Server plugins (agent ses_e61bc822) -> PR5
- schema/kilocode/branch-name.ts: rpc kilocode.branch-name generate({sessionID,prompt,providerID?,modelID?}) -> {branch|null}
- schema/kilocode/agent-manager.ts: rpc kilocode.agent-manager list({}) reply({requestID,result}) reject({requestID,error:{code,message}});
  events rpc.kilocode.agent-manager.{start,requested,cancelled}; rpc.events.on(name, handler, {signal})
- kilo-plugin/src/agent-manager/*: tools, service (60s), guard (tool execute.before), permission (evaluate hook)
- metadata reaches projected user message (kilo-cli/test/agent-manager-metadata.test.ts)
- gaps: no sandbox token; tool result has no title
- dispositions to add: see agent report (agent-manager 11 ported, branch-name 2, permission 2)
- lockfile: friendly-words pulls ava/express (v1 same), accepted
### Phase A agents (launched 22:3x)
- terminals ses_e61a50d6, diff ses_e61a4d3d, PR UI ses_e61a4a9a, orchestration ses_e61a4738, provider ses_e61a3f6b, webview app ses_e61a3a63
- chat.ts: CSP connect-src adds ws://127.0.0.1:* for agentManager view
- conventions: T/kilo/am-conventions.md
### Diff agent done (ses_e61a4d3d) -> PR4
- 15 host files + 11 AM webview + ~30 diff-viewer files; tests 231 pass
- CHECK: edit-preview (edit-preview.ts, EditPreviewPanel) has no v2 producer (permission request has no filediff) -> dead? decide
- CHECK: review-settings not ported; verify AM state persists reviewMarkdownRender/diffStyle
- review comments -> window event agentManager.appendReviewComments (composer + terminal must consume)
### PR UI done (ses_e61a4a9a); terminals done + relay follow-up running
### Orchestration done (ses_e61a4738) -> PR5; 64 tests
- gap: overview 'retry' reported as busy (session.active has no retry) -> consider tracking session.retry.scheduled in provider busy set
- provider must forward rpc.kilocode.agent-manager.start via handleToolEvent(event, event.location?.directory, ...)
### Edit preview producer: v2 edit/write permission metadata {files:[FileDiffInfo]} -> add AM preview action to v2 PermissionDock (my task)
### Terminals relay done: pty-relay.ts + terminal/socket.ts; CSP reverted; wsUrl/attach removed
- worktree teardown -> client.debug.location.evict (stable debug endpoint; disposes location services incl PTYs) -> name in PR
- removeSnapshot -> new RPC method kilocode.agent-manager.removeSnapshot (server agent follow-up running); v2 snapshot repos <data>/snapshot/<project>/<hash(worktree)>
- Host.openPanel / unregisterProjectRoutes removed (no shims)
### removeSnapshot RPC done (plugin snapshot.ts, 31 tests); dispositions snapshot: cleanup.ts, snapshot-repository-cleanup.test.ts, api POST /kilocode/snapshot/remove
### App agent done (ses_e61a3a63). My integration fixes:
- restored kilo-ui radio-group/resize-handle/dropdown-menu (v1 ui base + kilo-ui re-exports); copied FullScreenDiffView/DiffScopeControls/BaseBranchPicker
- DragHandle -> ResizeHandle; HistoryView rebuilt on generalized v2 SessionList (rename/delete/search, local+worktree tabs)
- WebviewShell shared by sidebar and AM entry; AM entry imports chat.css
- SessionView: speech=false, onAppendReady, onPreviewEdit; toolActions openDiff/openDiffs -> edit preview; dropped edit-preview window event
- bridge.ts JSX-free types; review-annotations local i18n type; kilo-ui pierre/limits.ts split
- ShortcutHints: removed unused manager() + utils/shortcut-hint.ts; added kilo-code.v2.showShortcutHints setting
- App parity notes from agent: model mention removed, BYOK/data badges dropped, HistoryView cloud tab (cloud = other epic #15306)
