# JetBrains: surface "Dev Container unsupported" via the existing turn‑outcome card

## Goal

When a JetBrains project is opened through a local‑IDE + virtual (IJent) path (Model 2 —
`/$devcontainer.ij/…podman.sock/…`, `\\wsl$\…`, or an `InvalidPathException` path), the host CLI
can't resolve the directory and the workspace can't load. Communicate this **using the existing
in‑chat outcome card** (`SessionOutcomeView`), shown **immediately** on open — not with a new
ConnectionPanel banner. Extract the outcome card so it renders both inside a session transcript
(existing use) and standalone for this workspace‑level condition.

Decision from planning: **show immediately when the workspace is `UNSUPPORTED`, and extract the
common outcome‑card UI so it is reused in the session context and outside it.**

## Precondition (blocking)

- The outcome UI (`model/TurnOutcome.kt`, `views/SessionOutcomeView.kt`, `SessionState.TurnEnded`,
  `SessionMessageListPanel.outcome` wiring, `SessionUi.outcome`) exists on **`origin/main`** (commits
  `b1a8893f14`, `0116b63641`, `58b6edd04f`, `5ad8db8a6d`) but **NOT** on this branch
  (`investigate-podman-container-crash`, ~176 commits behind main).
- **Task 1 must be merging/rebasing `origin/main` into this branch** so the outcome UI is present.
  Cherry‑picking just the four commits is a fallback but rebase/merge is required before the PR
  merges anyway. Do this first; reconcile the existing partial work (below) during the merge.

## What already exists on this branch (from earlier work) and how to reconcile

- **Backend (KEEP):** `KiloWorkspaceStatusDto.UNSUPPORTED`, `KiloWorkspaceState.Unsupported(reason)`,
  `RemoteDirectory.detect(...)` short‑circuit at the top of `KiloBackendWorkspace.load()`, `dto()`
  mapping branch, the `kilo.dev.forceUnsupportedWorkspace` dev flag, and their tests. No change.
- **Frontend (REPLACE):** the `ConnectionChanged.ShowNotice` event + `ConnectionPanel.showNotice`/
  "Learn more" link + `resolveConnectionState` UNSUPPORTED→ShowNotice branch + `session.connection.notice.*`
  bundle keys were the "new way to communicate" the user rejected. These must be removed/repurposed.

## Design

1. **Backend stays the source of truth.** Workspace load short‑circuits to `Unsupported(reason)`
   before any fetch (already implemented); app stays `READY`; DTO carries `status = UNSUPPORTED`,
   `error = reason` (`devcontainer_virtual_filesystem` | `wsl_virtual_filesystem` | `invalid_virtual_path`).
2. **Reuse the outcome card, don't invent UI.** `SessionOutcomeView` (a `DialogView`/`SessionView`
   showing header icon + title + description, plus an optional scrollable error body and a
   DialogView action footer) is the single card class. It is already constructed in `SessionUi` and
   injected into `SessionMessageListPanel`; it does not depend on the transcript, so it can be reused
   standalone. Add one small method for the informational/notice case.
3. **Show immediately, no session required.** The transcript body only renders when
   `model.showSession == true`. For the UNSUPPORTED case there is no session, so route a dedicated
   body (a standalone `SessionOutcomeView`) as the session content the moment the workspace is
   UNSUPPORTED, taking precedence over the empty/recents view.
4. **No connection banner for this case.** `resolveConnectionState()` returns `Hide` for UNSUPPORTED
   (connection is healthy); retry ignores UNSUPPORTED.

## Implementation tasks (ordered)

### 1. Bring in the outcome UI
- Merge/rebase `origin/main` into this branch. Verify `SessionOutcomeView`, `TurnOutcome`,
  `SessionState.TurnEnded`, and the `SessionMessageListPanel.outcome`/`SessionUi.outcome` wiring are
  present. Keep backend UNSUPPORTED work; drop the ConnectionPanel notice work (tasks 2–3).

### 2. Remove the ConnectionPanel notice approach
- `frontend/.../session/controller/SessionControllerEvent.kt`: delete `ConnectionChanged.ShowNotice`.
- `frontend/.../session/ui/ConnectionPanel.kt`: remove `showNotice`, the `learn` ActionLink, the
  `actions` `Stack`, the `url` field, and `learnVisible()/learnText()`; restore `retry` directly at
  `BorderLayout.EAST`; remove the `ShowNotice` branch in `onEvent` and the `BrowserUtil`/`Stack` imports.
