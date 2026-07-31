# Agent Manager Multi-Project — Shipping Gaps

Status as of 2026-07-27. The multi-project sidebar renders and works end to end in the
self-test harness (both projects list worktrees/sessions/sections, section creation
persists, worktree delete works, project switching restores selection, live session
upsert verified). Full unit suite green (3444 pass / 0 fail), typecheck, lint, knip,
arch caps all pass. Everything is uncommitted in the worktree.

This document lists what is still missing, ranked by whether it should block shipping.

Two audiences matter for the blocking decision:

- **All users**: the branch changes shared surfaces (legacy sidebar refactor, config
  write path, indexing consent, pollers). Regressions here ship to everyone, flag off
  or not.
- **Experimental users**: multi-project mode is gated behind
  `kilo-code.new.experimental.multiProject`, default off. Rough edges here are
  acceptable if they cannot corrupt data.

---

## 1. Blocks shipping (all-user surfaces)

### 1.0 Empty-state skeleton regression (fixed, must stay fixed)

`initializeState` and `onRequestState` only called `refreshSessions()` when the
managed state contained at least one session. With zero managed sessions the
backend listing never ran, `sessionsLoaded` never reached the webview, and both
the WORKTREES and SESSIONS sections stayed on skeletons forever (the worktree
gate requires `worktreesLoaded() && sessionsLoaded()`). Any user whose state file
lost its sessions — exactly what the earlier session-persist bugs caused — hit a
permanently empty-looking sidebar. Reproduced in the harness on a worktree-root
workspace and fixed by making both refreshes unconditional. Root-caused via
stage-by-stage init logging on 2026-07-27; do not reintroduce a content-based
guard here.

### 1.1 Config write path can fail or wipe drafts for existing callers — P0-6 / P1-7

The config binding rework requires every `updateConfig` sender to carry a binding id,
and `configUpdateFailed` currently wipes the draft for the failed scope. Any existing
sender without a binding (permission dock, model picker, auto-approve, onboarding)
now fails or loses the user's unsaved edits.

- Backend half is done: `expected` is optional in the overlay schema, writer, and
  handler, so a client without a binding writes unconditionally again instead of
  getting a 400. The webview half (draft retention on `configUpdateFailed`, and the
  audit of every `updateConfig` sender) is still open.
- Work: the code change is small; the real work is auditing every webview
  `updateConfig` sender and classifying it.
- Also: this change is orthogonal to multi-project. Split it into its own commit
  (`feat(vscode): config write revision bindings`) so it can be reverted alone.

### 1.2 Indexing status read silently revokes consent — P0-3 / P0-4

Partially addressed: untrusted projects are now filtered out of the consent list
(P0-4), and config scope switching plus project-scoped `indexing.enabled` writes
were restored after the rework had hardcoded the tab to global scope (the earlier
P1-8 gap). The remaining blocker is the read path below.


