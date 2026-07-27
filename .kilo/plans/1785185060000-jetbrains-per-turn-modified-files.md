# JetBrains: per-turn "Modified files" view (VS Code parity)

Refactor the session-level "Modified files" card into a **per-turn** card rendered at the end of each
turn, matching VS Code. It keeps the same behavior we already built (collapsed header with count +
bars, hover popup, expand → in-place per-file diffs) and **persists across reopen** because the data
rides on the message, not on a live-only event.

## Data source (no CLI changes)

Per-turn diffs already exist on the wire as `message.info.summary.diffs` (a `SnapshotFileDiff[]`),
set by the CLI on the **user anchor message** of each turn (`summary.ts:142-144`). It is delivered by:

- **History / reopen**: `GET /session/{id}/message` returns each user message with `summary.diffs`.
- **Live**: the `message.updated` event carries the updated user-message info with `summary.diffs`.

Both paths funnel through one parser: `KiloCliDataParser.parseMessage(obj)` (used at line 147 for
`message.updated` and line 397 inside `parseMessages`). JetBrains currently drops `summary` because
`MessageDto` has no such field. So the whole feature is JetBrains-side only.

`SnapshotFileDiff` maps 1:1 to the existing `DiffFileDto` (`file?`, `patch?`, `additions`,
`deletions`), so no new diff type is needed.

## Turn model already fits

`SessionModel` maintains a `Turn` grouping (turn id == user anchor message id) and fires
`TurnAdded` / `TurnUpdated` / `TurnRemoved`. `TurnView` renders one turn (user anchor + following
assistant messages). The per-turn card is a trailing child of `TurnView`, fed by
`model.message(turn.id)?.info?.summary?.diffs`.

## Tasks

1. **Shared DTO — `ChatDto.kt`**
   - Add:
     ```kotlin
     @Serializable
     data class MessageSummaryDto(val diffs: List<DiffFileDto> = emptyList())
     ```
   - Add `val summary: MessageSummaryDto? = null` to `MessageDto`.

2. **Backend parse — `KiloCliDataParser.kt`**
   - Extract the inline per-file diff mapping (currently `session.diff` branch, lines 258-267) into a
     reusable `parseDiffs(elem: JsonElement?): List<DiffFileDto>`; call it from that branch (no dup).
   - In `parseMessage(obj)`, read `obj["summary"]?.jsonObject?.get("diffs")` via `parseDiffs` and set
     `summary = MessageSummaryDto(diffs)` when the array is present (otherwise `null`). This covers
     both history (`parseMessages`) and `message.updated` automatically.

3. **Refactor `ModifiedFilesView` to be turn-scoped (`session/ui/ModifiedFilesView.kt`)**
   - Drop the `model` / `model.diff` / `model.revert()` dependency and the "hide during revert" rule
     (turns are removed on revert anyway).
   - New API: constructor `(openFile: SessionFileOpener, selection: SessionSelection? = null)` plus
     `@RequiresEdt fun setDiffs(diffs: List<DiffFileDto>)`.
   - `setDiffs` maps `DiffFileDto` → `EditFileChange` (existing helper), sets
     `isVisible = files.isNotEmpty()`, updates count + `DiffBars`, and, when expanded,
     `body.updateFiles(files)`. Keep lazy body creation, `expand()`, and `headerPopup()` exactly as
     now (reuse `PatchBody` + `POPUP_OPTS` + `DiffBars`).
   - Keep `contentId = "session-modified-files"` (or rename to `"turn-modified-files"`).

4. **Host the card in `TurnView.kt`**
   - Add a lazily-created `ModifiedFilesView` kept as the **last** child of the turn.
   - `addMessage` must insert message views **before** the card: add at index
     `modified?.let { components.indexOf(it) } ?: componentCount`.
   - Add `@RequiresEdt fun setDiffs(diffs: List<DiffFileDto>)`: create+append the card on first
     non-empty diff, forward to `card.setDiffs(...)`; wire `card.hover = hover` so the popup uses the
     existing hover path. Forward `applyStyle` and dispose to the card.