- `frontend/.../session/controller/SessionController.kt`:
  - `resolveConnectionState()`: change the `workspace.status == UNSUPPORTED` branch to return
    `ConnectionChanged.Hide` (place before the READY/warning branches). This prevents the perpetual
    "Loading…" that would otherwise occur because `workspace != READY`.
  - `retryConnection()`: keep the guard that returns early (no `workspace.reload()`) when
    `workspace.status == UNSUPPORTED`.
  - `setConnectionTargetState()`: remove the `ShowNotice` immediate‑state branch.
- `frontend/.../messages/KiloBundle.properties`: remove `session.connection.notice.*` keys.

### 3. Extract/extend the reusable outcome card
- `frontend/.../session/views/SessionOutcomeView.kt`: add an EDT method that reuses the existing
  card rendering for an informational notice, e.g.:
  `fun showNotice(title: String, description: String, tone: OutcomeTone, actions: List<DialogView.Action> = emptyList())`
  — sets header icon (WARNING for informational), `setHeader(title, description)`, `setContent(null)`,
  `setActions(actions)`, `isVisible = true`, `refresh()`. This reuses the same visual card the
  transcript uses; it is not a new surface. Confirm `DialogView` exposes `setActions`/`Action` (it
  does — used by `LoginRequiredView`/`RevertBanner`).
- Do not fork the card; the same `SessionOutcomeView` class is used in the transcript and standalone.

### 4. Route the standalone card in `SessionUi`
- `frontend/.../session/SessionUi.kt`:
  - Own a standalone `SessionOutcomeView` for the workspace notice (separate instance from the
    transcript's `outcome`), plus a body container following the `blankBody`/`progressBody` pattern,
    e.g. `unsupportedBody` hosting the standalone view. Register it with `applyStyle`.
  - `body(state)`: at the top, if `controller.model.workspace.status == KiloWorkspaceStatusDto.UNSUPPORTED`,
    return `unsupportedBody` (and populate the card via `showNotice(...)` mapping the workspace `error`
    reason to copy). This wins over `showSession`/empty/progress.
  - React to workspace changes: in the `SessionControllerEvent.WorkspaceChanged` handler (and on
    the new `ShowUnsupported` view event, task 5), re‑evaluate the body and populate the card. Keep
    `prompt.setReady(controller.model.isReady())` — prompt stays disabled since `isReady()` is false
    when workspace ≠ READY, so the card explains why input is unavailable.

### 5. Controller view routing for the unsupported case
- `frontend/.../session/controller/SessionControllerEvent.kt`: add
  `data class ShowUnsupported(val reason: String) : ViewChanged()` with a stable `toString()`.
- `frontend/.../session/controller/SessionController.kt`:
  - Add a precedence check so that when `model.workspace.status == UNSUPPORTED` (app READY), the
    controller emits `ViewChanged.ShowUnsupported(reason)` via `setControllerViewState(...)` instead
    of `ShowRecents`/`ShowSession`. Gate `canUseRecents()` (and the recents refresh at ~line 992 /
    `refreshRecents`) to return false when UNSUPPORTED so recents don't clobber the notice.
  - Handle `ShowUnsupported` in `setControllerViewState` similarly to `ShowRecents`
    (e.g. `hideAccountOverlay()` or leave account overlay untouched; do not set `model.showSession`).
- `SessionUi` handles `ViewChanged.ShowUnsupported` by clearing `empty`, populating the standalone
  `SessionOutcomeView` from `reason`, and `scroll.show(unsupportedBody)`.

### 6. Copy / content
- `frontend/.../messages/KiloBundle.properties`: add notice copy reused for all virtual‑fs reasons
  (single title + description is sufficient; the recommendation is the same), e.g.:
  - `session.unsupported.devcontainer.title=Kilo can't access this Dev Container project`
  - `session.unsupported.devcontainer.description=This project is opened through a Dev Container or remote virtual filesystem that the Kilo runtime on your machine can't reach. Run Kilo inside the container using JetBrains Remote Development, where the IDE backend runs in the container. Local projects also work.`
  - Optional: `session.unsupported.learnMore=Learn more`
  - Note: no‑argument bundle values must use a single apostrophe (`can't`), not `''` (MessageFormat
    only collapses `''` when args are passed).
- Keep the docs URL as one Kotlin constant (reuse the existing `DEVCONTAINER_URL`,
  default `https://kilo.ai/docs/jetbrains/dev-containers`). If a "Learn more" action is included,
  wire it as a `DialogView.Action` that calls `BrowserUtil.browse(url)`.
- Reason→copy mapping: map all three reasons to the same devcontainer copy for now (a `when(reason)`
  helper), so wsl/invalid paths also get a clear message. Tone = `OutcomeTone.WARNING` (informational).

### 7. Tests
- Backend (unchanged, keep passing where the env allows): `RemoteDirectoryTest` (pure, incl. forced
  flag), `KiloBackendWorkspaceTest` UNSUPPORTED cases (no `/agent` fetch), `KiloWorkspaceRpcApiImplTest`
  mapping. Note: the full backend suite can't run in this worktree because the fake‑CLI `connect()`
  helper times out here (environmental); `RemoteDirectoryTest` runs fine and should be the primary
  backend guard.
- Frontend:
  - Remove the obsolete `ConnectionPanelTest` notice test and the `ConnectionDelayTest`
    unsupported‑notice/retry tests. Replace with: UNSUPPORTED makes `resolveConnectionState` resolve
    to `Hide` (no connection banner), and `retryConnection()` does not call `projectRpc.reload`.
  - `SessionOutcomeViewTest`: add a case for the new `showNotice(...)` — asserts header icon/title/
    description render and (if included) the Learn‑more action is present.
  - Controller test: workspace `UNSUPPORTED` emits `ViewChanged.ShowUnsupported(reason)` and does
    **not** emit `ShowRecents`/`ShowSession`; `canUseRecents()` is false.
  - SessionUi/body test (or `SessionMessageListPanel`‑style test): when workspace is UNSUPPORTED the
    standalone outcome card body is shown with the devcontainer title/description.

### 8. Changeset
- Update the existing `.changeset/jetbrains-devcontainer-notice.md` (`"@kilocode/kilo-jetbrains": patch`)
  to describe the final behavior: "When a JetBrains project is opened through a Dev Container / remote
  virtual filesystem Kilo can't access, show a clear in‑chat notice (with guidance to run Kilo inside
  the container) instead of a generic loading/error state."

