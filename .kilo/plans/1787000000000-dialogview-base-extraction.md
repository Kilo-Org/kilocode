# Extract shared DialogView base (JetBrains session dialog-style views)

Convert the existing `BaseQuestionView` "card" into a reusable base class `DialogView`
that dialog-style views **extend** instead of **composing**. Scope is entirely
`packages/kilo-jetbrains/frontend/` (Kilo-owned; no `kilocode_change` markers needed).

## Context / findings

`BaseQuestionView` (`session/views/base/BaseQuestionView.kt`) already provides the four
requested capabilities and needs no new behavior:
- base dialog shape painting — via `RoundedContentPanel` (`contentColor`/`outlineColor`/`cornerArc`)
- header + hint — `setHeader(title, description?)`, `setHeaderIcon(icon, tooltip?)`
- action buttons (text / handler / primary flag) — `Action(id, text, primary, enabled, handler)` + `setActions(...)`, plus `setActionEnabled/Visible/Text`, `setActionLeft`, `preferredActionComponent`
- content container with standard insets — `setContent(component)`, `setTopPanel`, `setSpacing`

Today every dialog-style view **composes** it (`private val card = BaseQuestionView(...)`
inside a `BorderLayoutPanel`, then `add(card, CENTER)` / `addToCenter(card)`), delegating
through `card.`. This task inverts that to inheritance.

### Consumers to convert (all add only the card to CENTER — verified safe to flatten)
- `session/views/question/QuestionView.kt` — `SessionView`
- `session/views/SessionOutcomeView.kt` — `SessionView`
- `session/views/permission/PermissionView.kt` — `SessionView, Disposable`
- `session/views/LoginRequiredView.kt` — `SessionView`
- `session/ui/RevertBanner.kt` — `SessionView`
- `migration/ui/MigrationWizardPanel.kt` — plain `JPanel(BorderLayout)`, **not** a SessionView

Other `RoundedContentPanel` users (`SessionAccountOverlay`, `DeviceOAuthPanel`,
`LoggedInProfileUi`, `SessionDropOverlay`, `SessionSurfacePanel`) are surface/overlay cards
without the header+action-button dialog pattern — **out of scope**.

## Decisions (resolved with user)

1. Rename `BaseQuestionView` → `DialogView`, keep its full API, and convert all six
   consumers from composition to inheritance. No behavior change.
2. `DialogView` stays a pure UI base: `open class DialogView(...) : RoundedContentPanel(...),
   SessionEditorStyleTarget`. It does **not** implement `SessionView`. The five session views
   keep `, SessionView`; `MigrationWizardPanel` extends `DialogView` without it.
3. `DialogView` remains concrete + `open` so the base test can still instantiate it directly
   and subclasses can extend it.
4. Keep the class in package `ai.kilocode.client.session.views.base` (migration already imports
   from there) to minimize churn.

## Inheritance contract (call out in code review)

A `DialogView` subclass **is** the rounded panel and owns the reserved BorderLayout regions
(NORTH = header/top, CENTER = content, SOUTH = actions). Subclasses must populate it only via
`setTopPanel` / `setContent` / `setActions` (+ the setter helpers) and must **not** `add()`
directly into those regions. All six current consumers already obey this.

## Tasks

1. **Rename base class + file + test.**
   - `session/views/base/BaseQuestionView.kt` → `DialogView.kt`; class `BaseQuestionView` → `DialogView`.
     Keep `open`, concrete, constructor `(selection: SessionSelection? = null, focus: (() -> Unit)? = null)`,
     supertypes `RoundedContentPanel(pad, pad, lg, pad), SessionEditorStyleTarget`, and the nested
     `data class Action`.
   - Add a `protected fun refresh()` to `DialogView` that runs `revalidate(); repaint();
     parent?.revalidate(); parent?.repaint()` (dedupe the identical private helper copied across
     QuestionView/SessionOutcomeView/LoginRequiredView/PermissionView).
   - Keep `applyStyle` as the `open`/`override` from `SessionEditorStyleTarget`.
   - Rename test `session/views/base/BaseQuestionViewTest.kt` → `DialogViewTest.kt`
     (class `BaseQuestionViewTest` → `DialogViewTest`); update all `BaseQuestionView()` → `DialogView()`.

2. **Convert `QuestionView`** to `: DialogView(selection, focus), SessionView`.
   - Remove the `card` field and `add(card, BorderLayout.CENTER)`.
   - Rewrite `card.setTopPanel/setContent/setHeader/setActions/setActionEnabled/setSpacing/
     preferredActionComponent` → same calls on `this`.
   - `BaseQuestionView.Action` → `DialogView.Action`.
   - `override fun applyStyle(style)` calls `super.applyStyle(style)` first, then its extra
     (custom editor + `texts` fonts); drop the private `refresh()` (use base).
   - Keep `addComponentListener(resize)`, `addNotify()`, `isVisible=false`, `isOpaque=false`.

