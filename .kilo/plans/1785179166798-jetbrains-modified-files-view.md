# JetBrains: Session "Modified files" view

Add a VS Code–style **"Modified N files"** card to the JetBrains chat transcript. It behaves like
the existing `apply_patch` / write tool card (expand shows in-place per-file diffs; collapsed shows a
hover popup) but is fed by the **whole-session cumulative diff** and styled like VS Code.

## Decisions (resolved)

- **Scope**: Whole-session cumulative diff. Source = existing `SessionModel.diff: List<DiffFileDto>`
  (fed by the `session.diff` SSE event, already parsed **with per-file `patch`** in
  `KiloCliDataParser.kt:256-268`). **No backend / shared DTO / CLI changes.**
- **Behavior**: Reuse `SecondarySessionPartView` (expand/collapse + hover-popup) and `PatchBody`
  (per-file sections: filename link + `DiffStatBadge` + unified diff), exactly like `EditToolView`.
- **Look**: Header reads like VS Code — a "Modified" label, an "N file(s)" count, and a compact
  5-block add/delete **bars** meter (mirrors `packages/ui/src/components/diff-changes.tsx` `variant="bars"`).
- **Placement**: One session-level card in the transcript footer, wired like `RevertBanner`.
- **Visibility**: Shown when `model.diff` is non-empty **and** no revert is pending. When a revert is
  pending, `RevertBanner` (which already lists the same files) takes over, so hide this card to avoid
  duplication.
- **No "open full changes" action** — patch-style expand/popup only (matches the requested behavior).

## Key reuse points (do NOT duplicate)

- `SecondarySessionPartView` (`session/views/base/`) — arrow, expand/collapse, header hover bg, popup hook.
- `PatchBody` (`session/views/tool/PatchBody.kt`) — per-file diff sections. Currently `Tool`-coupled;
  decouple it to render from `List<EditFileChange>` (see Task 2).
- `EditFileChange` + `diffStat`/patch helpers (`session/views/tool/ToolSupport.kt`) — `internal`, reuse from frontend.
- `DiffStatBadge` (`ui/DiffStatBadge.kt`) — per-file +/- pill (already used inside `PatchBody`).
- `HeaderPopupRequest` / `HeaderPopupBody` + `POPUP_OPTS` (`EditToolView.kt`) — collapsed popup body.
- Footer wiring: `SessionMessageListPanel` `banner`/`anchorFooter`/`onHover` path and `SessionUi:356-373`.

## Data flow

`session.diff` SSE → `KiloCliDataParser` → `ChatEventDto.SessionDiffChanged` →
`SessionController.handle` → `model.setDiff` → `SessionModelEvent.DiffUpdated` →
`SessionMessageListPanel` (already listens at line 160) → `ModifiedFilesView.update()`.

## Tasks

1. **`DiffBars` widget** — new `frontend/.../ui/DiffBars.kt`.
   - Small `JPanel` painting 5 rounded blocks; color each block add vs delete vs neutral by ratio of
     `additions`/`deletions` (port the block-count logic from `diff-changes.tsx`: `TOTAL_BLOCKS = 5`).
   - Colors: `UiStyle.Colors.addedForeground()`, `removedForeground()`, `weak()` (neutral). Sizes via
     `JBUI.scale`. `fun update(additions, deletions)`. Antialiased `paintComponent` like `DiffStatBadge`.

2. **Decouple `PatchBody` from `Tool`** — `session/views/tool/PatchBody.kt`.
   - Extract the render core to operate on `List<EditFileChange>`: add `mountFiles(files)`,
     `updateFiles(files): Boolean`, and make `rebuild`/`signatureOf` take the list.
   - Keep `EditBody` conformance for `EditToolView`: `mount(tool) = mountFiles(editFiles(tool))`,
     `update(tool) = updateFiles(editFiles(tool))`. No behavior change for `EditToolView`.
   - Verify `EditToolViewTest` still passes unchanged.

3. **`DiffFileDto` → `EditFileChange` mapping** — small `internal` helper (in `ToolSupport.kt` or the
   new view file): `path = file`, `additions`, `deletions`, `patch = patch ?: ""`, `type = ""`.
   Filter out entries with blank patch (matches `PatchBody.rebuild` filter).