## Out of scope
- Actually supporting Model 2 (running the CLI in‑container via Eel/IJent, path translation). This is
  communication‑only.
- Reworking the transcript's existing failed/interrupted turn outcomes.

## Risks / edge cases
- **Merge scope:** rebasing ~176 commits may conflict on `SessionController.kt`/`ConnectionPanel.kt`/
  `SessionUi.kt`. Reverting the ConnectionPanel notice (task 2) reduces overlap with main's outcome
  changes; do task 2 as part of resolving conflicts.
- **State‑machine hygiene:** drive the notice from **workspace status** (view routing), not by
  faking a per‑session `SessionState`, to avoid corrupting the session state machine when there is no
  session.
- **Body precedence:** ensure UNSUPPORTED beats empty/recents/progress and that recents refresh does
  not overwrite it (`canUseRecents()` guard).
- **App stays READY:** global providers/config still load; only the workspace is Unsupported, so the
  rest of the UI (settings/providers) remains usable and no red connection error appears.
- **Manual repro:** `-Pkilo.dev.forceUnsupportedWorkspace=true` on a dev IDE run forces every
  workspace into UNSUPPORTED to exercise the card without a real IJent path.

## Validation
- From `packages/kilo-jetbrains/`: `./gradlew :backend:test --tests ai.kilocode.backend.workspace.RemoteDirectoryTest`
  and the frontend tests `./gradlew :frontend:test --tests …SessionOutcomeViewTest --tests …ConnectionDelayTest`
  plus the new controller/body tests. (Use module‑scoped `:backend:`/`:frontend:` task filters.)
- `./gradlew typecheck` and, where the env permits, `./gradlew test`.
- Run inspection "Plugin DevKit | Code | Frontend and Backend API Usage" (shared DTO + new frontend
  view event).
- Manual: launch split mode with `-Pkilo.dev.forceUnsupportedWorkspace=true`; confirm the in‑chat
  outcome card appears immediately, the prompt is disabled, and no red connection banner shows.

## Open items
- Confirm/replace the "Learn more" docs URL (`https://kilo.ai/docs/jetbrains/dev-containers`) and
  whether to include the Learn‑more action at all (recommended: include it as a `DialogView.Action`).
- Final copy review for the notice title/description.
