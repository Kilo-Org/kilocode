---
name: jetbrains-ui
description: Use when writing or reviewing UI code in packages/kilo-jetbrains/ — Swing layout, platform components, UiStyle tokens, theme colors/fonts/borders, Stack/Align layouts, tool windows/dialogs/popups/notifications, settings pages, and the pre-return UI checklist.
---

# JetBrains Plugin UI Guidelines

Detailed UI reference for `packages/kilo-jetbrains/`. See `packages/kilo-jetbrains/AGENTS.md` for the hard restrictions (no Compose/DSL/JCEF) and the reuse-first index; this skill covers the how.

## Technology Choices

**Do not use Kotlin UI DSL v2 (`com.intellij.ui.dsl.builder`) in this plugin.** Use standard Swing with IntelliJ Platform components for all UI layout. The JetBrains modular template and some older sections of the codebase reference the DSL, but Kilo should not introduce it.

**Do not use Kotlin Compose or `intellij.platform.compose` in this plugin.** The JetBrains modular template uses Compose for its demo tool window, but Kilo should use standard Swing with IntelliJ Platform components only. Keep all plugin UI in the existing Swing-based stack.

**Do not use JCEF (`JBCefBrowser`) in this plugin.** JCEF does not work in JetBrains remote development (split mode): the frontend process runs on the client machine but JCEF requires a display on the host, making it effectively unusable for remote users. Use standard Swing with IntelliJ Platform components for all UI.