`fetchAndSendIndexingStatus` issues `PUT /indexing/consent` (a write) on a plain
status refresh, defaulting to `enabled: false` for any project not in local
`globalState`. On a fresh machine/profile, the first status read turns indexing off
for users who had it on. A refresh can also target the wrong project
(`requestIndexingStatus` resolves from the current session's directory). Separately,
the Indexing tab lists untrusted projects and would let a user enable indexing for a
repo the trust system has not approved.

- Fix: read status with a GET; PUT only from the explicit setter; seed consent from
  the effective config on first read instead of defaulting false; require an explicit
  project on refresh; filter the project list to trusted projects.
- Dependency: needs a read-only status endpoint. If none exists, this escapes into
  `packages/opencode` (shared upstream code, needs `kilocode_change` markers) or the
  cloud repo.
- Also orthogonal to multi-project; split into its own commit
  (`feat(vscode): per-project indexing consent`).

### 1.3 Land the current work as separate, revertable commits

Everything currently sits uncommitted in one worktree. The review's recommendation
stands: `git reset --soft origin/main` and stage by path into three commits —
multi-project, config bindings, indexing consent. The multi-project commit message
must not promise per-project config/indexing behavior that lands in the other two.

---

## 2. Should fix soon after (experimental surface, data-integrity relevant)

### 2.1 Same repo can register twice — P0-5

`projectIdFor` hashes the canonical path verbatim while `samePath` folds case, so two
casings of one repo produce two project ids, two contexts, and two state managers
racing to write the same `.kilo/agent-manager.json` (last write wins, worktrees and
sessions vanish).

- Fix: fold case inside `projectIdFor` on darwin/win32; reject `addProject` when
  `samePath` matches any registered root.
- Migration: existing registry keys were built from the old hash, so re-key them on
  load or dual-lookup on read. Note `canonicalizePath` already realpaths existing
  paths; the fallback branch must fold case too.
- Why not blocking: requires an unusual casing mismatch at registration time, and the
  feature is flag-gated.

### 2.2 Route service is shared across panels but versioned per context — P0-7

Two VS Code windows each have their own `ProjectContexts` with independent generation
counters feeding one shared `ProjectRouteService`. Panel B registering a project at
generation 0 while panel A is at 2 unregisters panel A's routes; closing one panel
drops routes the other still needs.

- Fix: panel-qualified keys (`panelId + projectId + sessionId`), generations issued
  by the service, ambiguity computed across all panels.
- Why not blocking: needs two windows running Agent Manager against the same repos.
  The fallback already refuses ambiguous raw ids instead of resolving them wrong.
- Note: no two-panel test harness exists today; this fix should create one.

### 2.3 `gh pr` noise in repos without remotes — Bug 5

`gh pr view` fails every 15s per worktree forever, logs before the dedupe, and
`pollOnce` rejections are unhandled.

- Fix: log after the `lastHash` dedupe; `void this.pollOnce().catch(log)` in
  `schedule`; per-root remote probe with a single error emission; skip PR pollers for
  remote-less projects in `ProjectPollers.sync`.

---

## 3. UX papercuts in experimental mode (fix opportunistically)

- **Legacy tabs orphaned on upgrade** (P1-1): `createLocalTabs` migrates persisted
  `localSessionIDs` into a `single` bucket that `tabKey()` never reads once the
  catalog arrives. Migrate `single` to the pinned project id on first state apply.
- **`restoreProjectTarget` skips tab bookkeeping** (P1-3): a restored session has no
  tab. Call `selectLocal()` first, add the tab, then select.
- **`ensurePendingTab` runs before restore** (P1-4): switch adds a "New Session"
  draft that restore may contradict. Move it after restore.
- **Per-keystroke state saves**: `setActiveTarget` writes
  `.kilo/agent-manager.json` on every selection change. Debounce or persist on
  deactivation/dispose only.
- **Untranslated Indexing tab strings** (P1-9), **unused-ish composite id schemes**
  (P1-12), **stats messages tagged at emit time** (P1-14), **no presence sync for
  background projects** (P1-15), **registry read cache** (P1-16/17), **realpath
  syscall churn** (P1-18), **`resolveProjectRoot` process spawning** (P1-19).

---

## 4. Structural debt (schedule, don't block)

### 4.1 Two sidebar implementations — Arch 1.1

Tracked as #12685 (section parity) and #12686 (sidebar drag-and-drop).

`AgentManagerApp` keeps the legacy `renderBody` (now `SidebarBody.tsx`) and
`ProjectSidebarBody.tsx` as a reduced reimplementation. The reimplementation already
caused one full outage of multi-project mode (missing `DragDropProvider` crashed the
webview render). Missing versus legacy: worktree ordering, drag-and-drop reorder and
move-to-section, grouping, busy/navHint/shortcut badges, section auto-rename, stats
skeletons.

- Direction: single-project becomes the degenerate case of multi-project (one
  implicit pinned project, header row hidden), `SidebarBody.tsx` is deleted.
- Do this last: it churns the same message-stamping code as 2.2, needs per-project
  DnD state, and must keep legacy pixel-identical for the default-off population.
  Use the visual-regression skill to cover both modes before merging it.

### 4.2 Ambient project scope via AsyncLocalStorage — Arch 1.3

`ProjectScope` plus the `this.state`/`this.context` getters make the target project
invisible at call sites; any continuation escaping ALS silently falls back to the
active project. `provider-lifecycle.ts` shows the intended end state (explicit deps).
Keep threading `ctx` explicitly into the remaining handler groups; add a dev-mode log
in the `context` getter when a project-stamped message resolves without a scope.

### 4.3 Per-project webview store — Arch 1.2

`worktrees()`, `managedSessions()`, `selection()` etc. are single-valued with
`memKey()`/`tabKey()` and two "current project" accessors that disagree during the
switch window. Long-term: one `createProjectStore(projectId)` per project. For now
the gating added to the remember effect contains the known race.

---

## 5. Verification gaps to close before the PR

- **SSE session upsert** is unit-tested (`upsertSession`, `byDirectory`, fresh-skip
  re-post) but not E2E-verified: the harness backend's basic-auth credentials could
  not be re-extracted after a window reload, so external session creation was not
  exercised live. Verify manually: `kilo` a new session in a registered repo from a
  terminal and watch it appear in that project's sidebar.
- **Tab isolation across projects** (per-project buckets) is unit-tested but not
  E2E-verified with real sessions open in two projects.
- **Legacy mode parity**: legacy sidebar and tab bar were smoke-tested (render,
  select, section create + inline rename), but not the full matrix (delete, DnD
  reorder, move-to-section, review tab, terminals). The extraction moved ~700 lines
  of JSX; a visual-regression pass over `SidebarBody`/`TabBar` stories is the
  cheapest safety net.
- **Harness instability**: the isolated VS Code window crashed repeatedly during this
  work. If it keeps failing on the next pass, say so in the PR rather than claiming
  coverage that does not exist.

---

## Proposed landing sequence

1. Quick independent fixes: 2.3 (gh noise), P0-4 (trust filter), 1.1's audit + 1.2's
   fallback (config), 1.2's indexing read/write split if the GET endpoint exists.
2. 2.1 (case-fold + registry migration).
3. 2.2 (route service, with a two-panel test harness).
4. 1.1's config/indexing commits split out and merged separately.
5. Arch 1.1 (sidebar collapse) with visual-regression coverage; then the P1 batch.
