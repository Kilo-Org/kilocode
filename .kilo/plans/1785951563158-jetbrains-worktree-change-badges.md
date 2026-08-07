# JetBrains: worktree change badges + PR badges

Add per-worktree git change badges (`+add −del`, ahead/behind arrows) and a PR badge
(`#num` + state color) to the JetBrains Agent Manager worktree **list**, and mirror the
same badge into the **worktree editor** session toolbar (right‑aligned). Hide the existing
branch‑changes badge in the session **header** only for sessions running inside a worktree
editor; keep it for tool‑window sessions.

## Confirmed decisions

- **Fetch model:** ONE batched backend RPC per refresh for git stats (numstat + rev‑list
  ahead/behind for every managed worktree) and a separate batched gh RPC for PRs. A shared
  project‑level frontend service owns the `StateFlow`s and refreshes on discrete triggers
  (list load, session turn‑end/idle, editor selection, tool window becomes visible) with
  debounce, plus a slow safety poll (~30s git / ~120s gh) only while a Kilo surface is visible.
  Backend caches base‑branch resolution and the gh availability probe with a TTL.
- **PR scope:** number + state only (`open`/`draft`/`merged`/`closed`), one `gh pr view` per
  worktree. Clicking the PR pill opens the PR URL.
- **gh onboarding:** when gh is missing or unauthenticated, show ONE sticky suggestion
  notification per IDE session (install → https://cli.github.com/, auth → open IDE terminal
  running `gh auth login`, browse fallback). PR badge stays hidden; git badges still work.
- **Ahead/behind base:** worktree branch upstream `@{upstream}` when set, else the main
  worktree's current branch. Diff numstat is computed against `merge-base HEAD <base>`. No
  implicit network fetch (counts may be slightly stale, like VS Code).

## Scope / boundaries

- **All changes live in `packages/kilo-jetbrains/` (Kilo‑owned).** No `kilocode_change`
  markers, no `packages/opencode/` edits, no SDK regen, no CLI pin bump. Git/gh run in the
  JetBrains backend in‑process (as `KiloWorktreeRpcApiImpl` already does for `worktree list`).
- Modules touched: `shared/` (DTOs + RPC signatures), `backend/` (RPC impl + gh runner),
  `frontend/` (status service, list row, editor toolbar, header flag, notifications, i18n).
- No new plugin.xml/module‑XML wiring is required if the new frontend service is a light
  `@Service(Service.Level.PROJECT)`. The `KiloWorktreeRpcApi` provider is already registered.

## Data flow

```
Frontend triggers ─▶ WorktreeStatusService (project light service)
   (list load / turn-end / editor select / visible + slow poll, debounced)
        │  suspend RPC (batched, off-EDT, durable{})
        ▼
KiloWorktreeRpcApi.stats(dir)     ── backend runGit per worktree (bounded concurrency)
KiloWorktreeRpcApi.prStatus(dir)  ── backend runGh  per worktree (probe-gated, TTL cache)
        │  StateFlow<Map<path, WorktreeStatsDto>> / <Map<path, WorktreePrDto>> / GhAvailability
        ▼
  ┌───────────────────────────┬──────────────────────────────┐
  │ AgentManagerPanel (list)  │ WorktreeSessionEditorPanel     │
  │  trailing stats per row   │  toolbar EAST stats badge      │
  └───────────────────────────┴──────────────────────────────┘
```

## Task 1 — Shared DTOs (`shared/.../rpc/dto/WorktreeDto.kt`)

Add `@Serializable` payloads (single‑word fields, nullable‑safe defaults):

- `WorktreeStatsDto(path, additions=0, deletions=0, ahead=0, behind=0)`
- `WorktreeStatsListDto(items: List<WorktreeStatsDto> = emptyList())`
- `enum GhState { OPEN, DRAFT, MERGED, CLOSED }`
- `WorktreePrDto(path, number, state: GhState, url, )`
- `enum GhAvailability { OK, MISSING, UNAUTH }`
- `WorktreePrListDto(availability: GhAvailability = GhAvailability.OK, items: List<WorktreePrDto> = emptyList())`

Do **not** add stat fields to `WorktreeDto` itself — keep list identity separate from
volatile stats so list reloads and stat refreshes don't fight.

## Task 2 — Shared RPC signatures (`shared/.../rpc/KiloWorktreeRpcApi.kt`)

Add two suspend methods to the existing `@Rpc interface KiloWorktreeRpcApi`:

- `suspend fun stats(directory: String): WorktreeStatsListDto`
- `suspend fun prStatus(directory: String): WorktreePrListDto`

