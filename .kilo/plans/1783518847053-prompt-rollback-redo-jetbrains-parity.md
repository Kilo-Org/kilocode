# Prompt Rollback + Redo — JetBrains Parity

Bring the VS Code "rollback / redo" (CLI `revert` / `unrevert`) feature to the JetBrains plugin, and fix the misleading VS Code hint string. Implementation-capable agent required — this plan touches source and tests.

## Context (verified)

- CLI already exposes everything needed; no CLI release or SDK regen required. Pinned CLI version is `7.4.1` (`packages/kilo-jetbrains/package.json`).
  - `POST /session/{id}/revert` body `{ messageID, partID? }`, `POST /session/{id}/unrevert`.
  - `Session.revert?: { messageID, partID?, snapshot?, diff? }` — `packages/sdk/js/src/gen/types.gen.ts:554`. Pushed via `session.updated` SSE.
- VS Code entry points: `RevertBanner.tsx`, `VscodeSessionTurn.tsx`, `session.tsx` context. Per-user-message rollback restores reverted prompt text into the input; redo banner shows count + per-file diff stats + Redo / Redo All + hint; reverted messages/parts hidden (`id >= revert.messageID`, partID partial-turn boundary).
- JetBrains split-mode packages differ from AGENTS.md's stated `ai.kilocode.jetbrains`; actual source roots are:
  - shared → `packages/kilo-jetbrains/shared/src/main/kotlin/ai/kilocode/rpc/`
  - backend → `packages/kilo-jetbrains/backend/src/main/kotlin/ai/kilocode/backend/`
  - frontend → `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/`
- All target files confirmed to exist: `SessionDto.kt`, `KiloSessionRpcApi.kt`, `KiloBackendChatManager.kt`, `KiloSessionRpcApiImpl.kt`, `KiloSessionService.kt`, `SessionController.kt`, `SessionModel.kt`, `SessionModelEvent.kt`, `SessionView.kt`, `MessageView.kt`, `MessageToolbar.kt`, `PromptPanel.kt`, `PromptEditorTextField.kt`, plus reuse targets `DiffStatBadge.kt`, `HoverIcon.kt`, `PermissionDiffView.kt`.

## Decisions

- **Reuse `DiffStatBadge`** (already the shared per-file +/- renderer used by `PermissionDiffView`) for the banner's per-file diff rows. No new diff-stat component.
- **Reuse the existing user-prompt hover toolbar (`MessageToolbar`)** for the per-message rollback control.
- **Reuse the existing `session.updated → model.setSession(...)` pipeline** for the revert boundary; no new SSE handling.
- **Stale non-English hint strings: reset all to the new English value** and flag for re-translation (applies to VS Code locales; JetBrains base bundle only, others fall back).

## Part A — VS Code string fix

File: `packages/kilo-vscode/webview-ui/src/i18n/en.ts:138`

- Change `revert.banner.hint` from `"Send a new message to make this permanent"` to `"You can redo these changes until you send a new message"`.
- In the 19 non-English locale files under `packages/kilo-vscode/webview-ui/src/i18n/` (ar, br, bs, da, de, es, fr, it, ja, ko, nl, no, pl, ru, th, tr, uk, zh, zht), overwrite `revert.banner.hint` with the identical new English string; leave a note that these need re-translation.
- Do not touch the other revert keys (`revert.banner.count_one`, `revert.banner.count_other`, `revert.banner.redo`, `revert.banner.redo.all`, `revert.disabled.agentBusy`) — only the hint changes meaning.

## Part B — JetBrains implementation

### 1. Shared (DTO + RPC contract)

- `shared/.../rpc/dto/SessionDto.kt`: add `val revert: SessionRevertDto? = null`; add `@Serializable data class SessionRevertDto(val messageID: String, val partID: String? = null, val snapshot: String? = null, val diff: String? = null)`. Field names must match CLI JSON for kotlinx auto-mapping through `session.updated`.
- `shared/.../rpc/KiloSessionRpcApi.kt`: add
  - `suspend fun revert(id: String, directory: String, messageID: String, partID: String?)`
  - `suspend fun unrevert(id: String, directory: String)`

### 2. Backend (RPC impl + HTTP)

- `backend/.../app/KiloBackendChatManager.kt`: add `revert(id, dir, messageID, partID?)` → `POST /session/$id/revert?directory=…` with `{messageID, partID?}` body, and `unrevert(id, dir)` → `POST /session/$id/unrevert?directory=…`. Mirror the existing `compact()` OkHttp pattern; add JSON body builders to `KiloCliDataParser`.
- `backend/.../rpc/KiloSessionRpcApiImpl.kt`: implement both, resolve worktree dir via `sessions.getDirectory(id, directory)`, wrap in `ready { }` like `compact`/`abort`.

### 3. Frontend service

- `frontend/.../app/KiloSessionService.kt`: add `suspend revert(...)` / `unrevert(...)` wrappers over the RPC, using `durable {}` per split-mode rules.

### 4. Frontend controller (`session/controller/SessionController.kt`)

- Add EDT-entry actions dispatched to the coroutine scope:
  - `revert(messageID, partID?)`
  - `unrevert()`
  - `redo()` — mirror `RevertBanner.handleRedo`: find the next user message after the boundary and revert to it; `unrevert()` if none.
  - `redoAll()` → `unrevert()`.
