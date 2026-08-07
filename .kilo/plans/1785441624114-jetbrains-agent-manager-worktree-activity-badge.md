# JetBrains Agent Manager — worktree activity badge

## Goal

Show a status badge on each **worktree row** in the JetBrains Agent Manager list
(`AgentManagerPanel`), aggregating the activity of that worktree's sessions — the same
`ActiveListBadge` the worktree **session list** already renders per session
(`WorktreeSessionEditorPanel.SessionRow.badges`).

Aggregation per worktree row:

1. If any session has a **non-running** kind (`PERMISSION`, `QUESTION`, `PLAN`), show that
   (deterministic precedence below; "pick the first" per the request — order does not matter).
2. Else if any session is **running** (`busy`), show `RUNNING`.
3. Else **no badge**.

The badge must reflect real activity for **all** worktrees in the list, including worktrees
whose editor tab is not open.

## Resolved decision (with user)

**Data source = reactive global activity stream.** Add a backend-maintained, reactive
`sessionId → activity(kind, directory)` map — built from the global SSE stream the backend
already consumes (`session.status` + `question.asked/replied/rejected` +
`permission.asked/replied`) — exposed over a new Kilo-owned RPC that mirrors the existing
`statuses()` stream. The frontend groups by directory and aggregates; the Agent Manager row
looks up `activity[worktree.path]`. No polling, no CLI/SDK change.

### Why this shape (grounded in the code)

- The worktree session-list badges come from `WorktreeSessionEditorPanel.sync()` →
  `manager.activity()` (`Map<sessionId, SessionActivityKind>`), rendered via
  `ActiveListBadge(kind.label(), kind.style())` (`WorktreeSessionEditorPanel.kt:336`).
- `RUNNING` is derived from the global reactive `KiloSessionService.statuses` (`busy` →
  `RUNNING`, `KiloSessionService.kt:94`). `QUESTION`/`PLAN`/`PERMISSION`/`LOGIN_REQUIRED` are
  only derivable from a live `SessionController` (`SessionUi.activityKind()`,
  `SessionUi.kt:245`); the status stream has no `busy`-vs-`question` distinction
  (`session/status.ts` types: `idle|retry|busy|offline`). A session awaiting a question or
  permission stays `busy` (the tool blocks the turn).
- The `AgentManagerPanel` worktree list is **not** a `SessionHost` and has no per-worktree
  session data, so it needs an external source that also carries each active session's
  **directory** (both to attribute `RUNNING` and to attribute `QUESTION`/`PERMISSION`).
- The backend already parses these events globally: `KiloBackendChatManager` re-emits
  `ChatEventDto.{PermissionAsked,PermissionReplied,QuestionAsked,QuestionReplied,QuestionRejected,SessionStatusChanged}`
  on its global `events` flow (`KiloBackendChatManager.kt:71-77`), and
  `KiloBackendSessionManager` already tracks the global `statuses` StateFlow. No CLI change is
  needed to observe them.

## Constraints / invariants

- `packages/kilo-jetbrains/` is entirely Kilo-owned: **no `kilocode_change` markers**.
- **No CLI/SDK change**: the events are already parsed by the backend; this is a new
  Kilo-internal RPC (`shared` + `backend` + `frontend`). No `package.json` pin bump, no
  `script/generate.ts`.
- Split-mode: define the RPC contract + DTOs in `shared` (`@Serializable`), implement in
  `backend`, consume in `frontend` coroutines (never on EDT). Wrap the long-lived stream in
  `durable {}` like `KiloSessionService.statuses`.
- All Swing/model mutation on EDT (`@RequiresEdt`); marshal flow emissions to EDT.
- Style/naming per `AGENTS.md`: single-word names, early returns, no `let`/`else` chains,
  reuse `SessionActivityKind` + `ActiveListBadge` for rendering (no new colors/labels).

## Scope of kinds