## Task 3 — Backend git/gh (`backend/.../rpc/KiloWorktreeRpcApiImpl.kt`)

Reuse `managedWorktrees(parseWorktreeList(...))` to enumerate non‑main worktrees, then:

**`stats(directory)`** — for each managed non‑main worktree, run git with `cwd = worktree.path`
(via a small variant of `runGit` that accepts the worktree dir), in parallel with bounded
concurrency (e.g. `Semaphore(4)` / `coroutineScope { map { async {...} } }`), all under
`Dispatchers.IO`:
- Resolve `base`: `git rev-parse --abbrev-ref --symbolic-full-name @{upstream}` → use it if
  exit 0; else the main worktree branch (from the already‑parsed main entry). Cache resolution
  per worktree path with a short TTL (~60s) to avoid re‑resolving every poll.
- `ancestor = git merge-base HEAD <base>` (fall back to `base` on failure).
- Diff: `git -c core.quotepath=false diff --numstat --no-renames <ancestor>` → sum col1/col2
  as additions/deletions (skip `-` binary rows). Add untracked line counts via
  `git ls-files --others --exclude-standard` capped like `WorktreeDiff` (mirror
  `packages/opencode/src/kilocode/review/worktree-diff.ts` / VS Code `local-diff.ts`).
- Ahead/behind: `git rev-list --left-right --count <base>...HEAD` → `behind ahead`.
- Any per‑worktree git failure ⇒ zeros for that worktree (never throw).

**`prStatus(directory)`** — add `runGh(base, vararg args)` analogous to `runGit` but built
with `GeneralCommandLine(listOf("gh")+args).withWorkDirectory(...)
.withParentEnvironmentType(ParentEnvironmentType.CONSOLE)` so the login‑shell PATH from
`EnvironmentUtil` is used (fixes GUI‑launched IDE not seeing Homebrew `gh`; mirrors VS Code
`shell-env.ts`). Then:
- Probe: `gh --version` (cache result + timestamp ~5min TTL on the impl). ENOENT / "not
  recognized" ⇒ `MISSING`.
- If missing ⇒ return `WorktreePrListDto(MISSING)` immediately (no per‑worktree calls).
- For each worktree (bounded concurrency, cwd = worktree path):
  `gh pr view <branch> --json number,state,isDraft,url` (branch = worktree branch). Map
  `state`+`isDraft` → `GhState`. "no pull requests found" ⇒ omit that worktree. stderr
  containing "not logged"/"gh auth login" ⇒ mark availability `UNAUTH` and stop (return
  `UNAUTH` with whatever succeeded).
- Cache the `WorktreePrListDto` per directory with a TTL (~60–120s) so the slow frontend poll
  and event triggers coalesce.
- Reuse the error classification shape from VS Code `git-import.ts:classifyPRError`
  (missing / auth / not_found).

Keep `runGit`'s 30s timeout; give gh a similar bounded timeout.

## Task 4 — Frontend service `WorktreeStatusService` (project light `@Service`)

New file `frontend/.../agentManager/worktree/WorktreeStatusService.kt`:

- Injected `(Project, CoroutineScope)`. Holds:
  - `stats: StateFlow<Map<String, WorktreeStatsDto>>` (keyed by normalized path)
  - `pr: StateFlow<Map<String, WorktreePrDto>>`
  - `gh: StateFlow<GhAvailability>`
- `refreshStats()` — debounced (~300ms), calls `KiloWorktreeService.stats(dir)` off‑EDT in
  `durable { }`, updates the flow. Safe fallback: on failure keep last value + log.
- `refreshPr()` — throttled (min interval ~30s between real calls), calls
  `KiloWorktreeService.prStatus(dir)`; updates `pr` + `gh`; triggers the onboarding
  notification (Task 8) when availability becomes `MISSING`/`UNAUTH`.
- **Visibility gating + safety poll:** track subscriber/attach count; run the slow polls
  (~30s stats / ~120s pr) only while at least one subscriber (list or editor toolbar) is
  showing. Use `UiTimers`/service scope, cancel when hidden.
- `directory` = project base path (the repo root that owns `.kilo/worktrees`).

Extend `KiloWorktreeService` (`frontend/.../worktree/KiloWorktreeService.kt`) with `stats` /
`prStatus` wrappers following the existing `call { }` + try/catch → safe‑default pattern.

## Task 5 — Reusable badge view `WorktreeStatsView`

