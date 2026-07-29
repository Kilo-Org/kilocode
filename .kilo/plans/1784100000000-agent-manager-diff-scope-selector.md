# Bring the Changes scope selector and base branch picker into Agent Manager

## Goal

The standalone **Changes** editor panel has a scope selector (`GIT: Branch / Staged / Unstaged`,
`SESSION: Session`) plus a base branch picker (`main → origin/main [Default]`). Agent Manager has
two diff surfaces (compact side panel and full-screen review tab) with **no scope selector and no
base picker**: it always shows one fixed scope against one fixed base.

Make both Agent Manager surfaces scope-aware and base-aware, reusing the existing components and
extension-side sources rather than duplicating them.

## What exists today

### Standalone Changes panel

| Concern | Where |
|---|---|
| Panel host, ephemeral base override | `src/diff/DiffViewerProvider.ts:26-33`, `:101-119`, `:170-182` |
| Source enumeration and construction | `src/diff/sources/catalog.ts:73-115` |
| Scope select | `webview-ui/diff-viewer/DiffPickerHeader.tsx:50-86` |
| Base picker | `webview-ui/diff-viewer/BaseBranchPicker.tsx:77-142` |
| Branch list + auto base + HEAD | `src/diff/sources/catalog.ts:117-138` |
| Renderer | `webview-ui/diff-viewer/FullScreenDiffView.tsx:95` |

Sources: `worktree.ts` (Branch), `staged.ts`, `unstaged.ts`, `session.ts`, `turn.ts`. Polling,
dedupe, and lazy per-file detail live in `src/diff/SourceController.ts`.

### Agent Manager

| Concern | Where |
|---|---|
| Diff controller (wraps the same `SourceController`) | `src/agent-manager/worktree-diff-controller.ts:35-80` |
| Synthetic single source, hardcoded capabilities | `src/agent-manager/worktree-diff-controller.ts:228-242` |
| Fixed base = `origin/<parentBranch>` | `src/agent-manager/worktree-diff-controller.ts:217`, `WorktreeStateManager.ts:57-64` |
| `local` pseudo-context uses auto base | `src/agent-manager/worktree-diff-controller.ts:220-222` |
| Side panel | `webview-ui/agent-manager/DiffPanel.tsx:474-524` |
| Full-screen review (shared component) | `webview-ui/agent-manager/AgentManagerApp.tsx:3105-3131` |
| Data store keyed by session id | `webview-ui/agent-manager/AgentManagerApp.tsx:1675-1699` |

So both systems already share `SourceController`, `local-diff.ts`, `GitOps`, `FullScreenDiffView`,
`FileTree`, `diff-state.ts`, `diff-requests.ts`. The gap is only the *selection* layer.

## The architectural mismatch to resolve first

The two systems key diff sources along orthogonal axes:

- Standalone: keyed by **scope** (`workspace`, `staged`, `unstaged`, `session:<id>`) inside one
  fixed directory (`getWorkspaceRoot()`).
- Agent Manager: keyed by **context** (`sessionId` or `local`), which resolves to a directory and
  base, with one fixed scope.

Integration therefore needs a composite key `(context, scope)`:

```
ctx   = "local" | "<sessionId>"
scope = "branch" | "staged" | "unstaged" | "session"
id    = `${ctx}#${scope}`
```

`ctx#branch` is the default and reproduces today's behavior exactly.

### Hard prerequisite: sources must accept an explicit directory

Three sources resolve the workspace root themselves and cannot currently point at a worktree:

- `src/diff/sources/worktree.ts:46`, `:60`
- `src/diff/sources/staged.ts:47`
- `src/diff/sources/unstaged.ts:53`
- `src/diff/sources/catalog.ts:118` (`listWorkspaceBranches`)

`session.ts` is already directory-parameterized (`catalog.ts:111`), so Session scope is nearly free.

Each source also constructs its own `GitOps` + `OutputChannel` (`worktree.ts:35-37`,
`staged.ts:43-45`). That is acceptable in the standalone panel where sources swap only on scope
change, but Agent Manager swaps sources on **every session selection**. Inject a `log` function and
reuse Agent Manager's shared `GitOps` (`AgentManagerProvider.ts:140-180`) instead of constructing
per source.

## Is Branch still the right default per worktree?

Yes, keep `Branch` as the default for every worktree context. Reasons, strongest first:

1. **It matches what you ship.** Branch is `merge-base(HEAD, origin/<parent>) → current working
   tree`: committed work, staged, unstaged, and untracked. That is exactly the payload
   `Apply to local` builds (`GitOps.buildWorktreePatch`, used at
   `worktree-diff-controller.ts:115`) and what a PR from that branch would contain. Reviewing the
   same set you apply or push is the whole point of the review tab.
