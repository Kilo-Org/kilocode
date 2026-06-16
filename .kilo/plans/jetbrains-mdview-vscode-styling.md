# JetBrains MdView VS Code Styling Plan

## Goal

Improve JetBrains markdown output so assistant/user transcript markdown visually matches the VS Code webview markdown style while keeping the existing Swing/JBHtmlPane + editor-backed code block architecture.

## Findings

- VS Code markdown styling is split across `packages/ui/src/components/markdown.css`, `packages/kilo-ui/src/components/markdown.css`, `packages/kilo-ui/src/styles/vscode-bridge.css`, and message-part overrides.
- Base VS Code markdown uses 14px sans text, 160% line height, tight first/last margins, same-size medium headings, 12px paragraph spacing, link-colored anchors, compact lists, weak list markers, weak blockquotes with a 2px left border, invisible HR spacing, bordered/padded code blocks, green inline code, and lightly bordered tables.
- The VS Code theme bridge maps markdown roles to editor/theme tokens: heading/link/list/image use `textLinkForeground`, text/strong/code-block use editor foreground, inline code uses charts/syntax green, quote/emphasis use description foreground, HR uses panel border.
- JetBrains markdown is rendered by `MdViewHybrid` and `MdViewHtmlPane`, with shared CSS from `MdCommon.rules()` and defaults from `MdCommon.defaults()`.
- JetBrains currently styles only broad tag font/color, links, code/pre colors, blockquote border/text color, and table border. It lacks VS Code-equivalent spacing, heading/strong/emphasis/list marker/table cell rules, inline-code foreground, blockquote geometry, HR spacing, and code block surface polish.
- JetBrains fenced code blocks are already stronger than VS Code in one respect: they use `EditorTextField` with real IDE syntax highlighting and streaming retention. Preserve this instead of switching to web/JCEF rendering.

## Implementation Plan

1. Expand JetBrains markdown style tokens.
   - Add internal fields to `MdStyle` for heading, strong, emphasis, inline code foreground, list marker, HR, table/header, and code block border colors.
   - Keep the public `MdView` override API stable unless a new external override is clearly needed.
   - Compute defaults in `MdCommon.defaults(style)` from IntelliJ/editor theme sources and centralized Kilo semantic colors where no platform key matches.
   - Use `JBColor.namedColor("Kilo.Markdown.*", fallback)` for Kilo-specific markdown palette fallbacks, so themes can override them and runtime code avoids scattered hardcoded colors.

2. Mirror VS Code markdown CSS in `MdCommon.rules()`.
   - Add root/body wrapping rules: max width behavior, break-word wrapping, base line-height, and first/last-child margin trimming where supported by `JBHtmlPane` CSS.
   - Add heading rules: same base size, medium/bold weight, role-specific color, line height, and bottom spacing.
   - Add paragraph, list, list item, nested list, and marker rules. If Swing HTML does not support `::marker`, fall back to `li { color: ... }` plus child text color reset only if supported; otherwise keep list text normal and document the limitation in tests.
   - Add strong/emphasis colors matching VS Code token roles.
   - Add anchor styling matching VS Code: themed link color, no forced background, and underline behavior where `JBHtmlPane` supports it.
   - Add blockquote geometry: 2px left border, 24px vertical margin, 8px left padding, weak text, and normal style.
   - Add table layout rules: collapse borders, full width where possible, 24px vertical margin, 12px cell padding, weak row borders, stronger header text.
   - Keep HRs visually hidden but spaced consistently with VS Code if the renderer includes them. `MdViewHybrid` currently filters thematic breaks, so this mainly benefits `MdViewHtmlPane` and future reuse.
   - Add inline-code foreground and medium font weight. Avoid inline code backgrounds unless the current `JBHtmlPane` configuration already draws them acceptably.

3. Polish JetBrains code block containers without losing IDE highlighting.
   - Keep `EditorTextField` for fenced/indented blocks and `JBTextArea` fallback.
   - Style `JBScrollPane` code blocks to match VS Code’s `markdown-code` wrapper feel: subtle background, subtle border, rounded-ish platform arc if feasible, 12px-ish padding, and thin horizontal scrollbar behavior.
   - Use `SessionUiStyle.View.Code` for geometry constants. Add only minimal new constants there if current values cannot represent the VS Code spacing.
   - Separate code block border color from table border internally so table styling can change without affecting code boxes.
   - Continue applying `SessionEditorStyle.applyToEditor(ed)` so code blocks follow IDE syntax highlighting and editor font changes.

4. Add file/path affordance parity where safe.
   - For markdown links whose `href` looks like a relative file path, keep existing link dispatch so the current caller can open files/URLs appropriately.
   - Consider decorating inline code that looks like a path with a `file-link` class only when an `openFile` callback is available through the existing usage path. If the current `MdView` abstraction only has `openUrl`, do not widen it unless the call sites can pass file opening cleanly.
   - At minimum, make inline code/path-looking content visually closer to VS Code by using the inline-code foreground and dotted underline for explicit file links where generated HTML contains link/code classes.

5. Preserve retained Swing behavior.
   - Keep `MdViewHybrid.sync()` prefix reuse logic unchanged unless necessary.
   - Ensure style updates call `reloadCssStylesheets()` and reassign text only for retained `JBHtmlPane` blocks, not by rebuilding all blocks.
   - Keep streaming fenced-code fast path and editor disposal behavior intact.

6. Add focused tests.
   - Extend `MdViewTest` and/or `MdViewHybridTest` to assert `overrideSheet()` contains the new VS Code-equivalent rules for headings, strong/emphasis, links, inline code foreground, list/table/blockquote spacing, HR, and code block/table border separation.
   - Add component tests for code block pane styling: background, viewport background, border color, padding, scrollbar policy, and retained editor instance after `applyStyle()`.
   - Keep existing stress/leak tests green. Add a small stress assertion only if the implementation changes style application semantics.
   - Add a changeset: `@kilocode/kilo-jetbrains` patch with user-facing wording such as `Improve markdown readability in JetBrains chat transcripts.`

## Verification

- Run targeted JetBrains markdown tests first from `packages/kilo-jetbrains/`: `./gradlew frontend:test --tests '*MdView*'` if the Gradle module supports it; otherwise run the closest supported targeted Gradle test command.
- Run `bun run typecheck` from `packages/kilo-jetbrains/`.
- If targeted Gradle filtering is unreliable, run `./gradlew test` from `packages/kilo-jetbrains/`.

## Constraints

- Do not introduce JCEF, Compose, or Kotlin UI DSL.
- Keep changes inside `packages/kilo-jetbrains/` and `.changeset/` unless a shared Kilo UI source of truth is explicitly required.
- No `kilocode_change` markers are needed for JetBrains or Kilo UI paths.
- Prefer IntelliJ theme APIs and centralized semantic tokens over scattered literal colors.