4. **`ModifiedFilesView`** — new `frontend/.../session/ui/ModifiedFilesView.kt`, sits beside
   `RevertBanner`, extends `SecondarySessionPartView`.
   - Ctor: `(model: SessionModel, openFile: SessionFileOpener, selection: SessionSelection?)`.
   - Header (custom `JPanel`, VS Code look): "Modified" label + count label ("{0} file(s)") + `DiffBars`.
     `SecondarySessionPartView` adds the expand arrow to the header row automatically.
   - Body (lazy, in `content = { ... }`): a `PatchBody` mounted via `mountFiles(files())` where
     `files()` maps `model.diff`.
   - `update()` (call on `DiffUpdated`/`HistoryLoaded`/`Cleared`/state change): compute `files()`;
     set `isVisible = files.isNotEmpty() && model.revert() == null`; update count label + `DiffBars`
     (sum additions/deletions); if expanded, `body.updateFiles(files)`; else leave lazy body untouched.
     Compare-before-assign; `revalidate()/repaint()` only when something changed (retained-Swing rule).
   - `override expand()`: call `super.expand()`, then `body.updateFiles(files())` + `body.applyStyle`.
   - `override headerPopup()`: return `null` when expanded or `files()` empty; else a
     `HeaderPopupRequest(row) { ... }` building a **second** `PatchBody(POPUP_OPTS)` mounted from
     `files()` in `HeaderPopupBody(..., WIDE_MAX_WIDTH)`. Send `Telemetry.send("Header Popup Shown",
     mapOf("surface" to "session", "tool" to "changes"))` in `shown`.
   - Implement `SessionEditorStyleTarget.applyStyle` → forward to `PatchBody` + header fonts.
   - `contentId` = a stable constant (e.g. `"session-modified-files"`).

5. **Wire into the transcript** — `session/ui/SessionMessageListPanel.kt` + `session/SessionUi.kt`.
   - Add ctor param `modified: ModifiedFilesView? = null` (mirror `banner`).
   - In `init`, set `modified?.hover = ::hover` so collapsed-popup uses the existing `onHover`→
     `HeaderPopupController` path (like tool part views).
   - Call `modified?.update()` from the `DiffUpdated`, `RevertChanged`, `StateChanged` branches and in
     `rebuild()`/`clear()` (alongside the existing `banner?.update()` calls at lines 147/161/297/325).
   - Add `modified` to `anchorFooter()` (place before `banner`) and to `applyStyle()`.
   - In `SessionUi.kt:356` construct
     `modified = ModifiedFilesView(controller.model, fileLinks::open, selection)` and pass it in.

6. **i18n** — add to `frontend/src/main/resources/messages/KiloBundle.properties` (base only; other
   locales fall back):
   - `session.changes.modified=Modified`
   - `session.changes.count.one={0} file`
   - `session.changes.count.other={0} files`

7. **Tests** — `frontend/src/test/.../session/` (extend `SessionControllerTestBase` / `BasePlatformTestCase`).
   - `ModifiedFilesViewTest`: hidden when `model.diff` empty; visible + correct count/bars after
     `setDiff`; hidden while a revert is pending; collapsed start (body not created); first `expand()`
     creates `PatchBody` sections once (filename link + `DiffStatBadge` + diff per file); collapse
     detaches, re-expand reuses same instance; `headerPopup()` returns a request only when collapsed &
     non-empty; `update()` on new diff mutates existing labels without rebuilding when collapsed.
   - Editor **leak/stress** test (code-editor-bearing view, per plugin rules): drive many `setDiff`
     churn + expand/collapse cycles; assert `EditorFactory.getInstance().allEditors.size` returns to a
     baseline captured before the loop, and retained component identity holds (`assertSame`).
   - Extend `SessionMessageListPanelTest` to assert the footer contains `ModifiedFilesView` and that a
     `DiffUpdated` event drives its visibility/count.
   - Confirm `EditToolViewTest` and `PatchBody` behavior unchanged after the Task 2 refactor.

## Risks / notes

- **`patch` availability**: `session.diff` parsing already includes `patch` (`KiloCliDataParser.kt:265`),
  so in-place diffs render without extra fetches. If a future CLI omits patches, `PatchBody` filters
  blank-patch files — the header still shows count/bars but the body may be empty; acceptable.
- **Duplication with `RevertBanner`**: mitigated by the "hide while revert pending" rule (Task 4).
- **New visual element**: `DiffBars` is genuinely new (no JetBrains equivalent), so it is not
  duplication; keep it minimal and theme-derived. Do not touch `DiffStatBadge` (reused as-is inside `PatchBody`).
- **EDT / retained Swing**: all methods `@RequiresEdt`; mutate existing components in `update()`, lazy
  body creation, compare-before-assign — follow the plugin's retained-Swing conventions.
- **Shared-code guard**: everything is under `packages/kilo-jetbrains/` (Kilo-owned) — no `kilocode_change`
  markers and no opencode annotations required.

## Validation

From `packages/kilo-jetbrains/`:
- `./gradlew typecheck`
- `./gradlew test` (or targeted `--tests "*ModifiedFilesViewTest"`, `"*EditToolViewTest"`,
  `"*SessionMessageListPanelTest"`)
- Manual: `./gradlew runIde`, run a session that edits files; confirm the collapsed "Modified N files"
  card with bars, hover popup, expand showing per-file diffs, and that it disappears when a revert is pending.
