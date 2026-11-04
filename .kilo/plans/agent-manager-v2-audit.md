# Agent Manager v2 port audit

Date: 2026-11-03
Worktree: `stupendous-borogovia`, branch stack over `origin/v2`
Change set: 599 files, about 109k insertions (commits `c8cf64839a0` to `692689ed0c4`)

## Method

Eight read-only audits ran in parallel, one per area:

1. Host worktrees and state management
2. Sessions, provider seam, server plugins
3. Terminals, run scripts, setup scripts
4. Diff, review, edit preview
5. GitHub PR integration
6. Agent Manager webview shell, sidebar, tabs, dialogs
7. Shared v2 UI seam and composer
8. Manifest, commands, settings, i18n, packaging

Each audit compared the v2 tree with the v1 extract at
`/var/folders/6c/3j3r25ds6pd1dw3nlrfnvv280000gp/T/kilo/v1/packages/kilo-vscode`
and, for server-side code, with `main` (`packages/opencode/src/kilocode/*`).

Excluded on purpose and not reported: sandbox, browser, telemetry, v1 speech code,
documents, memory/feedback, attached presence, codebase indexing, cloud history tab,
marketplace, GitLab provider. Documents and browser have follow-up issues
[#15734](https://github.com/Kilo-Org/kilocode/issues/15734) and
[#15735](https://github.com/Kilo-Org/kilocode/issues/15735) under epic
[#15559](https://github.com/Kilo-Org/kilocode/issues/15559).

Severity is by user impact, not by effort. Findings found by more than one audit
are marked as corroborated.

## Summary

- 8 blockers
- 22 serious functional gaps
- 18 medium and low items
- 1 behavior default change
- Dead code and test drift listed separately

The port is structurally sound: worktree creation and state, git import and recovery,
sections and tab order, the host PR layer, diff sources and apply-to-local, terminal
routing, orchestration plugins, permissions, i18n and panel registration were verified
as correctly migrated. The gaps below are concentrated in three places: data the host
no longer pushes, behavior that moved from the host into a single webview store, and
v1 UI that was never wired into the v2 composition.

---

## Blockers

### B1. Project session catalog is gone (`agentManager.projectSessions`)

- Corroborated by the worktree, session, and shell audits.
- v1: `src/agent-manager/session-lifecycle.ts:17-39`, `project/init.ts:219-290`,
  `AgentManagerProvider.ts:1433`.
- v2: `session-lifecycle.ts:17-37` tracks only busy/removed sets,
  `provider-state.ts:145-175` never posts the message, `project/context.ts:222-261`
  (`setSessions`, `upsertSession`, `sessionsListedFresh`) has no callers.
- Webview still consumes it: `webview-ui/agent-manager/project/live.ts:60`,
  `ProjectList.tsx:121,138,155,310`, `AgentManagerApp.tsx:714-744`.
- Impact: no session rows or counts on background project cards, empty Local counts,
  empty session search and `@`-session mentions, empty cross-project history, and
  `orchestration-setup.ts:59,73` sees no live sessions, so `managed()` rejects
  live-but-unpersisted sessions with `unknown_session`.
- The type at `src/agent-manager/types.ts:216` still carries the v1
  `createdAt/updatedAt` shape, so a naive restore would also be wrong.
- Fix: restore a host session snapshot per project root and worktree directory, post it
  from `pushState` and on session create/delete, using the v2 `SessionInfo` shape plus
  `worktreeId`.

### B2. `agent_manager` tool drops model and variant for worktree sessions

- Corroborated by the worktree and session audits.
- v1: `tool-start.ts:126-141` passed `model`, `variant`, `agent` and
  `snapshotInitialization` to the prompt/creation path.
- v2: `tool-start.ts:121-124` sends text only, and
  `AgentManagerProvider.ts:634` calls
  `createSessionInWorktree(..., undefined, agent, boot)`.
- The plugin resolves the models (`packages/kilo-plugin/src/agent-manager/tool.ts:238-246`)
  and the RPC carries them (`packages/schema/src/kilocode/agent-manager.ts:215-221`),
  and `provider-session.ts:23` accepts a model with a variant, so only the worktree
  branch loses them. Local mode (`tool-start.ts:160-171`) and multi-version
  (`provider-multi-version.ts:200`) apply the model.
- Impact: every tool-started worktree and versioned comparison set runs the default
  model while the tool text prints the resolved models, wasting cost and invalidating
  A/B comparisons.
- `test/agent-manager-tool-start.test.ts:424-432` currently pins the loss by asserting
  `undefined` and a text-only prompt.
- Fix: thread `task.model`/`task.variant` through `ToolDeps.createSessionInWorktree`
  and `sessionCreateBody`.

### B3. Composer drafts leak across tabs

- v1: `webview-ui/src/components/chat/PromptInput.tsx:625-660` saved and restored
  text, attachments, mentions and scroll per `draftKey`.
- v2: `webview-ui/src/v2/prompt.tsx:38` has a single component-local `text` signal,
  and `AgentManagerApp.tsx:1969` keys `SessionView` on the chat store, not the session.
- `draftAgent`/`draftModel` (`src/v2/selectors.tsx:21-22`) also carry over between
  new-tab drafts.
- Impact: text typed in one worktree tab stays in the composer when switching tabs and
  can be sent to the wrong session. The sidebar has the same behavior when switching
  sessions.
- Fix: key drafts by session id, or remount `PromptInput` with a session key, and save
  and restore per session as v1 did.

### B4. Review comment sends are duplicated or dropped

- Duplication: `AgentManagerApp.tsx:2074` (`onSendClick`) and `:2178-2181`
  (`onSendAll`) call `appendToPrompt`, while `diff-viewer/review-controller.ts:181`
  and `:270-276` already dispatch `sendReviewComments`, which the app handles at
  `:1807`. A single send produces two prompts, one with the comment and one with all
  pending comments. `formatReviewCommentsMarkdown([])` returns `"## Review Comments"`,
  so even the empty follow-up is sent. `sendAllToGithub` (`review-controller.ts:298`)
  also dumps comments into chat before publishing to GitHub.
- Terminal drop: v1 posted `appendReviewCommentsToTerminal`
  (`diff-viewer/review-annotations.ts:186-190`), consumed by
  `terminal/TerminalTab.tsx:516-524`. v2 dispatches a window event
  (`review-annotations.ts:173-175`) and `AgentManagerApp.tsx:1804-1808` returns early
  when `targetTerminalId` is set. No v2 terminal listens. `pr/pr-actions.ts:57-60`
  still marks the batch as sent.
- Impact: double prompts in the composer, and a lost "Fix with Kilo" batch whenever a
  terminal tab is active. Affects inline comment send, send-all, PR checks, PR summary,
  PR action batches and remote comment replies.
- Fix: make `onSendClick`/`onSendAll` notification-only, and add a terminal listener
  that pastes `formatReviewCommentsMarkdown(detail.comments)` when
  `targetTerminalId` matches.

### B5. Auto-approve covers only the selected directory store

- v1: the host replied to every permission event while the toggle was on
  (`src/commands/toggle-auto-approve.ts`).
- v2: `src/v2/auto-approve.tsx:31-46` approves only
  `v2.data.session.permission.sessions()` of one directory store, and the controller
  is created only in `src/v2/session-view.tsx:137` for the selected session's scope.
- Impact: with the shield on (a global, persisted state), sessions in other worktrees,
  or in the workspace while the panel is the active surface, stay blocked. Background
  agents hang.
- Fix: mount one controller per retained store, or move the sweep back to the host.

### B6. PR polling never learns the active worktree

- v1: `AgentManagerProvider.ts:701` set the active worktree on `loadMessages`.
- v2: `PRStatusPoller.setActiveWorktreeId` (`:225`) has no caller in `src`. The v2
  equivalent signal is `agentManager.visibleSession`
  (`provider-messages.ts:197`), which only calls `trackVisibleSession`.
- Impact: with no active worktree, every 15 s tick finds no target and returns, so PR
  data refreshes only on the 120 s full sync, and switching worktrees does not fetch.
  Badges, checks and review state go stale 8x longer than v1.
- Fix: in `trackVisibleSession` or the visible-session handler, set the poller's active
  worktree from the session's persisted worktree id.

### B7. Intro dismissal breaks the Agent Manager empty state

- v1: `intro/AgentManagerIntro.tsx:83-98` rendered the shared welcome, shortcut hints
  and a reopen button after dismissal.
- v2: `AgentManagerIntro.tsx:62-77` builds `fallback`, but `AgentManagerApp.tsx:1969`
  and `:1982` use only `intro.render`. `src/v2/messages.tsx:100-105` replaces the
  welcome with `empty`.
- Impact: after dismissing the intro, recent sessions, the history shortcut and the
  shortcut hints never appear. `intro.fallback` and `hints.list` are dead.
- Fix: pass a dismissed empty state that renders `Welcome` plus hints plus reopen,
  mounted inside a `V2Scope` because `Welcome` calls `useV2`.

### B8. Agent Manager settings are unreachable

- Corroborated by the shell and manifest audits.
- v1: an Agent Manager settings tab (`webview-ui/src/components/settings/Settings.tsx:161-260`)
  with branch naming, branch prefix, worktree pool, project picker, default base branch,
  setup script, plus push fixes and shortcut hints elsewhere.
- v2: `SETTINGS_TABS_V2` has no `agentManager` entry
  (`webview-ui/src/components/settings/tabs.ts:29-90`), `initialTab` falls back to
  Models, `src/chat.ts:350` hardcodes the settings flag to false, and
  `SettingsNavigation` drops `projectId` (`src/settings-navigation.ts:6-23`,
  `src/protocol.ts:56-62`).
- The project settings gear posts `openSettingsPanel`; routing was fixed in
  `src/agent-manager/panel.ts:76-79`, but the panel opens on Models.
- `agentManager.autoBranchNaming`, `branchPrefix`, `worktreePool` and
  `showShortcutHints` have no UI at all. `agentManager.pushFixes` is reachable only
  from the PR panel toggle.
- The host handlers `agentManager.configureSetupScript` and
  `agentManager.setDefaultBaseBranch` exist but no webview sends them, so
  `ProjectBranchDialog.tsx` is orphaned.
- Fix: add the project-scoped Agent Manager tab and the four host messages, and carry
  `projectId` through settings navigation.

---

## Serious functional gaps

### Session and provider

1. `continueInWorktree` is unreachable. The handler exists
   (`provider-messages.ts:174-180`), but the message has no `agentManager.` prefix,
   `panel.ts:83` rejects it before dispatch, and no v2 webview sends it. The
   `continue-in-worktree.ts` path and its progress feedback are dead.
2. Fork and promotion handoffs start a model turn. `fork-handoff.ts:27` and
   `promotion-handoff.ts:21` call `session.synthetic` without `resume: false`. v1 used
   `noReply: true`. An idle drain promotes the steer and runs a step, so forking or
   promoting produces an unsolicited answer and charge.
3. Fork session and fork message are missing from the chat. `handleForkSession` is
   wired only to the tab context menu (`AgentManagerApp.tsx:1311`). v1 exposed it in
   the chat header and on each message.
4. Worktree activity no longer follows connection state. `worktree-activity.ts:396-430`
   returns `pause`/`clear`, but `AgentManagerProvider.ts:303-310` never subscribes to
   `connection.onState`. Permission and form badges stay stale after a backend restart.

### Composer and session view

5. Read-only sessions keep a live composer. `readOnly()` is computed at
   `AgentManagerApp.tsx:837` and shows the banner, but `SessionView` at `:1973` never
   receives `readOnly`, unlike `SubagentPanel.tsx:127`. Prompts can be sent into a
   session the UI calls read-only, and for unmanaged sessions they go through the
   active project root store.
6. Unmanaged sessions are rendered from the root store.
   `AgentManagerApp.tsx:1827-1839` re-derives the directory with
   `directories.directoryOf`, which returns the active project root for sessions the
   host has not tagged with a worktree. Events route by
   `event.location.directory`, so those transcripts stop updating and prompts carry the
   wrong directory header.
7. The panel never requests display settings. The sidebar does it in
   `src/v2/chat.tsx:24-30`; the AM never calls `useDisplaySettings`, and
   `SessionView` does not either. Tool blocks always use `DISPLAY_DEFAULTS` and do not
   follow config changes.
8. `focusPrompt` ignores its guards (`src/v2/prompt.tsx:85-87`). v1 honored
   `force`, `restore`, `deferFocusToQuestion` and refused to focus when a dialog, popup
   or other text control owned focus. A session view that mounts while the New Worktree
   dialog is open can pull focus out of the dialog.
9. Cycle agent while the New Worktree dialog is open changes the hidden session's
   agent. `extension.ts:126-129` sends a `command` message, routed only to
   `SessionView` at `src/v2/session-view.tsx:140-144`. The dialog registers its own
   handler (`NewWorktreeDialog.tsx:226-230`) that is never reached.
10. The shared composer has no attachments, mentions or slash commands
    (v1 `PromptInput.tsx:294,300,494`). `src/v2/prompt.tsx` has text, speech, enhance,
    selectors and auto-approve only. The AM attachment and mention helpers are used
    only by the New Worktree dialog. Queued prompts can be viewed but not edited or
    cancelled. This is a v1-to-v2 shared-composer loss that affects both surfaces.
11. Tool-card file links omit the required `sessionId`
    (`AgentManagerApp.tsx:1084`; type at `types.ts:997-1002`). The host resolves the
    path against the project root, so worktree-only files fail to open and same-name
    files open from the base checkout. The diff panel path passes its context
    correctly.
12. Worktree `@` mentions are computed but never consumed.
    `AgentManagerApp.tsx:721` builds `references` and never passes it to
    `SessionView`/`PromptInput`. Worktree drag-to-prompt is also missing, although
    `tab-drag.ts` still builds the reference.
13. `/goal` composition in the New Worktree dialog is dead.
    `NewWorktreeDialog.tsx:493` calls `shouldComposeGoal(false, ...)`, `goalMode` and
    `GoalHeader` are gone, so a bare `/goal` is submitted as literal text. Unit tests
    still exercise the helpers directly.
14. "Update from base" no longer sends the visible session or its model/agent
    (`update-from-base.ts:12-27`). The host picks the busy session or the first
    session and runs on the default model, so the action can target a session the user
    is not reading.
15. PR conflict "Fix" drops `sessionId`. `PRPanelHost.tsx:97` no longer forwards it to
    `PRMerge.tsx:135`. Host support is intact, so the base update can run in another
    session of the worktree.

### History and navigation

16. History renders nothing until the root store resolves.
    `AgentManagerApp.tsx:1902` requires `historyStore()`, but the request sets
    `history=true` and hides the detail stack, so a slow or missing project root leaves
    a blank panel.
17. History lost keyboard tab navigation. v1 `HistoryView.tsx:88-116` moved the
    Local/Worktree tabs with arrows, Home and End; v2 has no key handler.

### Terminals

18. Run and setup PTY relay sockets survive reload and panel close.
    `pty-relay.ts:97` disposes only globally; `provider-state.ts:53` and
    `AgentManagerProvider.ts:412` dispose only the terminal router. Every reopen adds
    another host socket that still receives frames and posts them to the current
    webview.
19. Initial PTY size is applied after spawn. `terminal-manager.ts:165` creates the PTY
    without a size because `Pty.CreateInput` has no size field
    (`packages/schema/src/pty.ts:43`), then `:191-194` resizes. The first prompt bytes
    are captured at 80 columns and replayed. v1 passed `size: initial` to create.
20. Session terminal context is dead. `requestTerminalContext` and
    `terminalContextError` exist in types only; `SessionTerminalManager.syncOnSessionSwitch`
    and `prepareContext` have no callers. The v1 behavior that revealed the existing
    per-session integrated terminal on session change is gone.

### Settings, manifest and packaging

21. `kilo-code.v2.diff.renderMarkdown` is not declared in `contributes.configuration`,
    but `provider-messages.ts:374-382` writes it. VS Code rejects the update, and the
    rejection is unhandled, so the toggle is memory-only.
22. Manifest gaps:
    - `files.watcherExclude` for `**/.kilo/worktrees/**` and
      `**/.kilocode/worktrees/**` was dropped, so VS Code watches every worktree.
    - The `-workbench.actions.view.problems` unbind for Ctrl/Cmd+Shift+M is missing,
      so the Agent Manager binding collides with the Problems view.
    - The `kilo-worktree-setup` `taskDefinitions` contribution is missing while
      `task-runner.ts:17` still creates that task type.
    - `kilo-code.v2.showShortcutHints` has no settings row and is absent from
      `KiloSettingKey`, so users can only edit settings.json.
    - No `.vscodeignore`/`files` and no packaging step that places `bin/kilo2`, so
      packaged content is undefined.

---

## Medium and low items

1. `kilo-code.v2.showTaskTimeline` default changed from `true` (v1) to `false`
   (`package.json:122-126`). Users who never set it lose the task timeline in the
   sidebar and the panel.
2. The sidebar has no consumer for edit-permission previews
   (`src/v2/permission.tsx:94-99` needs `onPreview`; `src/v2/chat.tsx:107-118` does not
   pass it). v1 rendered the diff inline.
3. `.kilo2/agent-manager.json` has no migration marker and `apply` ignores `version`
   (`WorktreeStateManager.ts:755-800`). A corrupt-file backup re-imports the stale v1
   file instead of using it only for recovery.
4. `STATE_DIRECTORIES` lost `.kilocode` (`packages/kilo-plugin/src/agent-manager/protection.ts:4`),
   so the legacy state file is no longer protected from edits, although
   `WorktreeManager.ts:1085` still lists it.
5. Every open tab is marked viewed. `syncView` passes `visibleSession` plus all
   `openSessions` to `connection.view` (`AgentManagerProvider.ts:512-520`). v1 disabled
   viewed registration for the panel (`vscode-host.ts:141`). Unread indicators clear
   for conversations the user never saw.
6. Branch naming lost the system prompt, temperature, retries and small-model flag
   (`packages/kilo-plugin/src/branch-name/generate.ts:41`). Instructions are
   concatenated with user data.
7. Tool-triggered multi-version progress omits `projectId`
   (`tool-start.ts:275-307`), so busy and done states can land on the active project
   instead of the owning one.
8. Relay close codes render a spurious `[connection error]` for application closes.
   `terminal/socket.ts:84` calls `onerror` for every code except 1000 and 1005, while
   the server closes exited PTYs with 4404.
9. Terminal activity has no producer. The webview parses OSC 777
   (`terminal/activity.ts:11`), but v2 removed `KILO_TERMINAL_ACTIVITY` from the PTY
   env (`terminal-manager.ts:22`), so tab activity stays idle.
10. Closing a relay socket while its ticket is minted never notifies the webview
    (`pty-relay.ts:111-119`), leaving a `CLOSING` socket with a live subscription.
11. `PtyRelay.closeTerminal` (`pty-relay.ts:87-95`) is unused, and its token loop
    cancels every pending open rather than the target.
12. Model attribution captures the model before a gated switch settles
    (`src/v2/session-view.tsx:157-162`), so auto branch naming can use the previous
    model.
13. The AM dock reserves an empty 36px action row because `SessionView` receives
    `hasActions` without a `row` prop (`src/v2/session-view.tsx:219`).
14. A stale `promptAppend` closure survives `SessionView` unmount
    (`AgentManagerApp.tsx:1042-1046`), so review sends can target the previous session
    after a project switch.
15. `saveImage` from a worktree transcript defaults to the project root because the
    panel is wired with the workspace directory (`panel.ts`, `chat.ts:229-231`).
16. Event routing drops an event when no store key equals
    `event.location.directory` (`agent-manager/v2/panel-data.ts:25-30`). Symlinked or
    case-different paths stop live updates silently.
17. Per-turn diff source is dead. `src/diff/sources/turn.ts` exists, but no v2 caller
    produces a turn id and the protocol has no `openChanges`/`turnId` message.
18. `@model` mention was removed from the New Worktree dialog.
    `WORKTREE_MENTION_MODEL_TRIGGER` is unused and `worktree-mention.ts` has no model
    entry, while the file header still claims one.
19. Four AM i18n keys are unused (`history.title`, `history.back`, `sidebar.resize`,
    `review.resize`). `HistoryView.tsx:65,70` uses shared keys instead.
20. PR timeline and summary strings are untranslated English in all 20 locales, and
    four AM labels are hardcoded. Both are inherited from v1.
21. The chat-focus effect lost the pending-question dependency
    (`AgentManagerApp.tsx:424-430`), so a question arriving for the open session does
    not trigger focus recovery.
22. `agentManager` write allowlist carries `showTaskTimeline`, which the AM never
    posts, and omits the settings the ported tab would need.

---

## Dead code to remove or wire

- `src/agent-manager/tool-project.ts` is imported only by tests; production inlines the
  same routing at `AgentManagerProvider.ts:593-603`.
- `discardWorktree` has no production caller; cleanup is inline in
  `provider-lifecycle.ts:166-170` and `provider-multi-version.ts:219-221`.
- `AgentManagerProvider` methods `focusPanel`, `waitForReady`, `revealSession`,
  `getWorktreeDirectories` and `createFromSidebar` have no callers outside tests.
- Message types with no sender or handler: `requestTerminalContext`, `clearSession`,
  `previewImage`, `openFile` (AM variant), `loadMessages`, `copyFilePath`.
- Handlers with no sender: `setSessionsCollapsed`, `selectProject`,
  `configureSetupScript`, `setDefaultBaseBranch`.
- Seam helpers with no consumer: `panel-data.ts:81` `directories()`,
  `sessions.ts:62,87` `isSubmitting`/`interrupt`, `intro.fallback`,
  `AgentManagerApp.tsx:410-418` `resolveTerminal`, `hasQuestionOption` import.
- Model-picker global state is plumbed end to end but the shared selector keeps a local
  `open` signal and no component reads it.
- `PtyRelay.closeTerminal`.

---

## Test drift

- `test/agent-manager-terminal-layout.test.ts` and
  `test/agent-manager-terminal-destination.test.ts` fail on source-text assertions.
  The behavior they describe is equivalent to v1: the layout test is stale after the
  `!props.pending` gate, and the destination test still expects the old v1 setting
  namespace. Update the assertions, not the code.
- `test/agent-manager-tool-start.test.ts:405-431` asserts the model and variant are
  absent for worktree sessions. It should assert they are applied.
- v1 PR render, review-render, comments-render, review-editor and comment-context
  fixture tests were not ported, so PR layout regressions have no coverage.

---

## Verified as correctly migrated

- Worktree creation, start-point resolution, "already checked out" handling, pool
  claim, and the `.kilo2` git exclude entry.
- State schema, sections, tab order, pinned tabs, closed sessions, worktree order,
  active target, and corrupt-file backup.
- Worktree reconcile, recovery, health, doctor, diagnostics, file path, state recovery,
  orphans, git import and transfer, stats poller, quarantine, semaphore.
- Sections, tab layout, delete worktree, env copy, multi-version, creation plan and
  timing.
- Project registry, contexts, hydrate, clone, onboarding, pollers, scope, validation,
  avatars, diff branches.
- Base branch, base update (apart from the session selection), prune subagents, branch
  naming RPC.
- `agent_manager` plugin tool schema, validation, events, reply/reject, model matching,
  timeout, permission hardening, registration.
- Session seams: unknown-project drop, state gating, panel restore and serializer,
  dispose abort, visibility gating, composer state broadcast, focus context, cycle and
  jump commands, prompt-sent branch naming trigger, cost tracking, shutdown interrupt.
- Terminal routing, `terminal.created`/`restarted` contracts, relay open/send/close,
  replay, 4009 overflow code, script terminals, run scripts, setup scripts, integrated
  terminals, terminal font and destination settings.
- Diff source lifecycle, worktree/staged/unstaged/local sources, cache, reverter,
  large/binary handling, session and turn source semantics, routing and scope, revert,
  apply-to-local, review model, annotation building, diff style persistence.
- Host PR layer, protocol, project scoping, poller behavior, merge/branch/conflict
  flows, security checks, PR UI parity, push-fixes setting.
- Webview sidebar tree, sections, worktrees, tabs, drag and drop, persistence,
  navigation and keys, dialogs, CSS.
- Manifest commands and keybindings (except the unbind above), config keys, panel view
  type and serializer, activation event, menu order.
- i18n: 513 keys, 21 locales, identical placeholder sets, bundles contain every locale.

---

## Suggested fix order

1. Data the host must push again: `projectSessions`, tool model and variant, active
   worktree for PR polling, `resume: false` handoffs.
2. Composer correctness: per-session drafts, `readOnly`, `sessionId` in `openFile`,
   remove the duplicate review append, add the terminal review consumer.
3. Shell and session behavior: intro fallback inside `V2Scope`, update-from-base and
   PR conflict session forwarding, fork action, worktree mentions and drag, `/goal`,
   focus guards, cycle routing, display settings, unmanaged session store.
4. Terminals and settings: relay socket lifetime, PTY initial size, `renderMarkdown`
   key, watcher exclude, Problems unbind, shortcut hints row, Agent Manager settings
   tab with `projectId` navigation, timeline default.
5. Dead code removal and test updates.