| Need | API |
|---|---|
| Any layout, forms, panels | Standard Swing with IntelliJ Platform component replacements |
| Tool windows | `SimpleToolWindowPanel` + `ToolWindow.contentManager` |
| Menus and toolbars | [Action System](https://plugins.jetbrains.com/docs/intellij/action-system.html) |
| Dialogs | Extend `DialogWrapper` |

## Style Tokens

**`UiStyle`** (`frontend/src/main/kotlin/ai/kilocode/client/ui/UiStyle.kt`) is the single source of truth for reusable UI constants in this plugin.

Before introducing any new reusable color, spacing value, border, size, font, or helper:

1. Check the IntelliJ source (`$INTELLIJ_REPO`) or public repository for an existing standard API or named key (e.g. `JBUI.CurrentTheme.*`, `UIUtil.*`, `NamedColorUtil.*`, `JBColor.namedColor(...)`, `JBFont.*`).
2. If a standard platform key exists, use it directly — do not copy the value into `UiStyle`.
3. If no standard key fits, add the new reusable token to `UiStyle`. Do not scatter constants into component-local fields, pass them through constructors, or duplicate them across files.

`UiStyle` contents:
- `UiStyle.Gap` — DPI-aware spacing primitives (`xs`, `sm`, `md`, `lg`, `pad`). Use for borders, gaps, and insets anywhere in the plugin.
- `UiStyle.Colors` — theme-aware generic colors (`bg`, `fg`, `weak`, `editorBackground`, `errorLabelForeground`, `warningLabelForeground`).
- `UiStyle.Components` — small reusable Swing helpers (e.g. `transparent()`).

**`SessionUiStyle`** (`frontend/src/main/kotlin/ai/kilocode/client/session/ui/style/SessionUiStyle.kt`) owns static tokens specific to the chat/session UI:
- `SessionUiStyle.SessionLayout` — transcript list geometry and scroll increments.
- `SessionUiStyle.View` — card sizing, card borders, surfaces, hover colors, and nested objects for `Prompt`, `Reasoning`, `Message`, and `Tool`.
- `SessionUiStyle.RecentSessions` — recent sessions list limits.
- `SessionUiStyle.Timeline` — activity-indicator colors for the session header timeline.

Rules:
- Generic layout constants (gaps, generic colors, reusable helpers) → `UiStyle`.
- Session-specific constants (transcript layout, prompt chrome, card geometry, session colors) → `SessionUiStyle`.
- Do not create extra fields whose only purpose is to hold a constant value. Reference the constant object directly, e.g. `UiStyle.Gap.lg()` or `SessionUiStyle.View.Prompt.EDITOR_LINES`.
- Do not pass style constants through constructors or method parameters. Using the constant directly at the call site is correct and preferred. Only introduce parameters for values that are genuinely variable or test-controlled.

## Primary UI Rules

- Use IntelliJ platform components instead of raw Swing where an equivalent exists (see [Platform Components](#platform-components-and-utilities) table below).
- When implementing a new user-facing action, consider adding metrics so usage can be tracked.
- Do not set default Swing properties explicitly. Avoid `isOpaque = false` unless the component default differs or there is a documented rendering reason.
- Avoid hardcoded dimensions, colors, and font sizes — use the platform style APIs described in [Theme-Derived Colors](#theme-derived-colors), [Theme-Derived Fonts](#theme-derived-fonts), and [Borders, Insets, and Spacing](#borders-insets-and-spacing).
- Put user-visible strings in `*.properties` files.
- Do not add decorative helper functions, wrappers, or defensive UI code unless they materially improve clarity or correctness.

## Platform Components and Utilities

Use IntelliJ platform components instead of raw Swing. Inspection `Plugin DevKit | Code | Undesirable class usage` highlights raw Swing usage where a platform replacement exists.

| Instead of | Use | Package |
|---|---|---|
| `JLabel` | `JBLabel` | `com.intellij.ui.components` |
| `JTextField` | `JBTextField` | `com.intellij.ui.components` |
| `JTextArea` | `JBTextArea` | `com.intellij.ui.components` |
| `JList` | `JBList` | `com.intellij.ui.components` |
| `JScrollPane` | `JBScrollPane` | `com.intellij.ui.components` |
| `JTable` | `JBTable` | `com.intellij.ui.table` |
| `JTree` | `Tree` | `com.intellij.ui.treeStructure` |
| `JSplitPane` | `JBSplitter` | `com.intellij.ui` |
| `JTabbedPane` | `JBTabs` | `com.intellij.ui.tabs` |
| `JCheckBox` | `JBCheckBox` | `com.intellij.ui.components` |
| Raw runtime colors | `UIUtil`, `JBUI.CurrentTheme`, `NamedColorUtil`, `JBColor.namedColor`, `JBColor.lazy` | `com.intellij.util.ui`, `com.intellij.ui` |
| `EmptyBorder` | `JBUI.Borders.empty()` | `com.intellij.util.ui` |
| Hardcoded pixel sizes | `JBUI.scale(px)` | `com.intellij.util.ui` |

Generic utilities:

| Need | Preferred API |
|---|---|
| Concise border layout | `BorderLayoutPanel`, `JBUI.Panels.simplePanel(...)` |
| Platform panel helpers | `JBPanel.withBorder(...)`, `.andTransparent()`, `.andOpaque()` |
| Platform label behavior | `JBLabel` |
| Context help | `ContextHelpLabel` |
| Links | `HyperlinkLabel`, `LinkLabel` |
| High-performance rich fragments | `SimpleColoredComponent` |
| List renderers | `ColoredListCellRenderer` |
| Tree renderers | `ColoredTreeCellRenderer` |
| Renderer text styles | `SimpleTextAttributes` |
| Editable list toolbar | `ToolbarDecorator` |
| Platform list | `JBList` |
| Platform tree | `Tree` |

## Multi-line and Rich Text

| Need | Component |
|---|---|
| Rich HTML with modern CSS, icons, shortcuts | `JBHtmlPane` (`com.intellij.ui.components.JBHtmlPane`) |
| Simple multi-line label with HTML | `JBLabel` + `XmlStringUtil.wrapInHtml()` |
| Single-line transcript text (tool headers, file links, to-do rows) | `PlainLabel` (`ai.kilocode.client.ui.PlainLabel`) with `underline`/`strike`; never `<html>` text, because Swing re-parses every HTML label each time an editor tab is detached or re-attached |
| Scrollable / wrapping HTML panel | `SwingHelper.createHtmlViewer()` |
| High-performance colored text fragments in trees/lists/tables | `SimpleColoredComponent` |
| Plain-text newline splitting | `MultiLineLabel` — legacy, do not use in new code |

- Build HTML programmatically with `HtmlChunk`/`HtmlBuilder` (`com.intellij.openapi.util.text.HtmlChunk`). Avoid raw HTML string concatenation — it risks injection and breaks localization.
- For simple wrapping/escaping: `XmlStringUtil.wrapInHtml(content)`, `XmlStringUtil.wrapInHtmlLines(lines...)`, `XmlStringUtil.escapeString(text)`.
- Selectable/copyable label text: `JBLabel.setCopyable(true)`. Use `setAllowAutoWrapping(true)` for auto-wrap.
- When creating a `JEditorPane` manually, always use `HTMLEditorKitBuilder` instead of constructing `HTMLEditorKit` directly.
- Single-line overflow/ellipsis: use `SwingTextTrimmer`. Do not manually truncate strings.
- All user-visible strings go in `*.properties` files; HTML markup in values is acceptable.

## Theme-Derived Colors

Do not hardcode runtime colors. IntelliJ UI colors must come from the current theme, component state, editor color scheme, or a centralized semantic named color key.

Prefer semantic helpers for common UI roles:

| Need | Preferred API |
|---|---|
| Ordinary label text | `UIUtil.getLabelForeground()` |
| Secondary/help text | `UIUtil.getContextHelpForeground()` |
| Error label text | `UIUtil.getErrorForeground()` |
| Warning label text | `JBUI.CurrentTheme.Label.warningForeground()` |
| Inactive secondary text | `NamedColorUtil.getInactiveTextColor()` |
| Bounds and standard border color | `NamedColorUtil.getBoundsColor()` / `JBColor.border()` |
| Links | `JBUI.CurrentTheme.Link.Foreground.ENABLED` / `HOVERED` / `PRESSED` |
| List renderer text/background | `UIUtil.getListForeground(selected, focused)` / `UIUtil.getListBackground(selected, focused)` |
| Tree renderer text/background | `UIUtil.getTreeForeground(selected, focused)` / `UIUtil.getTreeBackground(selected, focused)` |
| Popup background | `JBUI.CurrentTheme.Popup.BACKGROUND` |
| Validation errors | `JBUI.CurrentTheme.Validator.errorBorderColor()` / `errorBackgroundColor()` |
| Validation warnings | `JBUI.CurrentTheme.Validator.warningBorderColor()` / `warningBackgroundColor()` |

Use `JBColor.lazy { ... }` for colors that depend on runtime state or the active editor color scheme. Use `JBColor.namedColor("Some.Semantic.Key", fallback)` when defining or consuming a semantic color key. For HTML/CSS snippets, compute the color from a theme API and convert it with `ColorUtil.toHtmlColor(...)`.

Avoid inline `Color(...)`, numeric `JBColor(...)`, `Gray.xNN`, `JBColor.GRAY`, and hex color literals in runtime UI code. The exception is a centralized semantic color definition with a named color key when no existing platform key exists.

## Theme-Derived Fonts

Do not hardcode font sizes or font families.

- Prefer component default fonts when no style change is needed.
- Use `JBFont.h1()` through `JBFont.h4()` for headings.
- Use `.asBold()`, `.asItalic()`, and `.asPlain()` for style changes on `JBFont` values.
- Use `JBFont.regular()`, `JBFont.medium()`, and `JBFont.small()` for regular and secondary text.
- Use `RelativeFont` when adjusting an existing component font relatively.
- For errors, grayed text, shortcuts, and links in renderers, prefer `SimpleTextAttributes.ERROR_ATTRIBUTES`, `GRAYED_ATTRIBUTES`, `SHORTCUT_ATTRIBUTES`, and `LINK_ATTRIBUTES`.

Avoid `Font("...")`, raw font sizes, and `deriveFont(14f)` style calls.

## Borders, Insets, and Spacing

- Always create borders via `JBUI.Borders.empty(top, left, bottom, right)` and insets via `JBUI.insets()` — DPI-aware and auto-update on zoom.
- Use `JBUI.scale(int)` for any pixel dimension to ensure proper HiDPI scaling.
- Do not use `EmptyBorder`, raw `Insets`, or raw `Dimension` unless there is no platform alternative.
- Theme-dependent borders, insets, colors, and corner arcs must be re-evaluated when the Look and Feel changes. Do not assign a theme-derived border once in a constructor for a long-lived component. Prefer overriding `updateUI()` or subscribing to `LafManagerListener.TOPIC`.
- Use `JBValue.UIInteger` for themeable arc and spacing values. Call `.get()` during layout and size calculation; do not cache the resolved `Int` in a constructor or property initializer.

For common spacing lookups, prefer `JBUI.CurrentTheme` area-specific insets (e.g. `JBUI.CurrentTheme.ActionsList.cellPadding()`, `JBUI.CurrentTheme.Toolbar.toolbarButtonInsets()`, `JBUI.CurrentTheme.ToolWindow.headerLabelLeftRightInsets()`) over inventing numbers.

| Need | Preferred source |
|---|---|
| Manual Swing empty padding | `JBUI.Borders.empty(...)` |
| Manual Swing insets | `JBUI.insets(...)`, `JBUI.emptyInsets()`, `JBUI.insetsTop(...)` |
| Manual Swing dimensions | `JBUI.size(...)`, `JBDimension`, `JBUI.scale(...)` |
| Side separators | `JBUI.Borders.customLineTop(...)`, `customLineBottom(...)` |
| Composed borders | `JBUI.Borders.compound(...)`, `JBUI.Borders.merge(...)` |
| Simple `BorderLayout` panels | `JBUI.Panels.simplePanel(...)`, `BorderLayoutPanel` |
| One-dimensional multi-component rows/columns | `ai.kilocode.client.ui.layout.Stack` — see section below |
| Fluent platform panels | `JBPanel.withBorder(...)`, `.andTransparent()`, `.andOpaque()`, `.withBackground(...)` |
| Single-component alignment wrapper | `ai.kilocode.client.ui.layout.Align` — see section below |

## Stack — One-Dimensional Multi-Component Layout

Use `Stack` (`ai.kilocode.client.ui.layout.Stack`) when multiple Swing components should be laid out as one vertical column or one horizontal row without visual chrome. It is a transparent, no-border, no-color `JPanel(null)` that lays out visible children in insertion order.

**Behavior:**

| Mode | Layout behavior | Size contribution |
|---|---|---|
| `Stack.vertical(gap)` | Children are placed top-to-bottom; each child fills the available container width; each child keeps its bounded preferred height | Width is max child width; height is summed child heights plus gaps |
| `Stack.horizontal(gap)` | Children are placed left-to-right; each child fills the available container height; each child keeps its bounded preferred width | Width is summed child widths plus gaps; height is max child height |

"Bounded preferred" means the child's preferred size on the stack axis is coerced into the effective `[min, max]` range. On the cross axis, layout tracks the container size even if that ignores an individual child's preferred/minimum/maximum size.

**Factories and fluent additions:**

```kotlin
Stack.vertical()
    .next(header)
    .next(body)

Stack.horizontal(gap = UiStyle.Gap.md())
    .next(icon)
    .next(label)

Stack.vertical(gap = UiStyle.Gap.sm())
    .next(summary)
    .gap(UiStyle.Gap.lg())
    .next(details)

Stack.vertical()
    .next(header)
    .fill(UiStyle.Gap.pad())
    .next(body)

Stack.horizontal()
    .next(icon)
    .fill(UiStyle.Gap.sm())
    .next(label)
```

**Rules:**

- Prefer `Stack.vertical(...)` or `Stack.horizontal(...)` over one-off `JPanel` + `BoxLayout` or simple single-line `FlowLayout` rows/columns.
- Use the constructor `gap` for the normal spacing between adjacent visible children.
- Use `gap(size)` for an explicit one-off gap only when the next added child is the next visible child. It is ignored when it is trailing or when a hidden component appears before the next visible child.
- Use `fill(size)`, `Stack.verticalFiller(size)`, or `Stack.horizontalFiller(size)` for persistent leading, trailing, or interstitial whitespace. Do not use `Box` or `gap(size)` for persistent spacing.
- Use `Stack` for simple retained Swing rows/columns where children should track the cross-axis size. Use `Align` for positioning one child inside available space.
- Do not use `Stack` for padding, borders, colors, wrapping rows, flexible glue, or transcript components that need width-aware HTML reflow. Use `JBUI.Borders.empty(...)`, `UiStyle.Gap`, purpose-built layouts, or `SessionLayout` for those concerns.
- `Stack` and `Align` ask each child for its minimum, preferred and maximum size, so measuring a deep invalid tree grows with every nesting level. A tree that is invalidated and measured over and over, such as a list renderer stamp, should run each layout or size read inside `LayoutPass.measure { ... }`, which answers each size once per container for that pass. Do not change the measured content inside the pass.

## Align — Single-Component Alignment Wrapper

Use `Align` (`ai.kilocode.client.ui.layout.Align`) when a single Swing component must be positioned inside available space without adding visual chrome. It is a transparent, no-border, no-color `JPanel(null)` that lays out its one child according to independent horizontal (`HAlign`) and vertical (`VAlign`) modes. `CenterShrinkPanel` has been removed; use `child.align(HAlign.CENTER, VAlign.CENTER)` as a direct replacement.

**Alignment modes:**

| Mode | Axis | Layout behavior | Wrapper size contribution |
|---|---|---|---|
| `HAlign.TRACK` / `VAlign.TRACK` | either | Child always fills all available space; ignores child min/preferred/max | Zero (wrapper reports insets only on that axis) |
| `HAlign.FIT` / `VAlign.FIT` | either | Child fills available space clamped to child's effective `[min, max]` range | Child min/preferred/max respected |
| `HAlign.LEFT` / `VAlign.TOP` | H / V | Child placed at left/top edge at bounded preferred size; shrinks to available when necessary | Child min/preferred/max respected |
| `HAlign.CENTER` / `VAlign.CENTER` | H / V | Child centered at bounded preferred size; shrinks to available when necessary | Child min/preferred/max respected |
| `HAlign.RIGHT` / `VAlign.BOTTOM` | H / V | Child placed at right/bottom edge at bounded preferred size; shrinks to available when necessary | Child min/preferred/max respected |

"Bounded preferred" means the child's preferred size coerced into the effective `[min, max]` range. If available space is smaller than the effective minimum, the layout shrinks the child to available space to avoid overflow.

**Factory extension** on `Component`:

```kotlin
child.align(HAlign.LEFT, VAlign.TOP)      // left-aligned, top-pinned
child.align(HAlign.CENTER, VAlign.CENTER) // centered (replaces CenterShrinkPanel)
child.align(HAlign.TRACK, VAlign.CENTER)  // fill width, center vertically
child.align(HAlign.TRACK, VAlign.TRACK)   // fill all available space
```

**Rules:**

- Prefer `child.align(h, v)` over creating one-off `JPanel(FlowLayout(...))` or `BorderLayoutPanel` wrappers just to control alignment.
- Use `TRACK` when the child must occupy all available space on an axis and must not reserve any space in the parent's size negotiation on that axis. Use `FIT` when you want to fill available space but still respect child min/max constraints.
- All non-TRACK modes include the child's min, preferred, and max sizes in the wrapper's own min/preferred/max size. This means parent layout managers see the child constraints through the wrapper.
- Do not use `Align` for spacing, padding, borders, colors, or multi-child layout — use `JBUI.Borders.empty(...)`, `UiStyle.Gap`, or an appropriate layout manager for those concerns.

## IntelliJ UI Surfaces

### Tool Windows

- Register declaratively in module XML via `com.intellij.toolWindow` extension point (already done in `kilo.jetbrains.frontend.xml`).
- Implement `ToolWindowFactory.createToolWindowContent()` — called lazily on first click.
- Use `SimpleToolWindowPanel(vertical = true)` as a convenient base — supports toolbar + content layout.
- Add tabs via `ToolWindow.contentManager`: create content with `ContentFactory.getInstance().createContent(component, title, isLockable)`, then `contentManager.addContent()`.
- For conditional display, implement `ToolWindowFactory.isApplicableAsync(project)`.
- Always use `ToolWindowManager.invokeLater()` instead of `Application.invokeLater()` for tool-window-related EDT tasks.

### Dialogs

- Extend `DialogWrapper`. Call `init()` from the constructor. Override `createCenterPanel()` to return UI content.
- Override `getPreferredFocusedComponent()` for initial focus, `getDimensionServiceKey()` for size persistence.
- Show with `showAndGet()` (modal, returns boolean) or `show()` (then use `getExitCode()`).
- Input validation: call `initValidation()` in constructor, override `doValidate()` — return `null` if valid or `ValidationInfo(message, component)` if not.
- For hand-built Swing forms, use `ComponentValidator` with `withValidator`, `withFocusValidator`, and `andRegisterOnDocumentListener` instead of custom tooltip/error border logic.

### Notifications

- Declare in module XML: `<notificationGroup id="Kilo Code" displayType="BALLOON"/>`.
- Show: `Notification("Kilo Code", "message", NotificationType.INFORMATION).notify(project)`.
- Add actions: `.addAction(NotificationAction.createSimpleExpiring("Label") { ... })`.
- Sticky (user must dismiss): `displayType="STICKY_BALLOON"` + `.setSuggestionType(true)`.
- Tool-window-bound: `displayType="TOOL_WINDOW" toolWindowId="Kilo Code"`.
- Prefer non-modal notifications over `Messages.show*()` dialogs.

### Popups

- Use `JBPopupFactory.getInstance()` for lightweight floating UI (no chrome, auto-dismiss on focus loss).
- `createComponentPopupBuilder(component, focusable)` for arbitrary Swing content; `createPopupChooserBuilder(list)` for item selection; `createActionGroupPopup()` for action menus.
- Show with `showInBestPositionFor(editor)`, `showUnderneathOf(component)`, or `showInCenterOf(component)`.

### Lists and Trees

- `JBList` not `JList` — adds empty text, busy indicator, tooltip truncation.
- `Tree` not `JTree` — adds wide selection painting, auto-scroll on DnD.
- Custom renderers: `ColoredListCellRenderer` / `ColoredTreeCellRenderer` — `append()` for styled text, `setIcon()` for icons.
- Speed search: `ListSpeedSearch(list)` / `TreeSpeedSearch(tree)`.
- Editable list with add/remove/reorder toolbar: `ToolbarDecorator.createDecorator(list).setAddAction { }.setRemoveAction { }.createPanel()`.
- Use `ListUtil.installAutoSelectOnMouseMove(list)` for popup-like hover-selection behavior.
- Use `ScrollingUtil.installActions(list)` for keyboard navigation.
- Use `CollectionListModel<T>` for simple item storage; `FilteringListModel<T>` for filtering with speed search.

## Icons and SVG Assets

The `icon-jetbrains` skill (`.kilo/skills/icon-jetbrains/SKILL.md`) is the single source of truth for SVG icon authoring: canvas sizes, palette colors, dark variants, composition rules, placement, and validation. Always load that skill when creating, modifying, or reviewing icon assets. Do not duplicate its guidance here.

This section covers only the Kotlin/runtime integration side:

- For compact icon-only actions, use `ai.kilocode.client.ui.HoverIcon` so the control gets the standard 24×24 hover treatment. Do not create `JButton(icon)` or wrap a bare icon in a button just to make it clickable.
- **Reuse platform icons**: browse at https://intellij-icons.jetbrains.design. Access via `AllIcons.*` constants.
- Custom icons: SVG files in `resources/icons/`. Load via `IconLoader.getIcon("/icons/foo.svg", MyClass::class.java)`.
- Organize in an `icons` package or a `*Icons` object with `@JvmField` on each constant.
- **Sizing, dark variants, and filename patterns**: see the `icon-jetbrains` skill for the authoritative Icon roles table, canvas sizes, filename patterns, and dark variant conventions. Do not duplicate sizing or palette values here.

IntelliJ does not theme SVG icons with `currentColor`, CSS classes, CSS variables, `<style>` blocks, or inherited styles. `SVGLoader` patches icon colors by matching literal hex values in `fill` and `stroke` attributes against the active theme palette. Use hardcoded palette hex values in SVG assets and provide dark variants. This exception applies to icon asset files only; runtime Swing UI code must still derive colors from theme APIs.

Themes can override palette colors through `icons.ColorPalette` in the theme JSON.

Official references:
- [IntelliJ Platform UI Guidelines](https://jetbrains.design/intellij/)
- [UI FAQ (colors, borders, icons)](https://plugins.jetbrains.com/docs/intellij/ui-faq.html)

## Before Returning UI Code

Review generated UI code and remove:

- Explicit default property assignments such as unnecessary `isOpaque = false`
- Unnecessary `preferredSize`, `minimumSize`, or `maximumSize`
- Raw `Dimension`, `Insets`, `EmptyBorder`, or `Color`
- Inline runtime colors: `Color(...)`, numeric `JBColor(...)`, `Gray.xNN`, `JBColor.GRAY`, or hex color literals
- Raw CSS color literals (use `ColorUtil.toHtmlColor(themeColor)` when the source is theme-derived)
- Hardcoded font families, raw font sizes, or numeric-size `deriveFont(...)` calls
- Raw Swing components where IntelliJ replacements exist
- Hardcoded spacing that should be a `JBUI` value or `UiStyle.Gap` constant
- Cached `JBValue.UIInteger(...).get()` values in custom layouts — call `.get()` during layout/sizing instead
- Theme-derived borders, insets, colors, or arcs assigned once in constructors without `updateUI()` override
- SVG assets using `currentColor`, CSS variables, CSS classes, `<style>` blocks, or inherited styling
- Extra helpers that do not make the UI clearer or more reusable
- Any Kotlin UI DSL (`com.intellij.ui.dsl.builder`) introduced by accident

## Settings UI

Settings UI has reusable primitives in `frontend/src/main/kotlin/ai/kilocode/client/settings/base/`. Check these before adding new settings components or custom Swing assemblies.

### Base Pages And Messaging

- Use `BaseSettingsUi` for app-backed draft settings that need app-state collection, workspace loading/refreshing, draft/baseline tracking, save progress, save failure handling, and login/banner integration.
- Use `SettingsPanel` and `SettingsOverlayPanel` as the settings surface so progress and errors go through `showProgress`, `updateProgress`, `showError`, and `clearProgress`.
- Use `SettingsTop` for settings banners and login prompts rather than ad hoc labels, notifications, or dialog prompts embedded in the form.
- Use `SettingsDraftState` and `SettingsDraftPage` for modified/reset/apply behavior instead of maintaining unrelated local dirty-state mechanisms.
- Use the base loading and refresh flow (`BaseSettingsUi` or `SettingsListPanel.reload` / `mutateAndReload`) so busy state, refresh selection, and app readiness are handled consistently.
- Communicate load, refresh, validation, and save errors through the common settings messaging mechanisms: overlay `showError`, `SettingsMessageException` for user-facing list mutation errors, `failedText()` / `saveError` in `BaseSettingsUi`, and `SettingsTop` banners for persistent page-level problems.

### Rows And Forms

- Use `SettingsRow`, `SettingsStackedRow`, and `SettingsRows` for reusable setting rows, stacked text/editing rows, keyed dynamic rows, and setting sections.
- Do not create a custom row panel for each setting unless the common row classes cannot represent the behavior.
- Keep settings UI on the EDT and continue using existing platform Swing components, `Stack`, `Align`, `UiStyle`, and localized `KiloBundle` strings according to the UI guidance above.

### Lists And Add/Remove Collections

- For add/remove/edit collections, use the shared list infrastructure: `SettingsListPanel`, `SettingsListView`, `SettingsListItem`, `SettingsListCell`, `SettingsListSelection`, and `SettingsToolbarAction` where applicable.
- When a setting is a list of values that can be added or removed inline, represent it with common list/editor primitives, toolbar actions, and in-place cells/buttons as needed.
- Do not build a bespoke set of Swing components for each add/remove list situation.
- Prefer list action cells (`SettingsListCell`) for row-local actions like edit/delete and toolbar actions for global add/import/refresh actions.

### Settings Test Coverage Pattern

- Each settings page that writes state needs a fake-RPC frontend test that proves UI interactions call the expected client service/RPC method.
- Each backend-backed settings write path needs a `*RpcApiImpl` or manager test against `MockCliServer` that asserts the exact CLI HTTP body and that a subsequent reload observes the persisted value.
- Navigation-only settings pages should still have `BasePlatformTestCase` coverage for rendered child links, stable child IDs, and inert `isModified`/`apply` behavior.