5. **Drive it from `SessionMessageListPanel.kt`**
   - Helper `diffsOf(turn) = model.message(turn.id)?.info?.summary?.diffs.orEmpty()`.
   - Call `tv.setDiffs(diffsOf(turn))` at the end of `onTurnAdded`, `onTurnUpdated`, and in `rebuild()`
     for each turn (this is what makes it **persist on reopen**).
   - Handle `MessageUpdated` (currently a no-op at lines 156-162): when
     `turnViews[event.info.info.id]` exists (message is a turn anchor), call
     `tv.setDiffs(event.info.info.summary?.diffs.orEmpty())`. This is how a completing turn's diff
     appears live.

6. **Remove the session-level footer card**
   - `SessionUi.kt`: drop the `modified = ModifiedFilesView(...)` argument.
   - `SessionMessageListPanel.kt`: remove the `modified` ctor param, its `anchorFooter`/`applyStyle`/
     `clear` handling, hover wiring, and the `modified?.update()` calls in `StateChanged`,
     `RevertChanged`, `DiffUpdated`, `rebuild`, `clear`. Leave `RevertBanner` untouched (it still uses
     `model.diff`; the `session.diff` event / `model.diff` stay for the revert banner).

## Persistence verification

On reopen, `SessionController.loadSession()` → `model.loadHistory(items)` stores messages **with**
`summary` (task 2) → `rebuild()` builds turns → `setDiffs(diffsOf(turn))` renders each turn's card.
No extra RPC/fetch and no `session.diff` dependency — unlike the old session-level card, this survives
reopen natively.

## Tests

- **Backend** (`KiloCliDataParserTest`): `parseMessage` populates `summary.diffs` (file/patch/additions/
  deletions); a `message.updated` payload with summary yields `MessageUpdated` carrying it; a message
  without summary yields `summary == null`.
- **Shared** (serialization test alongside `ChatDtoSerializationTest`): `MessageDto` with/without
  `summary` round-trips.
- **`ModifiedFilesViewTest`**: rewrite to the `setDiffs` API — hidden when empty; visible + correct
  count after `setDiffs`; collapsed start (body not created); first expand builds one link + badge per
  file; popup only when collapsed; editor leak/churn test retained.
- **`TurnViewTest`** (new or extend): card is the last child and appears only when the anchor has
  diffs; `addMessage` keeps the card last; `setDiffs([])` hides it.
- **`SessionControllerTestBase` existing-session flow**: seed `rpc.history` with a user message whose
  `summary.diffs` is non-empty; assert the reopened turn renders the card (**persistence**). Also emit
  a `message.updated` with summary and assert the live card updates.
- Remove the old session-level footer assertions in `SessionMessageListPanelTest` and the
  session-scoped bits of the current `ModifiedFilesViewTest`.

## Notes / risks

- Scope matches VS Code exactly: only **user** anchor messages carry `summary.diffs`; leading
  assistant-only turns show nothing.
- Same snapshot dependency as VS Code: if `snapshot: false`, the CLI emits no diffs, so nothing shows.
- All changes live under `packages/kilo-jetbrains/` (Kilo-owned) — no `kilocode_change` markers, no
  opencode annotations. Reuse `PatchBody`, `DiffStatBadge`, `DiffBars`, `SecondarySessionPartView`,
  `HeaderPopup*`; introduce no duplicate diff/scroll/rendering code.
- Keep the existing `session.changes.*` i18n keys and the changeset.

## Validation

From `packages/kilo-jetbrains/`:
- `./gradlew :frontend:test` and `./gradlew :backend:test` (or targeted `--tests` for the classes above)
- `./gradlew typecheck`
- Manual `./gradlew runIde`: run a multi-turn session that edits files, confirm a card at the end of
  each turn (count + bars, hover popup, expand per-file diffs), then reopen the session and confirm the
  cards are still there.