2. **No silent behavior change.** It is what Agent Manager does today, and the sidebar `Nf +N -N`
   badge (`GitStatsPoller.ts:191-224`) uses the same base. A different default would make the
   badge and the review disagree on first open.
3. **Stable under base movement.** merge-base semantics mean commits landing on `origin/main`
   after the worktree branched do not pollute the diff.
4. **Session scope can be legitimately empty.** It depends on snapshots being enabled and degrades
   to a `snapshots-disabled` notice (`sources/session.ts:33-66`). A default that can be empty for
   configuration reasons is a bad default.

One correction to the framing: Branch compares against the base **ref** (`origin/main`), not
against the local main checkout's working tree. If your local `main` has unpushed commits or dirty
files, the worktree diff does not account for them. "What changes if I apply this to my current
checkout" is a different question, answered today only by the `Apply to local` conflict check. A
`Local workspace` scope could answer it directly, but it is a non-goal here (see below).

## What each scope means in Agent Manager

| Scope | Worktree context | Local context | Value |
|---|---|---|---|
| Branch | `merge-base(HEAD, origin/<parent>)` to working tree | `merge-base(HEAD, auto base)` to working tree | Default. The reviewable/shippable set. |
| Staged | index vs `HEAD` inside the worktree | same, workspace root | "What did I stage for the next commit." Read-only. |
| Unstaged | working tree vs index, plus untracked | same | "What is not committed yet." Read-only. |
| Session | snapshot diff for the selected session, `directory = worktree.path` | selected local session | Highest new value: separates *this agent session's* edits from manual edits and setup-script output. |

Two honest caveats to design around:

- On a fresh worktree where the agent never commits (the common case), `Branch` ≈ `Staged` +
  `Unstaged`, so the selector adds little until a commit exists. It is still worth shipping because
  `Session` is valuable immediately and because committing agents are increasingly common.
- A worktree can hold several sessions. Expose only the **currently selected** session's Session
  scope; a per-session submenu is a follow-up, not v1.

## UI design

### Full-screen review tab

Put the controls at the head of the existing left toolbar group
(`FullScreenDiffView.tsx:542-571`), before the unified/split radio. Do **not** add a second row:
the standalone panel's separate header row should collapse into this same slot so both hosts render
one identical toolbar.

```
+-----------------------------------------------------------------------------------------------+
| [Branch v] feat/foo -> origin/main [Default] | (Unified|Split) 12 files +340 -88 |            |
|                                     ^ scope     ^ base picker      ^ existing stats            |
|                                              Expand all   Send 3 to chat   [x]                 |
+-----------------------------------------------------------------------------------------------+
| tree | diff                                                                                    |
```

### Compact side panel

`DiffPanel`'s header (`DiffPanel.tsx:476-524`) already competes for width with the radio group,
stats, and three icon buttons in a resizable inspector. Add a **second compact row** under the
existing header rather than cramming one row:

```
+------------------------------------------+
| Changes  (Unified|Split) 12f +340 -88    |  [expand] [fullscreen] [x]
| [Branch v]  -> origin/main               |
+------------------------------------------+
```

Below a width threshold, drop the `-> origin/main` hint and keep only `[Branch v]`; the full base
picker stays reachable in the full-screen tab. The side panel must at least *display* the active
scope even when narrow, because scope state is shared with the review tab (single
`SourceController`) and an unexplained staged-only file list is confusing.

### Dropdown

Reuse `DiffPickerHeader` unchanged: it already renders grouped options with per-option tooltips
from `diffViewer.source.<type>.tooltip` (`webview-ui/src/i18n/en.ts:1235-1248`).

```
+--------------------------+
| GIT                      |
|  Branch                  |  tooltip: all changes vs base, incl. local commits
|  Staged                  |
|  Unstaged                |
| SESSION                  |
|  Session                 |
+--------------------------+
```

Deliberately **no per-scope file counts** in the dropdown. Counts would require polling every scope
continuously (four git pipelines per tick per worktree), which is not worth it. The Branch row's
"vs origin/main" context is already carried by the adjacent base picker.

### UX traps to close

- **Apply to local always applies Branch scope.** It builds its patch from
  `remoteRef(worktree)` regardless of what the review shows. When the active scope is not `Branch`,
  either label the button "Apply branch changes" or disable it with a tooltip explaining that apply
  is branch-scoped. Otherwise users will read "Apply" as "apply what I am looking at".