- **In scope:** `RUNNING` (busy), `QUESTION`, `PLAN`, `PERMISSION`.
- **Out of scope (v1):** `LOGIN_REQUIRED`. It requires replicating
  `isPaidModelAuthRequired` (`session/controller/PaidModelAuth.kt`) parsing plus the
  stateful clear/dismiss transitions on the backend. Note as a follow-up; it does not block
  the "running / question & etc" request.

---

## Data model (shared)

`shared/.../rpc/dto/SessionDto.kt` (next to `SessionStatusDto`):

- `@Serializable enum class SessionActivityKindDto { RUNNING, QUESTION, PLAN, PERMISSION }`
- `@Serializable data class SessionActivityDto(val directory: String, val kind: SessionActivityKindDto)`

`shared/.../rpc/KiloSessionRpcApi.kt`:

- Add `suspend fun activity(): Flow<Map<String, SessionActivityDto>>` (keyed by sessionID),
  documented as "Observe live per-session activity (busy + pending question/permission) with
  the session's directory," mirroring `statuses()`.

---

## Backend

### 1. `KiloBackendSessionManager` — expose session directory

Currently maps `SessionDto` (with `directory`) but does not cache sessionId → directory.

- Add `private val owned = ConcurrentHashMap<String, String>()`. In the private `dto(...)`
  builder set `owned[id] = dir` (populated by every `list`/`recent`/`get`/`create` mapping).
