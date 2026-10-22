# JetBrains MdView Editor Theme Colors Plan

## Goal

Keep JetBrains markdown layout compact while making markdown colors and backgrounds come from the active editor color scheme, and ensure existing theme/editor-setting listeners refresh all existing `MdView` instances after changes.

## Findings

- `SessionUi` already subscribes to `EditorColorsManager.TOPIC` and `LafManagerListener.TOPIC`, then calls `applyStyle(SessionEditorStyle.current())` on the session tree.
- Most markdown consumers already propagate that style through `MdView.applyStyle(style)` via `TextView`, `ReasoningView`, message lists, and session panels.
- `PlanExitView.applyStyle()` sets only font/code font/foreground and does not call `md.applyStyle(style)`, so internal markdown role colors can stay tied to the initial style.
- `MdViewHybrid.applyStyle()` restyles retained HTML panes and code block containers, but retained `CodeField` editors need explicit reapplication of `SessionEditorStyle.applyToEditor()` after creation so syntax highlighting and editor colors follow scheme changes.
- `MdCommon.defaults()` currently mixes editor colors, UI theme colors, and one literal inline-code color fallback. The literal fallback should be removed, and markdown roles should derive from `EditorColorsScheme`/syntax attributes wherever possible.
- `TextView` currently overrides markdown background with `SessionUiStyle.Transcript.bgColor()` (`UiStyle.Colors.bg()`), while prompt markdown already uses `style.editorBackground`. If markdown surfaces should consistently use editor background, normal text views need to use `style.editorBackground` too.

## Implementation Plan

1. Keep compact CSS unchanged.
   - Do not reintroduce line-height, margin, padding, heading sizing, or other geometry rules.
   - Keep the current role color/background selectors only.

2. Derive markdown role defaults from editor settings.
   - Update `MdCommon.defaults(style)` to use `style.editorForeground` and `style.editorBackground` for primary text/background.
   - Add small local helper functions for editor attributes, for example foreground/background from `style.editorScheme.getAttributes(key)` and color keys from `style.editorScheme.getColor(key)`.
   - Use public IntelliJ editor keys for role colors:
     - Links: `CodeInsightColors.HYPERLINK_ATTRIBUTES.foregroundColor`, fallback to platform link color if absent.
     - Inline code foreground/background: `DefaultLanguageHighlighterColors.DOC_CODE_INLINE`, fallback to `STRING`, then editor foreground/background.
     - Code block foreground/background: `DefaultLanguageHighlighterColors.DOC_CODE_BLOCK`, fallback to editor foreground/background.
     - Quote/emphasis/list weak text: comment/doc-comment attributes, fallback to editor foreground or `UIUtil.getContextHelpForeground()` only when the scheme has no useful value.
     - Borders/HR/table/code border: editor preview/border color keys such as `EditorColors.PREVIEW_BORDER_COLOR`, fallback to `UiStyle.Colors.contentBorder()`.
   - Remove `JBColor(0x...)` or other literal runtime color fallbacks from `MdCommon`.
   - Keep public `MdView` API unchanged; role colors stay internal unless a concrete external override need appears.

3. Ensure style propagation reaches every markdown instance.
   - Update `PlanExitView.applyStyle(style)` to call `md.applyStyle(style)` before applying its explicit font/code-font/foreground overrides.
   - Audit existing markdown callers after the change; keep using the existing `SessionEditorStyleTarget` propagation path rather than adding per-`MdView` theme listeners.
   - Keep explicit foreground overrides in `TextView`, `ReasoningView`, and `PlanExitView` where they intentionally set body text role, but let internal markdown role colors refresh from the new style snapshot.

4. Ensure retained hybrid code blocks update after editor setting changes.
   - In `MdViewHybrid.CodeView.style(opts)`, for retained `CodeField` blocks, reapply `style.applyToEditor(editor)` to the underlying editor if it exists.
   - Reapply code editor background/scroll pane/viewport backgrounds from `opts.preBg` in the same path.
   - Preserve retained component/editor reuse: do not rebuild code block panes just to update style.

5. Align markdown backgrounds with editor settings.
   - Keep `MdCommon` default background as `style.editorBackground`.
   - Change normal `TextView` markdown background to `style.editorBackground` if the intent is that all markdown surfaces use editor background, matching `PromptView` and session root behavior.
   - Preserve `transparent` handling: when `md.opaque = false`, background should still be the editor-derived value for child/code surfaces, but the Swing component should remain non-opaque.

6. Update tests.
   - Extend `MdViewTest` to verify markdown role CSS changes when applying a `SessionEditorStyle` backed by a customized editor scheme, especially inline code, code block, link, and border colors.
   - Extend `MdViewHybridTest` to assert `applyStyle()` updates retained HTML panes and retained code editors without replacing them, including editor scheme/background changes.
   - Add or extend `PlanExitViewTest` so `applyStyle()` refreshes the nested markdown style, not just foreground/font overrides.
   - Keep existing compactness expectations: tests should not assert new spacing, padding, margin, line-height, or size rules.

## Verification

- From `packages/kilo-jetbrains/`, run `./gradlew frontend:test --tests '*MdView*'`.
- From `packages/kilo-jetbrains/`, run `./gradlew frontend:test --tests '*PlanExitViewTest*'` if the focused test is not covered by the MdView filter.
- From `packages/kilo-jetbrains/`, run `bun run typecheck`.

## Constraints

- Do not introduce JCEF, Compose, or Kotlin UI DSL.
- Do not add new theme/editor listeners in `MdView`; use the existing `SessionUi` listener and `SessionEditorStyleTarget` propagation path.
- Avoid hardcoded runtime colors in markdown styling; prefer editor scheme attributes/color keys, then platform/theme APIs as non-literal fallbacks.
- Preserve retained Swing behavior and `MdViewHybrid.sync()` component reuse.
- Keep the public `MdView` override API stable unless implementation proves a new external override is required.