3. **Convert `SessionOutcomeView`** to `: DialogView(selection, focus), SessionView`.
   - Remove `card` + `addToCenter(card)`; `card.setHeaderIcon/setHeader/setContent` → `this`.
   - Keep the private `ErrorBody`; `applyStyle` calls `super.applyStyle(style)` then `error.applyStyle(style)`.
   - Drop the private `refresh()` (use base).

4. **Convert `PermissionView`** to `: DialogView(selection, focus), SessionView, Disposable`.
   - Remove `card` + `addToCenter(card)`; all `card.*` → `this`.
   - `applyStyle` calls `super.applyStyle(style)` then its extra (desc/rules/md/diffViews).
   - Keep `dispose()`. `BaseQuestionView.Action` → `DialogView.Action`.

5. **Convert `LoginRequiredView`** to `: DialogView(selection, focus), SessionView`.
   - Remove `card` + `addToCenter(card)`; `card.*` → `this`.
   - Update test helper `buttons(card)` → `buttons(this)`.
   - Drop private `refresh()` (use base). `BaseQuestionView.Action` → `DialogView.Action`.

6. **Convert `RevertBanner`** to `: DialogView(focus = focus), SessionView, SessionEditorStyleTarget`
   (SessionEditorStyleTarget already comes from DialogView; keep `SessionView`).
   - Remove `card` + `add(card, BorderLayout.CENTER)`; `card.setTopPanel/setContent/setActions/
     setActionVisible/setActionEnabled/setActionLeft` → `this`.
   - `applyStyle` calls `super.applyStyle(style)` then its extra (title/progress/hint/notice/rows).
   - `BaseQuestionView.Action` → `DialogView.Action`. Keep `update()`'s own `revalidate/repaint`.

7. **Convert `MigrationWizardPanel`** to `: DialogView()` (no `SessionView`).
   - Remove the `question` field and `add(question, BorderLayout.CENTER)`.
   - Replace every `question.*` call (`setHeader/setContent/setActions/setActionLeft/
     setActionVisible/setActionText/setActionEnabled/preferredActionComponent`) with `this`.
   - `update()`'s `question.revalidate(); question.repaint()` becomes `revalidate(); repaint()`
     (the trailing self `revalidate/repaint` then collapses to one pair).
   - `BaseQuestionView.Action` → `DialogView.Action`. Keep callbacks, rows, `keepBox`, test helper.
   - Note: this flattens a transparent outer `JPanel` + inner rounded card into one rounded
     `DialogView`; visually equivalent because the card was the only CENTER child.

8. **Sweep references.** Grep the frontend module for any remaining `BaseQuestionView`
   (type usages, imports `...base.BaseQuestionView`, and `BaseQuestionView.Action`) and update
   to `DialogView` / `DialogView.Action`. Confirm no other file declares a field of type
   `BaseQuestionView`.

## Risks / watch-outs

- **`applyStyle` chaining:** every converted subclass must call `super.applyStyle(style)` or the
  header/description/button fonts stop updating on theme/editor-scheme changes.
- **Reserved regions:** confirm during implementation that no converted view calls `add(...)`
  (other than the removed card add) — all six currently only added the card to CENTER.
- **Test traversal:** existing per-view tests walk the component tree from the view root; the
  card's subtree is now the view's own subtree, so structural lookups still resolve. The only
  known explicit `card` reference is `LoginRequiredView.buttons(card)` (task 5). Re-check
  `QuestionViewTest`, `PermissionView`/permission tests, `RevertBanner` assertions in
  `SessionMessageListPanelTest`, and migration wizard tests for any `.card`/wrapper assumptions.
- **Visual flattening:** removing the transparent outer `BorderLayoutPanel` wrapper should be a
  no-op visually (wrapper was transparent, card filled CENTER); verify Question/Outcome/Permission/
  Login/Revert/Migration still render identically (rounded surface, insets, hover, focus).

## Validation

From `packages/kilo-jetbrains/`:
- `./gradlew typecheck`
- `./gradlew :frontend:test` (or targeted: `DialogViewTest`, `QuestionViewTest`,
  `SessionOutcomeViewTest`, permission view tests, `LoginRequiredView` tests,
  `SessionMessageListPanelTest` (RevertBanner), and `MigrationWizardPanel` tests)

## Out of scope

- Any behavior/appearance change to the dialog card itself.
- Migrating non-dialog `RoundedContentPanel` surfaces/overlays to `DialogView`.
- Changes outside `packages/kilo-jetbrains/frontend/`.

## Note

Implementation requires source edits — switch to an implementation-capable agent to execute.