- Revert boundary already arrives via `is ChatEventDto.SessionUpdated -> model.setSession(...)` — no new SSE handling.
- On revert, restore the reverted user prompt text into the input (`session/ui/prompt/PromptPanel.kt` / `PromptEditorTextField`); on full redo (`redoAll` / final `unrevert`), clear it — matching VS Code and TUI.

### 5. Frontend model (`session/model/SessionModel.kt`, `SessionModelEvent.kt`)

- Add `SessionModelEvent.RevertChanged(revert: SessionRevertDto?)` with a stable `toString()`, fired from `setSession()` when the revert value changes. Reset in `loadHistory()` and `clear()`.
- Add derived helpers: `revert(): SessionRevertDto?` and `revertedCount()` (count of user messages with `id >= boundary`, mirroring `session.tsx`).
- Transcript hiding: expose whether a message id is hidden by the boundary (`id >= revert.messageID`, with partID partial-turn handling), applied both to newly-arriving messages and on `RevertChanged`.
- Follow the AGENTS.md "Adding a New Event" checklist (event subclass → model field + mutation + resets → controller handling → `-> Unit` stubs in exhaustive `when` blocks).

### 6. Frontend views

- New `session/ui/RevertBanner.kt` Swing view, built once and mutated via `update()` per retained-Swing rules. Listens to `RevertChanged` + `DiffUpdated`. Contents:
  - arrow-left icon + count label (localized count.one/other),
  - per-file diff rows reusing `ai.kilocode.client.ui.DiffStatBadge` fed from `model.diff` (`DiffFileDto.additions/deletions`),
  - Redo button → `controller.redo()`, Redo All (only when count > 1) → `controller.redoAll()`,
  - hint label (same new wording as Part A).
  - Placed in `session/ui/SessionView.kt` at the bottom of the transcript, above the prompt input; shown only when `revert != null`.
- Per-user-message rollback control in `session/views/MessageView.kt`: user prompt bubbles already carry a hover `promptToolbar` (`MessageToolbar` with copy) + `promptHover` state. Add a rollback `HoverIcon` (arrow-left) alongside copy for user messages, wired through `SessionView → controller.revert(msgId)`. Disable/hide while the agent is busy or when there are no assistant messages after it, with the `revert.disabled.agentBusy` tooltip — mirroring `VscodeSessionTurn` `onRevert` + `data-revert-disabled`. Extend `MessageToolbar.kt` to host the extra action (or add a sibling control).
- Apply transcript hiding: `SessionView`/`TurnView` toggle `MessageView` visibility on `RevertChanged` (prefer visibility toggle over rebuild, per Swing lifecycle guidance).

### 7. i18n (`frontend/src/main/resources/messages/KiloBundle*.properties`)

- Add to base `KiloBundle.properties`: `revert.banner.count.one`, `revert.banner.count.other`, `revert.banner.redo`, `revert.banner.redo.all`, `revert.banner.hint` (new wording), `revert.disabled.agentBusy`.
- Other locale bundles fall back to base until translated; do not add stale translations.

### 8. Tests

- Backend: extend `KiloSessionRpcApiImplTest` / a `KiloBackendChatManager` test against `MockCliServer` asserting the exact HTTP path + JSON body for `revert`/`unrevert`, and that a session carrying `revert` deserializes into `SessionRevertDto`.
- Frontend controller (`SessionControllerTestBase` + `FakeSessionRpcApi`, add revert/unrevert call tracking): `revert()`/`unrevert()`/`redo()`/`redoAll()` hit the right RPC; `RevertChanged` fires; count logic; reverted messages hidden and restored; prompt-text restore on revert / clear on full redo.
- Frontend views (`BasePlatformTestCase`): `RevertBanner` renders count + per-file `DiffStatBadge` + redo buttons (Redo All only when count > 1); `MessageView` shows the rollback control on user messages and disables it while busy; retained-component assertions (`assertSame`, bounded count) per Swing lifecycle rules.

## Deliverables

| Area | Files |
|---|---|
| VS Code string | `webview-ui/src/i18n/en.ts` + 19 non-English locale hints reset |
| Shared | `SessionDto.kt` (+`SessionRevertDto`), `KiloSessionRpcApi.kt` |
| Backend | `KiloBackendChatManager.kt`, `KiloCliDataParser`, `KiloSessionRpcApiImpl.kt` |
| Frontend service/controller/model | `KiloSessionService.kt`, `SessionController.kt`, `SessionModel.kt`, `SessionModelEvent.kt` |
| Frontend views | new `RevertBanner.kt` (reusing `DiffStatBadge`), `MessageView.kt`, `MessageToolbar.kt`, `SessionView.kt`, `PromptPanel.kt` |
| i18n | `KiloBundle.properties` |
| Tests | backend RPC/chat-manager, frontend controller + view tests, `FakeSessionRpcApi` |

## Validation

- VS Code string change: `bun run typecheck` from repo root (or from `packages/kilo-vscode/`).
- JetBrains: `./gradlew typecheck` and `./gradlew test` from `packages/kilo-jetbrains/` (Java 21).
- Manual: `./gradlew runIde` (or split mode) to exercise rollback → redo → redo-all and reverted-transcript hiding.

## Risks / Notes

- Confirm no `kilocode_change` markers are needed for the VS Code i18n edits (Kilo-owned webview path — none required).
- Reset (not delete) is chosen for VS Code locale hints, so the fallback path is not relied upon; flag the 19 files for re-translation.
- Keep new Kotlin identifiers single-word per repo style; annotate EDT/model-touching methods with `@RequiresEdt`; wrap frontend RPC in `durable {}`.