- **Revert must follow source capabilities.** `staged` and `unstaged` declare
  `capabilities.revert: false` (`staged.ts:29`, `unstaged.ts:29`). Agent Manager currently
  hardcodes `{ revert: true, comments: true }` (`worktree-diff-controller.ts:233`). Send the real
  descriptor capabilities and pass them into the already-existing `canRevert` / `canComment` props
  (`FullScreenDiffView.tsx:88-91`).
- **Scope switch should not flash stale files.** Key the webview diff store by the composite key so
  switching back to a previously fetched scope is instant and never renders another scope's files.

## Base branch picker: semantics and the consistency problem

In the standalone panel the base override is ephemeral and its `Default` means
"auto-resolved tracking or repo default" (`shared/target.ts:4-27`). In Agent Manager, `Default`
should mean **the worktree's recorded parent** (`origin/<parentBranch>`), which is a deliberate
recorded value, not a guess.

The real issue: as soon as a base override exists, the review toolbar and the sidebar badge can
disagree, because `GitStatsPoller` and `Apply to local` both derive from `remoteRef(worktree)`.

Two coherent options:

**A. View-local ephemeral override (cheap).** Mirrors the standalone panel. Zero risk to stats,
apply, and PR flows, but the sidebar badge will visibly disagree with the review toolbar the moment
the user overrides. Needs the review header to always show `vs <base>` so the difference is legible.

**B. Persisted worktree base (recommended).** Treat the picker as editing the worktree's base:
persist `parentBranch` / `remote` (or a new `diffBase`) in `agent-manager.json`
(`WorktreeStateManager.ts:16-45`), and let stats, review, and apply all read the same value. This
keeps a single base per worktree with no divergence, and it fixes a real existing gap: today a
worktree's base cannot be changed after creation, so branching off the wrong base is unrecoverable
without recreating the worktree.

Recommendation: ship **A** in the same phase as the scope selector to keep the diff small, then
promote to **B** as its own change, because B needs stats invalidation, apply, and PR paths updated
together and deserves isolated review. If B is chosen up front, do not also keep A: two competing
bases is worse than either.

## Reuse plan

The point of this work is to add zero new diff rendering code.

### Reuse as-is

- `DiffPickerHeader.tsx` (scope select, grouping, tooltips)
- `BaseBranchPicker.tsx` and `webview-ui/src/components/shared/BranchSelect.tsx`
- `FullScreenDiffView.tsx`, `FileTree.tsx`, `VirtualDiffList.tsx`, `diff-state.ts`,
  `diff-requests.ts`, `diff-open-policy.ts`
- `SourceController.ts`, `sources/session.ts`, `local-diff.ts`, `GitOps.ts`
- All `diffViewer.source.*` and `diffViewer.baseBranch.*` i18n keys, already translated

### New shared pieces (small)

1. `webview-ui/diff-viewer/DiffScopeControls.tsx` - composes `DiffPickerHeader` +
   `BaseBranchPicker`, plus a `compact` flag for the side panel. Consumed by three hosts:
   standalone `DiffViewerApp`, Agent Manager review tab, Agent Manager side panel.
2. A leading toolbar slot prop on both renderers: `FullScreenDiffView` (`lead?: JSXElement`,
   rendered first inside `am-review-toolbar-left`) and `DiffPanel` (second header row). Once
   `FullScreenDiffView` has the slot, move the standalone panel's separate header row into it so
   both hosts share one layout.
3. `webview-ui/agent-manager/diff-scope-state.ts` - composite key helpers and per-context scope
   signal. Keep this out of `AgentManagerApp.tsx` (already 3191 lines).

### Extension side

4. Generalize `PanelContext` so `workspaceRoot` is the resolved diff directory, and make
   `DiffSourceCatalog` build sources for that directory. `SourceController.setContext` is already
   called by Agent Manager (`worktree-diff-controller.ts:79`, `:188`), so the plumbing exists.
5. `WorktreeDiffController.source()` delegates to `DiffSourceCatalog` instead of returning its
   bespoke descriptor. This deletes Agent Manager's synthetic source and gets staged, unstaged, and
   session scopes for free.
6. `src/agent-manager/diff-scope.ts` (new, vscode-free): composite id parse/format, scope to source
   id mapping, capability lookup. `worktree-diff-controller.ts` is already 332 lines and
   `tests/unit/agent-manager-arch.test.ts` enforces `maxLines` caps that must not be raised.

## Message and state changes

Inbound (webview to extension), all additive and optional so existing callers keep working:

| Message | Change |
|---|---|
| `agentManager.requestWorktreeDiff` | add `scope?` |
| `agentManager.startDiffWatch` | add `scope?` |
| `agentManager.requestWorktreeDiffFile` | add `scope?` |
| `agentManager.revertWorktreeFile` | add `scope?` |
| `agentManager.requestDiffBranches` | new, `{ sessionId }` |
| `agentManager.setDiffBaseBranch` | new, `{ sessionId, branch? }` where `undefined` clears |

No separate "set scope" message: a scope switch is a re-activation via `startDiffWatch` /
`requestWorktreeDiff` with the new scope.

Outbound: `worktreeDiff`, `worktreeDiffLoading`, `worktreeDiffFile`, `revertWorktreeFileResult`
gain `scope` and the source `capabilities`; new `agentManager.diffBranches` reuses the existing
`WorkspaceBranchesResult` shape (`sources/catalog.ts:22-33`).

Webview state: `diffDatas` and `diffFileLoading` re-key from `sessionId` to `${ctx}#${scope}`;
`diffSessionKey()` (`AgentManagerApp.tsx:1694-1699`) appends the scope so accordion open state
resets per scope.

Known breakage to fix during the refactor: `shouldStopForWorktree` passes
`this.controller.currentId` into `shouldStopDiffPolling`, which compares it against orphaned
session ids (`delete-worktree.ts:11-20`). Pass the parsed context id, not the composite id.

Target resolution ordering: today `ensureTarget` resolves lazily inside `fetch()`. With the catalog
owning source construction, the directory and base must be resolved *before*
`controller.activate()`. `activate` is already awaited by `request` and `start`, so awaiting
`ready()` plus target resolution first is safe, but this is the main refactor risk in the change.

## Phasing

1. **Parameterize sources by directory.** Add explicit `dir` / injected `log` / shared `GitOps` to
   `worktree.ts`, `staged.ts`, `unstaged.ts`, and `listWorkspaceBranches`. No user-visible change;
   standalone panel keeps passing the workspace root. Verify the standalone panel is unaffected.
2. **Composite keying and catalog delegation.** `diff-scope.ts`, controller delegates to the
   catalog, messages gain `scope` and `capabilities`, webview re-keys. Still one scope exposed, so
   still no visible change. This is the risky phase and should land on its own.
3. **Scope selector UI.** `DiffScopeControls`, toolbar slots in both hosts, standalone header moved
   into the shared slot, `canRevert` / `canComment` wired from capabilities, Apply-scope guard.
4. **Base picker in Agent Manager.** `requestDiffBranches` / `setDiffBaseBranch`, ephemeral
   override (option A), `Default` labeled as the worktree's recorded parent.
5. **Optional follow-up.** Promote the override to a persisted worktree base (option B) shared with
   stats, apply, and PR.

## Verification

- `packages/kilo-vscode/`: `bun run typecheck`, `bun run lint`, `bun run test:unit`, `bun run knip`
  (new exports must be imported somewhere).
- New unit tests: scope to source id mapping, composite id parse/format, base override resolution
  for a worktree directory, and `shouldStopDiffPolling` with composite ids. Existing coverage to
  keep green: `tests/unit/local-diff.test.ts`, `tests/unit/agent-manager-arch.test.ts`.
- Visual regression stories for the toolbar in both hosts, per the `vscode-visual-regression`
  skill.
- Manual (self-test instance): worktree with a commit plus dirty files, switch Branch / Staged /
  Unstaged / Session, confirm counts differ correctly, revert hidden in read-only scopes, side
  panel and review tab stay in sync, base override changes the file set, and switching worktrees
  resets to Branch.
- Changeset required (user-facing feature).

## Non-goals

- A `Local workspace` scope comparing a worktree against the local checkout's working tree. Useful,
  but it needs a tree-to-tree diff path that does not exist in `local-diff.ts` and it overlaps with
  the `Apply to local` conflict check.
- Per-session Session scope submenu when a worktree holds multiple sessions.
- Turn scope inside Agent Manager. Per-turn changes already open the standalone panel from the
  transcript (`VscodeSessionTurn.tsx:179-200`).
- Per-scope file counts in the dropdown.
- Merging the standalone Changes panel into Agent Manager. Phase 3 makes them converge visually;
  actually collapsing the two hosts is a separate decision.

## Open questions

1. Option A or B for the base picker (view-local override vs persisted worktree base). B is the
   better end state; A is the smaller step.
2. Should the scope persist per worktree in `agent-manager.json` alongside `reviewDiffStyle`, or
   always reset to Branch on selection change? Resetting is more predictable; persisting is less
   repetitive for someone who lives in Session scope.
3. Should the side panel's scope control be interactive or display-only, given how little width it
   has?