New retained Swing component `frontend/.../agentManager/worktree/WorktreeStatsView.kt`
(built once, `update(stats, pr)` mutates children — obey the retained‑component rules):
- Horizontal `Stack`: optional behind (`↓N`) + ahead (`↑N`) fragments (reuse header
  `/icons/arrow-down-to-line.svg` and `/icons/arrow-up.svg`; hide when 0), reuse
  `DiffStatBadge(Variant.COMPACT)` for `+add −del`, and an optional PR pill.
- PR pill: a `JBLabel` whose icon is a `FilledBadgeIcon("#$number", style)` where the style
  maps `GhState` to a `UiStyle.Badge` variant (open→Primary/Highlight, draft→Secondary,
  merged→a purple‑ish/Highlight, closed→Alert). Clicking opens `pr.url` via `BrowserUtil`.
- Colors from theme APIs only (`UiStyle.Colors.addedForeground()/removedForeground()`,
  `UIUtil`/`JBUI.CurrentTheme`); no literals.

## Task 6 — Worktree list rows (`AgentManagerPanel.kt` + `ActiveListRenderer`)

The list renderer today only supports text pills (`badges`) and a single trailing text
(`trail`). Add a rich trailing metric slot:
- In `ui/list/ActiveListModel.kt`: add `data class ActiveListMetrics(additions, deletions,
  ahead, behind, pr: ActiveListBadge?)` and `val metrics: ActiveListMetrics? get() = null` on
  `ActiveListItem`.
- In `ui/list/ActiveListRenderer.kt`: hold ONE retained `WorktreeStatsView`‑style component in
  the trailing area (mutually exclusive with `trail` text — metrics win). Update it per row in
  `getListCellRendererComponent` (single retained instance, no per‑row allocation), matching
  the existing `syncBadges`/`syncCells` reuse pattern. Ensure `activeListCellBounds` hit‑testing
  is unaffected (metrics area is non‑interactive in the list; the row `onOpen` still opens the
  editor — PR click in the list is optional, keep click handling in the editor toolbar only for
  v1 to avoid list hit‑test complexity).
- In `AgentManagerPanel`: subscribe to `WorktreeStatusService` in `init`, store latest
  stats/pr, and populate `WorktreeRow.metrics` in `sync()`. Trigger `refreshStats()` from
  `refresh()`/`reload` and on `onActivityChanged`; trigger `refreshPr()` on list load + slow
  poll. Register the panel as a status subscriber (drives visibility gating).

## Task 7 — Worktree editor toolbar (`WorktreeSessionEditorPanel.kt`)

- In `toolbar()` (currently only fills `BorderLayout.WEST`), add a `WorktreeStatsView` at
  `BorderLayout.EAST` of the bottom‑bordered panel.
- Subscribe to `WorktreeStatusService` filtered by `worktree.directory`; `update()` the view on
  flow changes. Trigger `refreshStats()`/`refreshPr()` when the editor becomes visible
  (`addHierarchyListener`/`start()`) and on `manager` activity changes; register as a status
  subscriber for visibility gating.
- Clicking the toolbar PR pill opens the PR URL; clicking the diff stat opens the branch diff
  editor for this worktree (reuse the same `KiloDiffEditorKind` "branch" open used by
  `SessionUi.openBranchDiff`; extract a small shared helper or duplicate the few lines).

## Task 8 — Hide header badge in worktree editor sessions

- Add `val showsBranchBadgeInHeader: Boolean get() = true` to the `SessionManager` interface
  (`session/SessionManager.kt`).
- Override to `false` in `WorktreeSessionEditorManager`.
- In `SessionUi`: guard `refreshBranchChanges()` (and the header badge wiring /
  `openBranchChanges` from the header) with `manager?.showsBranchBadgeInHeader != false`.
  When false: never call `header.setBranchChanges(...)` and skip the per‑session
  `branchDiff` fetch entirely (performance win — the shared service already computes it).
  `SessionSidePanelManager` (tool window) keeps the default `true`, so its header badge is
  unchanged.

## Task 9 — gh onboarding notification

- Add a suggestion helper (extend `KiloNotifications` or a small local object) that posts a
  single suggestion notification in the existing `"Kilo Code"` group with
  `setSuggestionType(true)`; consider a dedicated `STICKY_BALLOON` notificationGroup in
  `kilo.jetbrains.frontend.xml` if stickiness is required.
- `WorktreeStatusService` calls it at most once per IDE session (guard with a flag) when
  `gh` flips to `MISSING` or `UNAUTH`:
  - `MISSING` → "GitHub CLI not found" + action **Install** → `BrowserUtil.browse("https://cli.github.com/")`.
  - `UNAUTH` → "GitHub CLI not authorized" + action **Authorize** → open the IDE terminal
    running `gh auth login` when the Terminal plugin is available
    (`org.jetbrains.plugins.terminal.TerminalToolWindowManager`), else browse the auth docs.
  - Include an expiring **Don't show again** dismiss.