- Add `fun sessionDirectory(id: String): String? = directories[id] ?: owned[id]` (prefers the
  explicit worktree override, then the session's own directory).
- Clear `owned` in `stop()`.

### 2. New `KiloBackendActivityManager` (not an IntelliJ service)

New file `backend/.../app/KiloBackendActivityManager.kt`, owned by `KiloBackendAppService`
(started/stopped like `sessions`/`chat`). Mirrors `KiloBackendSessionManager` shape.

State (EDT-agnostic; guarded by its own coroutine/confined dispatcher or a single collector):

- reads `sessions.statuses` (StateFlow) for `busy` baseline (includes seeded statuses).
- `permissions: MutableMap<String /*sessionId*/, MutableSet<String /*permId*/>>`.
- `questions: MutableMap<String /*sessionId*/, MutableMap<String /*questionId*/, Boolean /*plan*/>>`
  where `plan = request.questions.any { it.questionKey == "plan.followup.question" || it.headerKey == "plan.followup.header" }`
  (mirrors `SessionUi.planFollowup`).
- `_activity = MutableStateFlow<Map<String, SessionActivityDto>>(emptyMap())`;
  `val activity: StateFlow<...> = _activity.asStateFlow()`.

`start(sessions: KiloBackendSessionManager, chatEvents: SharedFlow<ChatEventDto>)`:

- launch: collect `sessions.statuses` → `recompute()`.
- launch: collect `chatEvents`; update the maps then `recompute()`:
  - `PermissionAsked` → `permissions[sid] += request.id`
  - `PermissionReplied` → `permissions[sid] -= requestID` (drop empty)
  - `QuestionAsked` → `questions[sid][request.id] = planFollowup`
  - `QuestionReplied` / `QuestionRejected` → `questions[sid] -= requestID` (drop empty)
  - `SessionStatusChanged` with `type == "idle"` (and `SessionIdle`) → also drop that session's
    permission/question overlays (defensive: a turn that ends without explicit replied/rejected
    should not leave a stale overlay).

`recompute()`: for every sessionId that is `busy` OR has a pending permission/question, compute
`kind` by per-session precedence:

1. pending permission → `PERMISSION`
2. else pending question → `PLAN` if any pending question is a plan-followup, else `QUESTION`
3. else `busy` → `RUNNING`

Resolve `dir = sessions.sessionDirectory(sid)`; **skip** the entry when `dir == null` (unknown
directory — cannot attribute; rare, populated once the session is listed/created). Emit the new
`Map<sid, SessionActivityDto(dir, kind)>`.

`stop()`: cancel watchers, clear maps, `_activity.value = emptyMap()`.

### 3. Wire into `KiloBackendAppService`

- Add an `activity` field alongside `sessions`/`chat`.
- After `sessions.start(...)` and `chat.start(...)`, call `activity.start(sessions, chat.events)`
  (`KiloBackendAppService.kt:459-461`). Add to `stop()`.

### 4. `KiloSessionRpcApiImpl`

- `override suspend fun activity(): Flow<Map<String, SessionActivityDto>> = app.activity.activity`
  (mirror `statuses()` at `KiloSessionRpcApiImpl.kt:103`). Add an `activity` accessor
  (`get() = app.activity`) like `sessions`/`chat`.

---

## Frontend

### 5. `KiloSessionService` — subscribe to the stream

Mirror the existing `statuses` wiring (`KiloSessionService.kt:65`):

```kotlin
val activity: StateFlow<Map<String, SessionActivityDto>> =
    stream { activity() }.stateIn(cs, SharingStarted.Eagerly, emptyMap())
```

`FakeSessionRpcApi` (test double): add `val activity = MutableStateFlow<Map<String, SessionActivityDto>>(emptyMap())`
and `override suspend fun activity() = activity` (mirrors `statuses`).

### 6. Aggregation helper (pure, testable)

New `agentManager/worktree/WorktreeActivity.kt`:

```kotlin
internal fun aggregateWorktreeActivity(
    activity: Map<String, SessionActivityDto>,
): Map<String, SessionActivityKind>
```

- Normalize each `directory` (trim trailing `/`) — worktree paths from git
  (`WorktreeDto.path`) and session `directory` are both absolute; normalize both sides for the
  lookup.
- Group by directory. For each directory pick one kind by precedence:
  `PERMISSION` > `QUESTION` > `PLAN` > `RUNNING` (non-running first, then running). Map
  `SessionActivityKindDto` → `SessionActivityKind`.

### 7. `WorktreeController` — hold + push aggregated activity

- Add injectable seam (keeps existing tests compiling):
  `activity: StateFlow<Map<String, SessionActivityDto>> = MutableStateFlow(emptyMap())`
  (production: `project.service<KiloSessionService>().activity`, passed from
  `KiloToolWindowFactory`).
- Add `@Volatile var kinds: Map<String, SessionActivityKind> = emptyMap()` (directory → kind)
  and `var onActivityChanged: (() -> Unit)? = null`.
- In an `init` block: `cs.launch { activity.collect { snap -> edt { kinds = aggregateWorktreeActivity(snap); onActivityChanged?.invoke() } } }`.
- Add `fun kind(path: String): SessionActivityKind? = kinds[path.trimEnd('/')]`.

### 8. `AgentManagerPanel` — render the badge

- `WorktreeRow`: add `val kind: SessionActivityKind?` and
  `override val badges get() = listOfNotNull(kind?.let { ActiveListBadge(it.label(), it.style()) })`
  (mirrors `WorktreeSessionEditorPanel.kt:336`). Hide the badge for `pending`/`deleting` rows
  (return `emptyList()`), matching the session list's "no badge while transient" rule.
- `sync()`: pass `kind = controller.kind(item.path)` when building each `WorktreeRow`.
- `init`: set `controller.onActivityChanged = { sync() }`.
- `dispose()`: set `controller.onActivityChanged = null` (alongside the existing null-outs).
- `KiloToolWindowFactory.setup(...)`: construct
  `WorktreeController(service<KiloWorktreeService>(), workspace.directory, cs, activity = project.service<KiloSessionService>().activity)`.

No `ActiveListRenderer` change — the worktree list already uses the same `ActiveList` +
renderer as the session list, and `ActiveListItem.badges` is already supported.

---

## Tests

Backend:

- `KiloBackendActivityManagerTest` (drive `ChatEventDto` + a `statuses` StateFlow through
  `start`; seed `sessionDirectory` via a small fake/`MockCliServer`-backed
  `KiloBackendSessionManager` or a seam):
  - `busy` status + known dir → `RUNNING` at that directory.
  - `PermissionAsked` overlays `RUNNING` → `PERMISSION`; `PermissionReplied` reverts to
    `RUNNING` while still busy; `idle` clears the entry.
  - `QuestionAsked` (plain) → `QUESTION`; plan-followup question keys → `PLAN`;
    `QuestionReplied`/`QuestionRejected` revert.
  - session with unknown directory is omitted from the map.
- `KiloBackendSessionManagerTest` (or existing): `sessionDirectory` returns the mapped dir
  after a `list`/`create`, and the `setDirectory` override wins.

Frontend:

- `WorktreeActivityTest` (pure): precedence (non-running beats running; `PERMISSION` beats
  `QUESTION` beats `PLAN`); multiple sessions in one directory aggregate to one kind; trailing
  slash normalization; `SessionActivityKindDto` → `SessionActivityKind` mapping.
- `WorktreeControllerTest`: push a `SessionActivityDto` map through the injected `activity`
  flow → `kinds` updates on EDT and `onActivityChanged` fires; `kind(path)` returns the
  aggregated kind (with/without trailing slash).
- `AgentManagerPanelTest`: a worktree row shows the expected `ActiveListBadge` for a
  running/question/permission directory; no badge when the directory has no active session;
  no badge on `pending`/`deleting` rows.
- `FakeSessionRpcApi`: `activity` StateFlow added (see task 5).

## Failure modes / edge cases

- **Directory mismatch:** worktree `path` vs session `directory` string differences (trailing
  slash, symlinks). Normalize trailing slash on both sides; note symlink normalization as a
  residual risk (sessions are created with the worktree directory, so exact match is expected).
- **Unknown session directory:** a session that went busy before any list/create in this
  backend lifetime has no cached dir → omitted until listed. Acceptable; the sidebar/worktree
  editors list sessions, and `create` records dir.
- **Pending question/permission that predates subscription** (IDE reconnect while a question is
  pending): only live events are tracked, so it may not appear until the next event. Matches how
  the frontend also only recovers pending state on session open. Note as accepted v1 limitation
  (optional follow-up: seed via `pendingQuestions`/`pendingPermissions` when the panel supplies
  its worktree dirs).
- **Auto-approved permissions:** a transient `PermissionAsked` → `PermissionReplied` will briefly
  show `PERMISSION` then revert to `RUNNING`. Acceptable (transient).
- **`retry`/`offline` statuses:** map to **no badge** (parity with
  `KiloSessionService.activity()` and `SessionUi.activityKind()`, which only surface `busy`).
- **EDT discipline:** flow collection runs on `cs` (background); `kinds` mutation + `sync()` are
  marshalled to EDT via the existing `edt {}` helper in `WorktreeController`.

## Validation

From `packages/kilo-jetbrains/`:

- `./gradlew typecheck` (compiles shared + backend + frontend + generated client).
- `./gradlew :backend:test --tests ai.kilocode.backend.app.KiloBackendActivityManagerTest` (+ session manager test).
- `./gradlew :frontend:test --tests ai.kilocode.client.agentManager.worktree.WorktreeActivityTest --tests ai.kilocode.client.agentManager.WorktreeControllerTest --tests ai.kilocode.client.agentManager.AgentManagerPanelTest`.
- Run inspection `Plugin DevKit | Code | Frontend and Backend API Usage` (new RPC method spans shared/backend/frontend).
- Manual smoke in `runIdeSplitMode`: create two worktrees, start a session in each; confirm a
  `RUNNING` badge appears on a worktree row while its session is busy, upgrades to
  `QUESTION`/`PERMISSION` when that session asks/needs approval (even when that worktree's editor
  tab is not focused), and clears when idle.

## Out of scope

- `LOGIN_REQUIRED` aggregation (paid-model-auth detection on the backend) — follow-up.
- Seeding pre-existing pending questions/permissions on reconnect — follow-up.
- Any VS Code Agent Manager change (its worktree badges are PR/run-script status, a different
  concept).
- `kilocode_change` markers / CLI pin bump / SDK regen (none required).

## Notes for implementer

- Editing spans `shared/`, `backend/`, and `frontend/` Kotlin modules — switch to an
  implementation-capable agent.
- Reuse `SessionActivityKind.label()/style()` for rendering; do not introduce new badge
  labels/colors. Add no new user-visible strings (badge labels already exist).
