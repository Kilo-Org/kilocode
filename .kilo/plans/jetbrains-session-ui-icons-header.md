# JetBrains Session UI Icons And Header Layout Plan

## Goal
Improve JetBrains session UI icon consistency and reduce accidental header interactions:
- Use Kilo/VS Code-aligned session icons in session views.
- Fix the reasoning header icon.
- Normalize session part collapse/expand chevrons so collapsed/expanded states do not jump between differently sized glyphs.
- Move the session-details toggle away from compaction and place it before the session title.

## Findings
- Session view icons are centralized in `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/session/views/SessionViewIcons.kt` and loaded from `frontend/src/main/resources/icons/views/*.svg`.
- The JetBrains `views` SVGs already mirror the shared VS Code/UI icon paths from `packages/ui/src/components/icon.tsx` for the audited names, including `brain`, `chevron-down`, `chevron-right`, `checklist`, `console`, `warning`, etc.
- The reasoning view currently renders `SessionViewIcons.eye` in `ReasoningView.kt`; VS Code/shared UI uses the `brain` icon for reasoning/thinking surfaces, and `SessionViewIcons.brain` already exists.
- Standard collapsible session parts use `SessionViewIcons.chevronDown` when expanded and `SessionViewIcons.chevronRight` when collapsed in `AbstractSessionPartView.kt`; `QuestionResultView.kt` repeats this pattern manually. The down/right SVG paths have different visual extents.
- The session header currently places the details toggle next to the compact button in the right-side controls in `SessionHeaderPanel.kt`, making the two actions easy to confuse.

## Implementation Steps
1. **Keep icon sources aligned with VS Code/shared UI**
   - Treat `packages/ui/src/components/icon.tsx` as the source for Kilo web/session glyph shapes.
   - Re-check `SessionViewIcons.kt` entries against available JetBrains assets; only update or add SVGs if a session view uses a Kilo icon missing from `frontend/src/main/resources/icons/views/`.
   - Preserve JetBrains SVG theming rules: no `currentColor`; use literal palette colors and dark variants where assets are added or changed.

2. **Fix reasoning icon**
   - In `ReasoningView.kt`, change the reasoning header glyph from `SessionViewIcons.eye` to `SessionViewIcons.brain`.
   - Add or update test coverage in `ReasoningViewTest.kt` by inspecting the rendered Swing label tree and asserting the reasoning icon is `SessionViewIcons.brain`.

3. **Normalize collapse/expand chevrons for session parts**
   - Stop using the mixed `chevronRight`/`chevronDown` pair for collapsible session content.
   - Use a single base Kilo chevron glyph for both states, matching the current custom chevron used by the session header (`/icons/chevron-down.svg` / equivalent `SessionViewIcons.chevronDown`).
   - Add a shared rotated icon for the opposite state instead of switching to a differently sized right-facing asset. Prefer a small reusable helper or centralized icon field rather than importing header-specific UI into session views.
   - Update `AbstractSessionPartView.kt` and `QuestionResultView.kt` to use the normalized chevron pair.
   - Leave `QuestionView.kt` navigation chevrons alone unless auditing shows they are being used for collapse/expand; those are previous/next controls, not expand/collapse controls.

4. **Relocate and change header show/hide details toggle**
   - In `SessionHeaderPanel.kt`, replace the custom header details chevron with platform `AllIcons` arrows/chevrons, e.g. collapsed = `AllIcons.General.ArrowRight`, expanded = `AllIcons.General.ArrowDown`.
   - Move the details toggle out of the right-side controls and into `BorderLayout.WEST` of the header row.
   - Rebuild the top header as:
     - outer border layout
     - west: details toggle button
     - center: inner border layout
     - inner center: session title
     - inner east: horizontal stack/row with price/context and compact button
   - Remove the details toggle from the right-side row so compaction remains visually separate from show/hide details.
   - Keep existing tooltip/accessibility strings and expansion persistence behavior unchanged.

5. **Tests**
   - Update `SessionHeaderPanelTest.kt` to assert:
     - collapsed/expanded header details icons use the selected `AllIcons` constants;
     - the details toggle persists expansion state as before;
     - the details toggle is parented/laid out separately from the compact button.
   - Update `AbstractSessionPartViewTest.kt` to assert collapsible parts keep the same icon dimensions across collapsed/expanded states and no longer use the mismatched right/down pair.
   - Update `QuestionResultViewTest.kt` similarly because it has its own chevron implementation.
   - Update `ReasoningViewTest.kt` for the brain icon.

6. **Verification**
   - Run the smallest relevant JetBrains checks from `packages/kilo-jetbrains/`:
     - `./gradlew test --tests "ai.kilocode.client.session.views.ReasoningViewTest" --tests "ai.kilocode.client.session.views.base.AbstractSessionPartViewTest" --tests "ai.kilocode.client.session.views.QuestionResultViewTest" --tests "ai.kilocode.client.session.ui.header.SessionHeaderPanelTest"`
     - `./gradlew typecheck`
   - If the filtered Gradle test syntax is not accepted by the project, run `./gradlew test` from `packages/kilo-jetbrains/` instead.

## Notes
- No shared upstream `opencode` files are involved; changes stay under `packages/kilo-jetbrains/`.
- A changeset may be needed because this is user-facing JetBrains UI polish; confirm existing changeset policy for the private JetBrains package during implementation.