- Fallback is always safe: PR badges simply stay absent; git badges continue to work.

## Task 10 — i18n

Add keys to the base bundle `frontend/.../resources/messages/KiloBundle.properties` (other
locales fall back to English): stat tooltips (ahead/behind/added/deleted), PR pill tooltip,
gh notification titles/bodies/action labels. Use `KiloBundle.message(...)` everywhere; build
HTML (if any) with `HtmlChunk`/`XmlStringUtil`.

## Performance summary

- One batched `stats` RPC and one batched `prStatus` RPC per refresh, not per row.
- Backend runs git/gh per worktree with bounded concurrency; base resolution + gh probe +
  pr results are TTL‑cached.
- Frontend refresh is event‑driven (list load, turn‑end, editor select, tool‑window visible),
  debounced, with a slow safety poll that runs **only while a Kilo surface is visible**.
- gh short‑circuits to no per‑worktree calls when the probe says `MISSING`.
- Worktree editor sessions no longer issue their own per‑session `branchDiff` fetch.

## Failure modes / fallback

- git subprocess failure per worktree → zeros for that worktree; never throws; row still renders.
- gh missing → `MISSING`, badges hidden, one onboarding suggestion.
- gh unauthenticated → `UNAUTH`, badges hidden, one onboarding suggestion.
- No PR for a branch → PR pill absent; git badges still shown.
- Backend/RPC error → frontend keeps last known values and logs via `log.error(..., err)`.

## Testing

- **Backend** (mirror `backend/.../rpc/KiloWorktreeRpcApiImplTest` / `BranchDiffTest`, real
  temp git repos, no mocks): `stats` numstat + rev‑list ahead/behind against a seeded
  worktree; untracked line counting; base resolution upstream‑vs‑main fallback; `prStatus`
  gh‑missing classification (fake `gh` on PATH or a `runGh` seam) → `MISSING`, and stderr
  auth‑failure → `UNAUTH`; per‑worktree failure yields zeros.
- **Frontend** (`BasePlatformTestCase`, real EDT, fake RPC): `WorktreeStatusService` maps flow
  → row metrics and toolbar view; `AgentManagerPanelTest` renders diff/ahead‑behind/PR pill;
  `WorktreeSessionEditorPanelTest` shows the toolbar badge; retained‑component tests for
  `WorktreeStatsView` (`update()` mutates without rebuilding, no‑op updates don't repaint);
  `ActiveListRenderer` metric reuse.
- **Header flag**: a `SessionControllerTestBase`/`SessionUi` test asserting the branch badge
  is hidden and no `branchDiff` fetch occurs when `manager.showsBranchBadgeInHeader == false`,
  and still shown for the default tool‑window manager.
- **Notification**: assert the suggestion fires once per session for `MISSING`/`UNAUTH` and not
  when `OK`.

## Validation commands (from `packages/kilo-jetbrains/`)

- `./gradlew typecheck`
- `./gradlew test` (or targeted `--tests` for the new/updated classes)
- Manual: `./gradlew --no-configuration-cache runIdeSplitMode` (or `runIde`), open Agent
  Manager with ≥1 worktree that has changes and a PR; verify list badges, editor toolbar badge
  right‑aligned, header badge hidden in the worktree editor but present in the sidebar, and the
  gh onboarding notification when `gh` is absent/unauthenticated.

## Risks / notes

- `WorktreeStatsView` in the list must obey retained‑Swing reuse (one instance mutated per row)
  or it will thrash the renderer — call out in review.
- `gh auth login` in the IDE terminal depends on the optional Terminal plugin; guard the lookup
  and fall back to browsing docs so a missing terminal never breaks the action.
- Ahead/behind uses local refs only (no fetch); numbers can lag the remote, matching VS Code —
  acceptable and documented in tooltips.
- `runGh` must use `ParentEnvironmentType.CONSOLE` (login‑shell PATH) or GUI‑launched IDEs on
  macOS won't find Homebrew `gh`.

## Out of scope (v1)

- gh checks / review decision / unresolved‑comment counts (VS Code full parity).
- Stats/PR badges for the main (sidebar) workspace.
- Clickable PR pill inside the list rows (kept in the editor toolbar only for v1).
- Any `packages/opencode/` server endpoint, SDK, or CLI‑pin work.
