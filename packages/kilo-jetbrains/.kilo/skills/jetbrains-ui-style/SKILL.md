---
name: jetbrains-ui-style
description: Use when creating, modifying, or reviewing Kotlin/Swing UI code for the Kilo JetBrains plugin. Applies to dialogs, settings pages, tool windows, forms, panels, component layout, sizing, spacing, colors, borders, icons, lists, trees, popups, notifications, and IntelliJ platform UI components.
---

# JetBrains UI Style

Use this skill whenever creating, modifying, or reviewing UI code in `packages/kilo-jetbrains`.

## Scope

This skill covers Kotlin/Swing UI code for the Kilo JetBrains plugin, including dialogs, settings pages, tool windows, forms, panels, component layout, sizing, spacing, colors, borders, icons, lists, trees, popups, notifications, and IntelliJ Platform UI components.

This plugin is a split-mode JetBrains plugin. UI code belongs in `frontend` unless there is a specific split-mode reason to place it elsewhere.

## IntelliJ Platform Source Lookup

When looking for IntelliJ Platform API usage, implementation examples, extension points, services, actions, inspections, PSI/VFS/editor behavior, or plugin patterns, prefer real IntelliJ source code over Gradle caches, downloaded jars, generated parser artifacts, or decompiled classes.

Use this priority order:

1. Check whether `$INTELLIJ_REPO` is set and points to a readable IntelliJ Community checkout.
   - If `$INTELLIJ_REPO` is set, search source files under that directory first.
   - Prefer implementation source files from directories such as `platform/`, `plugins/`, `java/`, `xml/`, `json/`, `jvm/`, and related modules.
   - Do not assume the IntelliJ checkout is a sibling of the current repo or worktree.
2. If `$INTELLIJ_REPO` is unset, empty, unreadable, or does not appear to contain an IntelliJ source checkout, tell the user to set it up.
   - Suggested instruction: `Set INTELLIJ_REPO to the path of a local intellij-community checkout, for example: export INTELLIJ_REPO=/path/to/intellij-community`
   - Do not invent or hardcode a machine-specific absolute path.
3. If a local checkout is unavailable, use the public IntelliJ Community repository as the fallback source:
   - https://github.com/JetBrains/intellij-community
4. Only inspect Gradle caches, downloaded jars, generated parser jars, decompiled classes, or dependency internals as a last resort when neither a local IntelliJ source checkout nor the public GitHub repository provides the needed information.

Avoid starting searches in:

- `~/.gradle/caches`
- `.gradle/`
- downloaded dependency jars
- generated parser artifacts
- decompiled library sources

## Primary Rules

- Prefer Kotlin UI DSL v2 whenever the UI is a dialog, settings page, form, options panel, or structured component layout.
- Use manual Swing only for custom rendering, transcript/chat surfaces, highly dynamic panels, virtualized lists, custom painting, or layouts the DSL cannot express cleanly.
- Keep generated UI code minimal.
- Do not set default Swing properties explicitly. For example, avoid `isOpaque = false` unless the component default differs or there is a documented rendering reason.
- Avoid hardcoded dimensions. Prefer layout semantics, component defaults, DSL sizing helpers, and `JBUI` utilities.
- Do not add decorative helper functions, wrappers, or defensive UI code unless they materially improve clarity or correctness.
- Prefer IntelliJ platform components and theme-aware APIs.
- Do not use hardcoded runtime colors in generated UI examples or implementation code.
- Derive UI colors from semantic IntelliJ theme APIs such as `UIUtil`, `JBUI.CurrentTheme`, `NamedColorUtil`, `JBColor.namedColor`, or `JBColor.lazy`.
- Do not use hardcoded font sizes or font families in generated UI examples or implementation code.
- Use component defaults, `JBFont`, `RelativeFont`, or existing component fonts for typography.
- Put user-visible strings in `*.properties` files.

## Decision Tree

- Use Kotlin UI DSL v2 for dialogs, settings pages, forms, options panels, and structured component layouts.
- Use Kotlin UI DSL v2 inside tool windows when rendering form-like controls or structured subpanels.
- Use standard Swing with IntelliJ Platform component replacements for tool-window shells, action-driven UI, custom components, transcript surfaces, and custom renderers.
- Use the Action System for menus and toolbars.
- Do not use Kotlin Compose.
- Do not use JCEF.

| Need | API |
|---|---|
| Dialogs, settings pages, forms, any layout with components | Preferred: Kotlin UI DSL v2 (`com.intellij.ui.dsl.builder`) |
| Tool window panels, action-driven UI, custom components | Standard Swing with IntelliJ Platform component replacements |
| Menus and toolbars | Action System |

## Minimal Code Rule

Avoid explicit defaults and manual layout when the DSL can express the UI:

```kotlin
// Avoid
val panel = JPanel(BorderLayout()).apply {
    isOpaque = false
    preferredSize = Dimension(420, 260)
    border = EmptyBorder(12, 12, 12, 12)
}
```

Prefer DSL and platform spacing:

```kotlin
panel {
    row(KiloBundle.message("settings.name")) {
        textField()
            .align(AlignX.FILL)
            .resizableColumn()
    }
}
```

Avoid explicit default properties:

```kotlin
// Avoid unless there is a documented rendering reason
component.isOpaque = false
```

Prefer omitting the assignment and relying on the component/platform default.

Avoid raw fixed sizes:

```kotlin
// Avoid
component.preferredSize = Dimension(300, 40)
```

Prefer semantic sizing:

```kotlin
textField()
    .columns(COLUMNS_MEDIUM)
    .align(AlignX.FILL)
```

If a fixed size is genuinely required, use `JBUI.size(...)` or `JBUI.scale(...)` and keep the reason obvious from context.

## Do Not Use Kotlin Compose

Do not use Kotlin Compose or `intellij.platform.compose` in this plugin. The JetBrains modular template uses Compose for its demo tool window, but Kilo should use standard Swing with IntelliJ Platform components only. Keep all plugin UI in the existing Swing-based stack.

## Do Not Use JCEF

Do not use JCEF (`JBCefBrowser`) in this plugin. JCEF does not work in JetBrains remote development (split mode): the frontend process runs on the client machine but JCEF requires a display on the host, making it effectively unusable for remote users. Use standard Swing with IntelliJ Platform components for all UI.

## Kotlin UI DSL v2

Use Kotlin UI DSL v2 as the default way to build UI for dialogs, settings pages, forms, and any layout composed of standard components. It produces correct spacing, label alignment, HiDPI scaling, and accessibility automatically. Only fall back to manual Swing layout when you need a fully custom component, such as a canvas, rich list renderer, transcript surface, or tool-window chrome that the DSL cannot express.

The top-level builder is `panel { }` and returns `DialogPanel`. Structure is `panel -> row -> cells`. Cell factory methods such as `textField()`, `checkBox()`, and `label()` add components. The DSL lives in `com.intellij.ui.dsl.builder`.

To explore DSL capabilities interactively: Tools -> Internal Actions -> UI -> Kotlin UI DSL -> UI DSL Showcase. This requires internal mode: `-Didea.is.internal=true`.

### Basics: Panel, Row, Cell

Rows occupy full width. The last cell in a row takes remaining space. Rows have a `layout` property.

```kotlin
panel {
    row("Row1 label:") {
        textField()
        label("Some text")
    }
    row("Row2:") {
        label("This text is aligned with previous row")
    }
}
```

### Row Layout

Every row uses one of three layouts. Default is `LABEL_ALIGNED` when a label is provided for the row, `INDEPENDENT` otherwise.

| Layout | Behavior |
|---|---|
| `LABEL_ALIGNED` | Label column and content columns, aligned across rows |
| `INDEPENDENT` | All cells are independent, no cross-row alignment |
| `PARENT_GRID` | Cells align with the parent grid columns across rows |

```kotlin
panel {
    row("PARENT_GRID:") {
        label("Col 1")
        label("Col 2")
    }.layout(RowLayout.PARENT_GRID)

    row("PARENT_GRID:") {
        textField()
        textField()
    }.layout(RowLayout.PARENT_GRID)

    row("LABEL_ALIGNED default with label:") {
        textField()
    }

    row {
        label("INDEPENDENT default without label:")
        textField()
    }
}
```

### Components Reference

All cell factory methods available inside `row { }`:

| Method | Description |
|---|---|
| `checkBox("text")` | Checkbox |
| `threeStateCheckBox("text")` | Three-state checkbox |
| `radioButton("text", value)` | Radio button, must be inside `buttonsGroup {}` |
| `button("text") {}` | Push button |
| `actionButton(action)` | Icon button bound to an `AnAction` |
| `actionsButton(action1, action2, ...)` | Dropdown actions button |
| `segmentedButton(items) { text = it }` | Segmented control |
| `tabbedPaneHeader(items)` | Tab header strip |
| `label("text")` | Static label |
| `text("html")` | Rich text with links, icons, line-width control |
| `link("text") {}` | Focusable clickable link |
| `browserLink("text", "url")` | Opens URL in browser |
| `dropDownLink("default", listOf(...))` | Dropdown link selector |
| `icon(AllIcons.*)` | Icon display |
| `contextHelp("description", "title")` | Help icon with popup |
| `textField()` | Text input |
| `passwordField()` | Password input |
| `textFieldWithBrowseButton()` | Text field and browse dialog |
| `expandableTextField()` | Expandable multi-line text field |
| `extendableTextField()` | Text field with extension icons |
| `intTextField(range)` | Integer input with validation |
| `spinner(intRange)` / `spinner(doubleRange, step)` | Numeric spinner |
| `slider(min, max, minorTick, majorTick)` | Slider, use `.labelTable()` for tick labels |
| `textArea()` | Multi-line text, use `.rows(n)` and `.align(AlignX.FILL)` |
| `comboBox(items)` | Combo box / dropdown |
| `comment("text")` | Gray comment text, standalone |
| `cell(component)` | Wrap any arbitrary Swing component |
| `scrollCell(component)` | Wrap component in a scroll pane |
| `cell()` | Empty placeholder cell for grid alignment |

Key component examples:

```kotlin
panel {
    var mode = "auto"

    buttonsGroup {
        row("Mode:") {
            radioButton("Automatic", "auto")
            radioButton("Manual", "manual")
        }
    }.bind({ mode }, { mode = it })

    row("Slider:") {
        slider(0, 10, 1, 5)
            .labelTable(mapOf(
                0 to JBLabel("0"),
                5 to JBLabel("5"),
                10 to JBLabel("10"),
            ))
    }

    row {
        label("Text area:")
            .align(AlignY.TOP)
            .gap(RightGap.SMALL)
        textArea()
            .rows(5)
            .align(AlignX.FILL)
    }.layout(RowLayout.PARENT_GRID)
}
```

### Component Labels

Labels for modifiable components must be connected via one of two methods. This ensures correct spacing, mnemonic support, and accessibility.

- Row label: `row("&Label:") { textField() }`, mnemonic via `&`, label in left column
- Cell label: `textField().label("&Label:", LabelPosition.TOP)`, label attached to cell, optionally on top

```kotlin
panel {
    row("&Row label:") {
        textField()
        textField()
            .label("Cell label at &left:")
    }
    row {
        textField()
            .label("Cell label at &top:", LabelPosition.TOP)
    }
}
```

When a row contains a `checkBox` or `radioButton`, the DSL automatically increases space after the row label per IntelliJ UI Guidelines.

### Comments

Three types of comments, each with different placement and semantics:

| Type | Method | Placement |
|---|---|---|
| Cell comment, bottom | `cell.comment("text")` | Below the cell |
| Cell comment, right | `cell.commentRight("text")` | Right of the cell |
| Cell context help | `cell.contextHelp("text", "title")` | Help icon with popup |
| Row comment | `row.rowComment("text")` | Below the entire row |
| Arbitrary comment | `comment("text")` | Standalone gray text |

```kotlin
panel {
    row {
        textField()
            .comment("Bottom comment")
        textField()
            .commentRight("Right comment")
        textField()
            .contextHelp("Help popup text")
    }

    row("Label:") {
        textField()
    }.rowComment("This comment sits below the whole row")

    row {
        comment("Standalone comment, supports <a href='link'>links</a> and <icon src='AllIcons.General.Information'>&nbsp;icons")
    }
}
```

Comments support HTML with clickable links, bundled icons via `<icon src='...'>`, and line width control via `maxLineLength`. Use `MAX_LINE_LENGTH_NO_WRAP` to prevent wrapping.

### Groups and Structure

| Method | Grid | Description |
|---|---|---|
| `panel {}` | Own grid | Sub-panel occupying full width |
| `rowsRange {}` | Parent grid | Grouped rows sharing parent grid, useful with `enabledIf` |
| `group("Title") {}` | Own grid | Titled section with vertical spacing before/after |
| `groupRowsRange("Title") {}` | Parent grid | Titled section sharing parent grid alignment |
| `collapsibleGroup("Title") {}` | Own grid | Expandable section, Tab-focusable, supports mnemonics |
| `buttonsGroup("Title") {}` | None | Groups `radioButton` or `checkBox` under a title |
| `separator()` | None | Horizontal separator line |
| Row `panel {}` | Own grid | Sub-panel inside a cell |

```kotlin
panel {
    group("Settings") {
        row("Name:") { textField() }
        row("Path:") { textFieldWithBrowseButton() }
    }

    collapsibleGroup("Advanced") {
        row("Timeout:") { intTextField(0..1000) }
    }

    var enabled = true
    buttonsGroup("Mode:") {
        row { radioButton("Automatic", true) }
        row { radioButton("Manual", false) }
    }.bind({ enabled }, { enabled = it })

    separator()

    row {
        label("Nested panels:")
        panel {
            row("Sub row 1:") { textField() }
            row("Sub row 2:") { textField() }
        }
    }
}
```

### Gaps and Spacing

- Horizontal gaps: `cell.gap(RightGap.SMALL)` between a label-like checkbox and its related field. Medium gap is the default between cells.
- Two-column layout: `twoColumnsRow({}, {})` or `gap(RightGap.COLUMNS)` with `.layout(RowLayout.PARENT_GRID)`.
- Left indent: `indent {}` for indented sub-content.
- Vertical gaps: `.topGap(TopGap.MEDIUM)` / `.bottomGap(BottomGap.MEDIUM)` on rows to separate unrelated groups. Attach gaps to the related row so hiding rows does not break layout.

Common Kotlin UI DSL spacing values from `IntelliJSpacingConfiguration`:

| Constant | Unscaled px | Usage |
|---|---|---|
| `RightGap.SMALL` | 6 | Related inline components, such as field to button |
| Default row/cell gap | 16 | Automatic gap between components in a row |
| `RightGap.COLUMNS` | 60 | Logical column separation |
| `TopGap.SMALL` / `BottomGap.SMALL` | 8 | Minor section separation |
| `TopGap.MEDIUM` / `BottomGap.MEDIUM` | 20 | Major section or group separation |
| `verticalComponentGap` | 6 | Automatic gap between rows |

These are semantic IntelliJ spacing constants. They handle DPI scaling and the IntelliJ spacing model, but they are not theme keys and are not overridden by theme JSON.

```kotlin
panel {
    group("Horizontal Gaps") {
        row {
            val cb = checkBox("Use mail:")
                .gap(RightGap.SMALL)
            textField()
                .enabledIf(cb.selected)
        }
        row("Width:") {
            textField()
                .gap(RightGap.SMALL)
            label("pixels")
        }
    }

    group("Indent") {
        row { label("Not indented") }
        indent {
            row { label("Indented row") }
        }
    }

    group("Two Columns") {
        twoColumnsRow({
            checkBox("First column")
        }, {
            checkBox("Second column")
        })
    }

    group("Vertical Gaps") {
        row { checkBox("Option 1") }
        row { checkBox("Option 2") }
        row { checkBox("Unrelated option") }
            .topGap(TopGap.MEDIUM)
    }
}
```

### Enabled and Visible State

Bind enabled/visible state to a checkbox or other observable. Works on rows, `indent {}` blocks, `rowsRange {}`, and individual cells.

```kotlin
panel {
    group("Enabled") {
        lateinit var cb: Cell<JBCheckBox>
        row { cb = checkBox("Enable options") }
        indent {
            row { checkBox("Option 1") }
            row { checkBox("Option 2") }
        }.enabledIf(cb.selected)
    }

    group("Visible") {
        lateinit var cb: Cell<JBCheckBox>
        row { cb = checkBox("Show options") }
        indent {
            row { checkBox("Option 1") }
            row { checkBox("Option 2") }
        }.visibleIf(cb.selected)
    }
}
```

### Binding

Bind component values to model properties. Values are applied on `DialogPanel.apply()`, checked with `.isModified()`, and reverted with `.reset()`.

| Method | Component |
|---|---|
| `bindSelected(model::prop)` | checkBox |
| `bindText(model::prop)` | textField |
| `bindIntText(model::prop)` | intTextField |
| `bindItem(model::prop.toNullableProperty())` | comboBox |
| `bindValue(model::prop)` | slider |
| `bindIntValue(model::prop)` | spinner |
| `buttonsGroup {}.bind(model::prop)` | radio group |

```kotlin
enum class Theme { LIGHT, DARK }

data class Settings(
    var name: String = "",
    var count: Int = 0,
    var enabled: Boolean = false,
    var theme: Theme = Theme.LIGHT,
)

val model = Settings()

val panel = panel {
    row("Name:") {
        textField().bindText(model::name)
    }
    row("Count:") {
        intTextField(0..100).bindIntText(model::count)
    }
    row {
        checkBox("Enabled").bindSelected(model::enabled)
    }
    buttonsGroup("Theme:") {
        row { radioButton("Light", Theme.LIGHT) }
        row { radioButton("Dark", Theme.DARK) }
    }.bind(model::theme)
}

panel.isModified()
panel.apply()
panel.reset()
```

### Validation

Attach input validation rules to cells. Rules run continuously and display inline error/warning indicators.

```kotlin
panel {
    row("Username:") {
        textField()
            .columns(COLUMNS_MEDIUM)
            .cellValidation {
                addInputRule("Must not be empty") {
                    it.text.isBlank()
                }
            }
    }
    row("Port:") {
        textField()
            .columns(COLUMNS_MEDIUM)
            .cellValidation {
                addInputRule("Contains non-numeric characters", level = Level.WARNING) {
                    it.text.contains(Regex("[^0-9]"))
                }
            }
    }
}
```

Activate validators by calling `dialogPanel.registerValidators(disposable)` after creating the panel.

### Tips and Common Patterns

| Pattern | Usage |
|---|---|
| `.bold()` | Bold text on any cell |
| `.columns(COLUMNS_MEDIUM)` | Set preferred width of textField / comboBox / textArea |
| `.text("initial")` | Set initial text on text components |
| `.resizableColumn()` | Column fills remaining horizontal space |
| `cell()` | Empty placeholder cell for grid alignment |
| `.widthGroup("name")` | Equalize widths across rows, cannot combine with `AlignX.FILL` |
| `.align(AlignX.FILL)` | Stretch component to fill available width |
| `.align(AlignY.TOP)` | Top-align component in its cell |
| `.applyToComponent { }` | Direct access to the underlying Swing component |
| `.selected(true)` | Default-select a radioButton when no bound value matches |
| `.gap(RightGap.COLUMNS)` | Column-level gap for multi-column layouts |

```kotlin
panel {
    row { label("Title").bold() }

    row("Name:") {
        textField()
            .columns(COLUMNS_MEDIUM)
            .resizableColumn()
            .align(AlignX.FILL)
    }

    row("") {
        textField()
    }.rowComment("""Use row("") for an empty label column that aligns with labeled rows""")

    row {
        text("Comment-colored text")
            .applyToComponent { foreground = JBUI.CurrentTheme.ContextHelp.FOREGROUND }
    }
}
```

## Manual Swing

Use manual Swing only when Kotlin UI DSL cannot express the UI cleanly.

Preferred manual Swing rules:

- Use IntelliJ platform components instead of raw Swing components.
- Use layout managers and component defaults rather than fixed sizes.
- Use `JBUI.Borders.empty(...)`, `JBUI.insets(...)`, `JBUI.size(...)`, and `JBUI.scale(...)` instead of raw AWT/Swing sizing primitives.
- Do not set default properties explicitly.
- Keep custom components small and focused.
- For painting, use theme-aware colors and `JBUI.scale(...)` for pixel values.

## Swing Component State

Swing is retained-mode UI, not React-style declarative rendering. For dynamic Swing surfaces such as session cards, transcript parts, hover rows, and collapsible panels, build a stable component tree once and then mutate existing components in response to model or interaction changes.

- Do not use a React-style `state -> render()` loop for Swing components.
- Avoid card-level `render()` methods that remove/recreate headers, text areas, markdown views, controls, or scroll panes after every click, hover, or model update.
- Give each renderer an `update(model)` method that applies model changes directly to existing UI components.
- In `update(model)`, compare before assigning when practical: label text, icons, foregrounds, fonts, body text, visibility, cursor, and containment.
- Do not duplicate state in booleans when Swing component state already answers the question.
- Derive expanded state from containment, such as `scroll.parent === root`, rather than maintaining an `open` boolean.
- Derive hover state from the current header background or other component property, rather than maintaining a `hover` boolean.
- Expand/collapse should attach or detach the existing body component and update controls only if attachment changed.
- Hover should update only the affected component, usually the header background, and repaint only that component when the effective color changed.
- Lazy-create expensive bodies such as `JBTextArea`, `JBScrollPane`, markdown panes, and HTML panes on first expansion or first direct access.
- Keep source/model text separately only when needed to initialize a lazy component before it exists.
- Store the current style snapshot so lazily-created children receive the latest `SessionStyle` when they are first created.
- Parent containers should refresh for add/remove/reorder operations, not automatically after every delegated child update or streaming delta.
- Child views should call `revalidate()`/`repaint()` only when they changed preferred size, visibility, containment, or paint output.
- Empty deltas, identical text, unchanged styles, repeated hover values, and no-op toggles should not repaint the whole card.
- Private helpers named `render()` in Swing views tend to invite full tree rebuilds. Prefer names that describe the mutation, such as `syncBody()`, `syncArrow()`, `syncHtml()`, or `applyModel()`.
- It is fine for markdown internals to call library APIs such as `renderer.render(...)`; the problem is UI-level rerendering that rebuilds Swing component trees.

Avoid this React-style pattern:

```kotlin
private var open = false

fun toggle() {
    open = !open
    render()
}

private fun render() {
    root.removeAll()
    header.removeAll()
    header.add(title)
    if (open) root.add(JBScrollPane(JBTextArea(text)), BorderLayout.CENTER)
    revalidate()
    repaint()
}
```

Prefer mutating stable Swing components and deriving state from the UI:

```kotlin
fun isExpanded(): Boolean = scroll?.parent === root

fun toggle() {
    if (!canExpand()) return
    val changed = if (isExpanded()) collapse() else expand()
    if (!changed) return
    syncArrow()
    revalidate()
    repaint()
}

private fun expand(): Boolean {
    if (isExpanded()) return false
    root.add(scroll(), BorderLayout.CENTER)
    return true
}

private fun collapse(): Boolean {
    val pane = scroll ?: return false
    if (pane.parent !== root) return false
    root.remove(pane)
    return true
}

private fun scroll(): JBScrollPane {
    scroll?.let { return it }
    val pane = JBScrollPane(body())
    scroll = pane
    return pane
}
```

For tests around dynamic Swing components, assert retained component behavior instead of only final text:

- Collapsed components start unattached, and expensive bodies are not created until first expansion.
- First expansion creates the body once, collapse detaches it, and re-expansion reuses the same instance.
- `isExpanded()` agrees with actual containment.
- `update(model)` changes existing labels/body text without duplicating components.
- Updates while collapsed do not eagerly create lazy bodies unless direct body access requires it.
- No-op updates, empty deltas, repeated hover values, and toggling non-expandable cards do not repaint/revalidate the whole view.

## Platform Spacing and Insets

Use semantic spacing APIs before inventing numbers. Do not copy fallback values from IntelliJ source into generated UI code; those values are defaults behind theme keys and may change by UI theme, New UI, OS, or IDE version.

| Need | Preferred source |
|---|---|
| Dialogs, forms, settings | Kotlin UI DSL row/group/indent/gap APIs |
| Component gaps in Kotlin UI DSL | `RightGap.SMALL`, `RightGap.COLUMNS`, `TopGap.MEDIUM`, `BottomGap.MEDIUM`, `.customize(UnscaledGaps(...))` as a last resort |
| Manual Swing empty padding | `JBUI.Borders.empty(...)` |
| Manual Swing insets | `JBUI.insets(...)`, `JBUI.emptyInsets()`, `JBUI.insetsTop(...)`, `JBUI.insetsLeft(...)`, `JBUI.insetsBottom(...)`, `JBUI.insetsRight(...)` |
| Manual Swing dimensions | `JBUI.size(...)`, `JBDimension`, `JBUI.scale(...)` |
| Side separators | `JBUI.Borders.customLineTop(...)`, `customLineBottom(...)`, `customLineLeft(...)`, `customLineRight(...)` |
| Composed borders | `JBUI.Borders.compound(...)`, `JBUI.Borders.merge(...)` |
| Simple `BorderLayout` panels | `JBUI.Panels.simplePanel(...)`, `BorderLayoutPanel` |
| Simple vertical custom Swing groups | `VerticalLayout` |
| Fluent platform panels | `JBPanel.withBorder(...)`, `.andTransparent()`, `.andOpaque()`, `.withBackground(...)` |

For themeable custom layouts, keep the `JBValue.UIInteger` object and call `.get()` during layout and size calculation. Do not cache the resolved `Int`, because that freezes the value from the current Look and Feel and scale context.

```kotlin
private val gap = JBValue.UIInteger("KiloComponent.gap", 16)

override fun doLayout() {
    val value = gap.get()
    // layout using value
}

override fun getPreferredSize(): Dimension {
    val value = gap.get()
    // calculate using value
}
```

Avoid resolving the value once in a constructor or property initializer:

```kotlin
private val gap = JBValue.UIInteger("KiloComponent.gap", 16).get()
```

When raw AWT layout constructors are unavoidable, legacy Swing defaults exist but must still be scaled before use:

| Constant | Value |
|---|---|
| `UIUtil.DEFAULT_HGAP` | 10 |
| `UIUtil.DEFAULT_VGAP` | 4 |
| `UIUtil.LARGE_VGAP` | 12 |

```kotlin
val panel = JPanel(BorderLayout(JBUI.scale(UIUtil.DEFAULT_HGAP), 0))
```

Use `JBUI.CurrentTheme` for context-specific spacing and dimensions:

| UI area | Preferred source |
|---|---|
| Action list rows | `JBUI.CurrentTheme.ActionsList.cellPadding()` |
| Action icon/text gaps | `JBUI.CurrentTheme.ActionsList.elementIconGap()` |
| Action mnemonic gaps | `JBUI.CurrentTheme.ActionsList.mnemonicIconGap()` / `mnemonicInsets()` |
| Popup selection interior | `JBUI.CurrentTheme.Popup.Selection.innerInsets()` |
| Popup separators | `JBUI.CurrentTheme.Popup.separatorInsets()` / `separatorLabelInsets()` |
| Popup header/search field | `JBUI.CurrentTheme.Popup.headerInsets()`, `searchFieldBorderInsets()`, `searchFieldInputInsets()` |
| Complex popup headers | `JBUI.CurrentTheme.ComplexPopup.headerInsets()` |
| Complex popup text fields | `JBUI.CurrentTheme.ComplexPopup.textFieldBorderInsets()` / `textFieldInputInsets()` |
| Search Everywhere / big popup header | `JBUI.CurrentTheme.BigPopup.headerBorder()` / `headerToolbarInsets()` / `tabInsets()` |
| Popup advertiser/footer | `JBUI.CurrentTheme.Advertiser.border()` |
| Toolbar buttons | `JBUI.CurrentTheme.Toolbar.toolbarButtonInsets()` / `mainToolbarButtonInsets()` |
| Toolbar containers | `JBUI.CurrentTheme.Toolbar.horizontalToolbarInsets()` / `verticalToolbarInsets()` |
| Tool-window headers | `JBUI.CurrentTheme.ToolWindow.headerLabelLeftRightInsets()` / `headerToolbarLeftRightInsets()` / `headerTabLeftRightInsets()` |
| Lists | `JBUI.CurrentTheme.List.rowHeight()` |
| Trees | `JBUI.CurrentTheme.Tree.rowHeight()` |
| VCS log rows | `JBUI.CurrentTheme.VersionControl.Log.rowHeight()` / `verticalPadding()` |
| Help tooltips | `JBUI.CurrentTheme.HelpTooltip.defaultTextBorderInsets()` / `smallTextBorderInsets()` |
| Navigation bar items | `JBUI.CurrentTheme.NavBar.itemInsets()` |

When using Kotlin UI DSL, prefer DSL semantics over manual padding:

```kotlin
panel {
    group(KiloBundle.message("settings.section")) {
        row(KiloBundle.message("settings.name")) {
            textField()
                .align(AlignX.FILL)
                .resizableColumn()
        }
        indent {
            row { checkBox(KiloBundle.message("settings.enabled")) }
        }
    }
}
```

When manual Swing is necessary, get padding from platform utilities:

```kotlin
val panel = JBUI.Panels.simplePanel(content)
    .withBorder(JBUI.Borders.empty(JBUI.CurrentTheme.Popup.headerInsets()))
```

For row heights, prefer platform row height APIs over fixed heights:

```kotlin
component.preferredSize = JBDimension(0, JBUI.CurrentTheme.Tree.rowHeight())
```

## Generic Platform Utilities

Use existing platform utility classes instead of hand-rolled labels, renderers, borders, colors, fonts, and validation behavior.

| Need | Preferred API |
|---|---|
| Concise border layout | `BorderLayoutPanel`, `JBUI.Panels.simplePanel(...)` |
| Platform panel helpers | `JBPanel.withBorder(...)`, `.andTransparent()`, `.andOpaque()` |
| Platform label behavior | `JBLabel` |
| Context help | `ContextHelpLabel` |
| Links | `HyperlinkLabel`, `LinkLabel`, Kotlin UI DSL `link(...)` / `browserLink(...)` |
| Error/validation label in legacy UI | `ErrorLabel` only when an inline validation component is required and DSL validation is not available |
| High-performance rich fragments | `SimpleColoredComponent` |
| List renderers | `ColoredListCellRenderer`, Kotlin `listCellRenderer` / `textListCellRenderer` / `LcrRow` |
| Tree renderers | `ColoredTreeCellRenderer` |
| Renderer text styles | `SimpleTextAttributes` |
| Editable list toolbar | `ToolbarDecorator` |
| Platform list | `JBList` |
| Platform tree | `Tree` |

For renderer text, prefer `SimpleTextAttributes` over direct color/font mutation:

```kotlin
append(text, SimpleTextAttributes.ERROR_ATTRIBUTES)
append(detail, SimpleTextAttributes.GRAYED_ATTRIBUTES)
append(link, SimpleTextAttributes.LINK_ATTRIBUTES)
```

## Tool Windows

- Register declaratively in module XML via `com.intellij.toolWindow` extension point.
- Implement `ToolWindowFactory.createToolWindowContent()`, called lazily on first click.
- Use `SimpleToolWindowPanel(vertical = true)` as a convenient base for toolbar and content layout.
- Add tabs via `ToolWindow.contentManager`: create content with `ContentFactory.getInstance().createContent(component, title, isLockable)`, then `contentManager.addContent()`.
- For conditional display, implement `ToolWindowFactory.isApplicableAsync(project)`.
- Always use `ToolWindowManager.invokeLater()` instead of `Application.invokeLater()` for tool-window-related EDT tasks.

## Dialogs

- Extend `DialogWrapper`.
- Call `init()` from the constructor.
- Override `createCenterPanel()` to return UI content.
- Prefer Kotlin UI DSL v2 for panel contents.
- Override `getPreferredFocusedComponent()` for initial focus.
- Override `getDimensionServiceKey()` for size persistence when useful.
- Show with `showAndGet()` for modal boolean result, or `show()` and then `getExitCode()`.
- For input validation, call `initValidation()` in the constructor and override `doValidate()` to return `null` if valid or `ValidationInfo(message, component)` if invalid.

## Platform Components

Always use IntelliJ platform components instead of raw Swing where an equivalent exists.

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

Inspection `Plugin DevKit | Code | Undesirable class usage` highlights raw Swing usage where a platform replacement exists.

## Multi-line and Rich Text

| Need | Component |
|---|---|
| Rich HTML with modern CSS, icons, shortcuts | `JBHtmlPane` (`com.intellij.ui.components.JBHtmlPane`) |
| Simple multi-line label with HTML | `JBLabel` + `XmlStringUtil.wrapInHtml()` |
| Scrollable / wrapping HTML panel | `SwingHelper.createHtmlViewer()` |
| High-performance colored text fragments in trees/lists/tables | `SimpleColoredComponent` |
| Plain-text newline splitting | `MultiLineLabel`, legacy, do not use in new code |

- Build HTML programmatically with `HtmlChunk` / `HtmlBuilder` (`com.intellij.openapi.util.text.HtmlChunk`). Avoid raw HTML string concatenation because it risks injection and breaks localization.
- For simple wrapping/escaping, use `XmlStringUtil.wrapInHtml(content)`, `XmlStringUtil.wrapInHtmlLines(lines...)`, and `XmlStringUtil.escapeString(text)`.
- For selectable/copyable label text, use `JBLabel.setCopyable(true)`, which switches internally to `JEditorPane` while preserving label appearance. Use `setAllowAutoWrapping(true)` for auto-wrap.
- When creating a `JEditorPane` manually, always use `HTMLEditorKitBuilder` instead of constructing `HTMLEditorKit` directly: `editorPane.setEditorKit(HTMLEditorKitBuilder.simple())` or `.withWordWrapViewFactory().build()`.
- For single-line overflow/ellipsis, use `SwingTextTrimmer`. Do not manually truncate strings.
- Put all user-visible strings in `*.properties` files. HTML markup in values is acceptable.

## Theme-Derived Colors

Do not hardcode runtime colors. IntelliJ UI colors must come from the current theme, component state, editor color scheme, or a centralized semantic named color key.

Prefer semantic helpers for common UI roles:

| Need | Preferred API |
|---|---|
| Ordinary label text | `UIUtil.getLabelForeground()` |
| Secondary/help text | `UIUtil.getContextHelpForeground()` |
| Info label text | `UIUtil.getLabelInfoForeground()` |
| Success label text | `UIUtil.getLabelSuccessForeground()` |
| Error label text | `UIUtil.getErrorForeground()` |
| Warning label text | `JBUI.CurrentTheme.Label.warningForeground()` |
| Generic label foreground by state | `JBUI.CurrentTheme.Label.foreground(selected)` / `disabledForeground(selected)` |
| Inactive secondary text | `NamedColorUtil.getInactiveTextColor()` |
| Bounds and standard border color | `NamedColorUtil.getBoundsColor()` / `JBColor.border()` |
| Tooltips | `UIUtil.getToolTipForeground()` / `getToolTipBackground()` / `JBUI.CurrentTheme.Tooltip.*` |
| Links | `JBUI.CurrentTheme.Link.Foreground.ENABLED` / `HOVERED` / `PRESSED` / `VISITED` / `DISABLED` / `SECONDARY` |
| List renderer text/background | `UIUtil.getListForeground(selected, focused)` / `UIUtil.getListBackground(selected, focused)` |
| Tree renderer text/background | `UIUtil.getTreeForeground(selected, focused)` / `UIUtil.getTreeBackground(selected, focused)` |
| Non-selected tree content | `UIUtil.getTreeForeground()` / `UIUtil.getTreeBackground()` |

Prefer `JBUI.CurrentTheme` for component-area colors and borders:

| Need | Preferred API |
|---|---|
| Popup background | `JBUI.CurrentTheme.Popup.BACKGROUND` |
| Complex popup header | `JBUI.CurrentTheme.ComplexPopup.HEADER_BACKGROUND` |
| Separators | `JBUI.CurrentTheme.CustomFrameDecorations.separatorForeground()` |
| Advertiser/footer surfaces | `JBUI.CurrentTheme.Advertiser.foreground()` / `background()` / `border()` |
| Links | `JBUI.CurrentTheme.Link.Foreground.ENABLED` |
| Tree selection state | `JBUI.CurrentTheme.Tree.foreground(...)` and selection helpers |
| Validation errors | `JBUI.CurrentTheme.Validator.errorBorderColor()` / `errorBackgroundColor()` |
| Validation warnings | `JBUI.CurrentTheme.Validator.warningBorderColor()` / `warningBackgroundColor()` |
| Focus error/warning outlines | `JBUI.CurrentTheme.Focus.errorColor(active)` / `warningColor(active)` |
| Banner-like surfaces | `JBUI.CurrentTheme.Banner.*` |
| Notification tool-window surfaces | `JBUI.CurrentTheme.NotificationError.*`, `NotificationWarning.*`, `NotificationInfo.*` |
| Icon badges | `JBUI.CurrentTheme.IconBadge.*` |

Use `JBColor.lazy { ... }` for colors that depend on runtime state or the active editor color scheme:

```kotlin
val bg = JBColor.lazy { EditorColorsManager.getInstance().globalScheme.defaultBackground }
```

Use `JBColor.namedColor("Some.Semantic.Key", fallback)` only when defining or consuming a semantic color key. Prefer a fallback from an existing theme API over numeric RGB values in examples.

For HTML/CSS snippets, compute the color from a theme API and convert it with `ColorUtil.toHtmlColor(...)`. Do not write hardcoded CSS color literals.

```kotlin
val fg = ColorUtil.toHtmlColor(UIUtil.getContextHelpForeground())
val html = HtmlChunk.span("color: $fg").addText(text)
```

Recommended examples:

```kotlin
label.applyToComponent {
    foreground = UIUtil.getContextHelpForeground()
    font = JBFont.medium()
}
```

```kotlin
foreground = if (selected) {
    UIUtil.getTreeForeground(true, hasFocus)
} else {
    UIUtil.getContextHelpForeground()
}
```

Avoid inline `Color(...)`, numeric `JBColor(...)`, `Gray.xNN`, `JBColor.GRAY`, and hex color literals in runtime UI code. The exception is a centralized semantic color definition with a named color key when no existing platform key exists.

## Theme-Derived Fonts

Do not hardcode font sizes or font families. IntelliJ fonts must come from component defaults, platform typography helpers, or existing component fonts.

- Prefer component default fonts when no style change is needed.
- Use `JBFont.h1()`, `JBFont.h2()`, `JBFont.h3()`, and `JBFont.h4()` for headings.
- Use `.asBold()`, `.asItalic()`, and `.asPlain()` for style changes on `JBFont` values.
- Use `JBFont.regular()`, `JBFont.medium()`, and `JBFont.small()` for regular and secondary text.
- Use `UIUtil.getLabelFont(UIUtil.FontSize.SMALL)` / `MINI` only when an API expects a raw `Font` and `JBFont` / `RelativeFont` is not a good fit.
- Use `RelativeFont` when adjusting an existing component font relatively.
- Use `RelativeFont.fromResource(...)` for theme-configurable font offsets when matching platform component patterns.
- Use `JBUI.Fonts.smallFont()` only when matching an existing platform component pattern that expects it.
- If editor-like text needs editor typography, derive it from the editor color scheme or existing editor component instead of hardcoding a font.

For errors, grayed text, shortcuts, and links in renderers, prefer `SimpleTextAttributes.ERROR_ATTRIBUTES`, `GRAYED_ATTRIBUTES`, `SHORTCUT_ATTRIBUTES`, and `LINK_ATTRIBUTES` rather than manually selecting colors and styles.

Recommended examples:

```kotlin
label(title).applyToComponent {
    font = JBFont.h3().asBold()
}
```

```kotlin
RelativeFont.BOLD.install(label)
```

Avoid `Font("...")`, raw font sizes, and `deriveFont(14f)` style examples.

## Kilo Session Styling

For session/chat UI under `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/session/`, keep general UI chrome separate from transcript styling.

- Use `ai.kilocode.client.ui.UiStyle` for general UI helpers: `Colors`, `Borders`, `Insets`, `Gap`, `Space`, `Size`, and `Buttons`.
- Use `ai.kilocode.client.session.ui.SessionStyle` for session transcript/content styling that follows editor settings or live transcript configuration.
- `SessionStyle` is for user/assistant transcript text, reasoning text, tool output, prompt editor text, and markdown renderer fields such as `font`, `codeFont`, and future link/code-block styles.
- Long-lived session components should implement or propagate `SessionStyleTarget.applyStyle(style)` instead of reading editor globals once in constructors.
- Do not call `EditorColorsManager.getInstance().globalScheme` directly from individual views unless extending `SessionStyle.current()`.
- New transcript renderers must apply the current `SessionStyle` snapshot and ensure child parts created after a style change receive the queued style.
- Keep non-transcript IDE chrome on platform/UI style unless it is intentionally part of the transcript reading experience.

Use `UiStyle` for the surrounding card chrome and `SessionStyle` for transcript content inside it:

```kotlin
class ExamplePartView : PartView() {
    override fun applyStyle(style: SessionStyle) {
        var changed = false
        if (md.font != style.transcriptFont) {
            md.font = style.transcriptFont
            changed = true
        }
        if (md.codeFont != style.editorFamily) {
            md.codeFont = style.editorFamily
            changed = true
        }
        if (!changed) return
        revalidate()
        repaint()
    }
}
```

## Borders, Insets, and Spacing

- Always create borders via `JBUI.Borders.empty(top, left, bottom, right)` and insets via `JBUI.insets()` so they are DPI-aware and auto-update on zoom.
- Use `JBUI.scale(int)` for any pixel dimension to ensure proper HiDPI scaling.
- Prefer Kotlin UI DSL gaps and row layout semantics over manually assigning borders or insets.
- Do not use `EmptyBorder`, raw `Insets`, or raw `Dimension` unless there is no platform alternative and the reason is obvious.

Theme-dependent borders, insets, colors, and corner arcs must be re-evaluated when the Look and Feel changes. Do not assign a theme-derived border once in a constructor for a long-lived component.

Prefer overriding `updateUI()` for component-local updates:

```kotlin
class KiloPanel : JPanel() {
    override fun updateUI() {
        super.updateUI()
        border = JBUI.Borders.customLine(
            JBColor.namedColor("KiloPanel.borderColor", JBColor.border()),
            1,
        )
    }
}
```

For long-lived tool-window panels or components that need explicit Look and Feel handling outside normal Swing updates, subscribe to `LafManagerListener.TOPIC` and reapply theme-dependent borders or cached UI state there.

Use `JBValue.UIInteger` for themeable arc values, because defaults differ by theme:

| Key | Use |
|---|---|
| `Component.arc` | General component corners |
| `Button.arc` | Button corners |
| `Popup.Selection.arc` | Popup selection background |
| `TabbedPane.tabSelectionArc` | Tab selection indicator |
| `Tree.Selection.arc` | Tree selection background |

```kotlin
val arc = JBValue.UIInteger("Component.arc", 5).get()
val button = JBValue.UIInteger("Button.arc", 6).get()
```

Only define plugin-owned theme keys when a platform key is not enough. Themeable insets can use `JBUI.insets("KiloPanel.insets", JBUI.insets(4, 8))`; themeable colors should use `JBColor.namedColor("KiloPanel.borderColor", fallback)`.

Themes can override plugin-owned UI keys through the `ui` section:

```json
{
  "ui": {
    "KiloPanel.insets": "6,12,6,12",
    "KiloPanel.gap": 20,
    "KiloPanel.borderColor": "#FF0000",
    "KiloPanel.arc": 10
  }
}
```

Expose intentional custom UI keys to theme authors with the `themeMetadataProvider` extension point and a `*.themeMetadata.json` file.

```xml
<themeMetadataProvider path="/META-INF/Kilo.themeMetadata.json"/>
```

```json
{
  "name": "Kilo Code",
  "fixed": false,
  "ui": [
    { "key": "KiloPanel.borderColor", "description": "Panel border color" },
    { "key": "KiloPanel.gap", "description": "Gap between panel items" }
  ]
}
```

## Validation and Error UI

Prefer built-in validation mechanisms over custom error rendering.

- For Kotlin UI DSL, use `validationOnInput`, `validationOnApply`, `validationInfo`, `errorOnApply`, and `addValidationRule` on cells.
- For DSL dialogs and settings panels, call `DialogPanel.registerValidators(disposable)` when input validation should run continuously.
- Call `DialogPanel.validateAll()` before `apply()` when submitting a DSL panel manually.
- In `DialogWrapper`, use `doValidate()` and return `ValidationInfo(message, component)` for errors.
- Use `ValidationInfo.asWarning()` for warnings and `withOKEnabled()` when a warning should not block submission.
- For hand-built Swing forms, use `ComponentValidator` with `withValidator`, `withFocusValidator`, and `andRegisterOnDocumentListener` instead of custom tooltip/error border logic.
- If custom validation painting is unavoidable, use `JBUI.CurrentTheme.Validator.*` and `JBUI.CurrentTheme.Focus.*` colors.

Kotlin UI DSL example:

```kotlin
textField()
    .validationOnInput {
        if (it.text.isBlank()) error(KiloBundle.message("settings.name.required")) else null
    }
```

Dialog validation example:

```kotlin
override fun doValidate(): ValidationInfo? {
    if (field.text.isBlank()) return ValidationInfo(KiloBundle.message("settings.name.required"), field)
    return null
}
```

## Icons

- Reuse platform icons. Browse at https://intellij-icons.jetbrains.design and access via `AllIcons.*` constants.
- Custom icons belong in `resources/icons/`.
- Load custom icons via `IconLoader.getIcon("/icons/foo.svg", MyClass::class.java)`.
- Organize custom icons in an `icons` package or a `*Icons` object with `@JvmField` on each constant.
- Icon sizing guideline values: actions/nodes = 16x16, tool window = 13x13 classic or 20x20 + 16x16 compact New UI, editor gutter = 12x12 classic or 14x14 New UI.
- Dark variants: `icon.svg` + `icon_dark.svg`.
- HiDPI variants: `icon@2x.svg` + `icon@2x_dark.svg`.
- New UI support: place New UI icons in `expui/`, create `*IconMappings.json`, register via `com.intellij.iconMapper` extension point.
- For SVG asset palette values, follow the IntelliJ icon asset guidelines. Do not copy guideline color literals into runtime Swing UI code.

### SVG Assets

IntelliJ does not theme SVG icons with `currentColor`, CSS classes, CSS variables, inherited styles, or `<style>` blocks. `SVGLoader` patches icon colors by matching literal hex values in `fill` and `stroke` attributes against the active theme palette.

Use hardcoded palette hex values in SVG assets and provide dark variants. This exception applies to icon asset files only; runtime Swing UI code must still derive colors from theme APIs.

| Do | Do not |
|---|---|
| `fill="#6E6E6E"` | `fill="currentColor"` |
| `stroke="#3574F0"` | CSS variables or classes |
| `icon.svg` plus `icon_dark.svg` | `<style>` blocks for theming |
| `fill-opacity="0.5"` | Inherited styling |

Classic icon palette examples:

| Palette key | Light hex | Dark hex |
|---|---|---|
| `Actions.Grey` | `#6E6E6E` | `#AFB1B3` |
| `Actions.Red` | `#DB5860` | `#C75450` |
| `Actions.Green` | `#59A869` | `#499C54` |
| `Actions.Blue` | `#389FD6` | `#3592C4` |
| `Objects.Grey` | `#9AA7B0` |  |
| `Objects.Blue` | `#40B6E0` |  |

New UI palette examples:

| Palette key | Light hex | Dark hex |
|---|---|---|
| `Gray.Stroke` | `#6C707E` | `#CED0D6` |
| `Gray.Fill` | `#EBECF0` | `#43454A` |
| `Gray.SecondaryStroke` | `#A8ADBD` | `#6F737A` |
| `Blue.Stroke` | `#3574F0` | `#548AF7` |
| `Blue.Fill` | `#EDF3FF` | `#25324D` |
| `Blue.Solid` | `#4682FA` |  |
| `Green.Stroke` | `#208A3C` | `#57965C` |
| `Red.Stroke` | `#DB3B4B` | `#DB5C5C` |

For checkbox, radio, or similar control SVGs that need independent fill and stroke theming, use an `id` in the `fillKey_strokeKey` format. The SVG patcher splits the ID on `_` and applies the keys independently.

```xml
<rect id="Checkbox.Background.Selected_Checkbox.Border.Selected"
      x="4.5" y="4.5" width="15" height="15" rx="2.5"
      fill="#3574F0" stroke="#3574F0"/>
```

Themes can override palette colors through `icons.ColorPalette`:

```json
{
  "icons": {
    "ColorPalette": {
      "Actions.Grey": "#A8ADBD",
      "Blue.Stroke": "#548AF7"
    }
  }
}
```

## Notifications

- Declare in module XML: `<notificationGroup id="Kilo Code" displayType="BALLOON"/>`.
- Show with `Notification("Kilo Code", "message", NotificationType.INFORMATION).notify(project)`.
- Add actions with `.addAction(NotificationAction.createSimpleExpiring("Label") { ... })`.
- Sticky notifications use `displayType="STICKY_BALLOON"` and `.setSuggestionType(true)`.
- Tool-window-bound notifications use `displayType="TOOL_WINDOW" toolWindowId="Kilo Code"`.
- Prefer non-modal notifications over `Messages.show*()` dialogs.

## Popups

- Use `JBPopupFactory.getInstance()` for lightweight floating UI with no chrome and auto-dismiss on focus loss.
- Use `createComponentPopupBuilder(component, focusable)` for arbitrary Swing content.
- Use `createPopupChooserBuilder(list)` for item selection.
- Use `createActionGroupPopup()` for action menus.
- Show with `showInBestPositionFor(editor)`, `showUnderneathOf(component)`, or `showInCenterOf(component)`.

## IntelliJ-Native List Pickers

Use this guidance when building native list pickers that need richer presentation than a simple action menu. Common cases include two-line rows with title and description, active/current item checkmarks, inactive icon placeholders for alignment, hover behaving like selection, optional inline actions such as favorites, and optional filtering or search.

`ListPopupImpl` / `BaseListPopupStep` are fine for simple menu-like lists. Do not make them the main abstraction for reusable rich list UIs because they are popup-first and action-step oriented.

### Recommended Building Blocks

- Use `JBList<T>` for the list.
- Use `CollectionListModel<T>` for simple item storage.
- Use `FilteringListModel<T>` or a small custom `AbstractListModel<T>` for filtering and ranking.
- Use `TreeUIHelper.getInstance().installListSpeedSearch(list) { ... }` for speed search on current IntelliJ platform APIs.
- Use `ListUtil.installAutoSelectOnMouseMove(list)` for IntelliJ popup-like hover selection.
- Use `ScrollingUtil.installActions(list)` for keyboard navigation.
- Use `JBPopupFactory.createComponentPopupBuilder(component, preferredFocusComponent)` for popup wrapping.
- Use `ScrollPaneFactory.createScrollPane(list)` or `JBScrollPane` for scrolling.
- Use `SimpleColoredComponent`, `SimpleTextAttributes`, `JBLabel`, and `JPanel` for custom renderers.
- Use `AllIcons.Actions.Checked` and `EmptyIcon.create(...)` for active-item alignment.

### Renderer Layout Pattern

Use layout managers for sizing and alignment. Avoid `preferredSize`, `maximumSize`, and manual pixel sizing for normal badge or row layout. A good rich row renderer structure is:

- Root renderer extends `JPanel(BorderLayout())`.
- Root renderer is opaque and owns the selected/unselected background.
- All child components are transparent unless there is a specific rendering reason.
- West: `JBLabel` with icon centered horizontally and vertically.
- Center: `JPanel(BorderLayout())`.
- Center north: `FlowLayout(FlowLayout.LEFT, 0, 0)` with title first, then optional tag/badge.
- Center center: description component.
- Set the background once on the root renderer using list selection colors.
- Use selected-safe foreground colors for text.
- Do not import or use `java.awt.Component` as a renderer return type; return the concrete Swing component such as `JPanel`.

```kotlin
private class PickerRenderer<T>(
    private val active: () -> T?,
) : JPanel(BorderLayout()), ListCellRenderer<T> {
    private val icon = JBLabel().apply {
        isOpaque = false
        horizontalAlignment = SwingConstants.CENTER
        verticalAlignment = SwingConstants.CENTER
    }
    private val title = SimpleColoredComponent().apply { isOpaque = false }
    private val description = SimpleColoredComponent().apply { isOpaque = false }
    private val tag = JBLabel().apply { isOpaque = false }
    private val header = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
        isOpaque = false
        add(title)
        add(tag)
    }
    private val body = JPanel(BorderLayout()).apply {
        isOpaque = false
        add(header, BorderLayout.NORTH)
        add(description, BorderLayout.CENTER)
    }

    init {
        isOpaque = true
        add(icon, BorderLayout.WEST)
        add(body, BorderLayout.CENTER)
    }

    override fun getListCellRendererComponent(
        list: JList<out T>,
        value: T,
        index: Int,
        selected: Boolean,
        focused: Boolean,
    ): JPanel {
        val focus = list.hasFocus() || focused
        background = UIUtil.getListBackground(selected, focus)
        val fg = UIUtil.getListForeground(selected, focus)
        val weak = if (selected) fg else UIUtil.getContextHelpForeground()
        // Clear and append title/description fragments here.
        return this
    }
}
```

### Active Icon Alignment

- Use a check icon for the active item.
- Use `EmptyIcon.create(checkIcon)` for inactive items so text aligns.
- Prefer a single check icon if selected and unselected variants visually jump.
- Only use selected-specific icons when contrast requires it and the icon dimensions/visual alignment remain stable.

### Selection And Hover

- Install `ListUtil.installAutoSelectOnMouseMove(list)` so hover and selection are the same UI state.
- Do not implement a separate hover background in the renderer.
- Set row selection background on the renderer root only.
- Use `UIUtil.getListForeground(selected, focused)` and `UIUtil.getListBackground(selected, focused)`, or `ListUiUtil.WithTallRow` when available and appropriate.

### Popup Wrapper

- For rich reusable components, prefer `JBPopupFactory.createComponentPopupBuilder(component, focusComponent)`.
- Configure `setRequestFocus(true)`, `setCancelOnClickOutside(true)`, `setCancelKeyEnabled(true)`, and usually `setMovable(false)`.
- Close with `popup.closeOk(null)` after activation.
- Use `showUnderneathOf(component)`, `showInBestPositionFor(editor)`, or `PopupShowOptions.aboveComponent(component)` depending on the trigger context.

### Activation And Inline Actions

- Enter should activate the selected item.
- Mouse activation should bounds-check `locationToIndex` and `getCellBounds`.
- Renderer child components are not real per-row components; do not add listeners to renderer labels.
- For inline actions such as favorites, hit-test against a laid-out renderer component and consume the click before row activation.

### Filtering

- Use `ListWithFilter.wrap(...)` when a simple searchable text representation is enough.
- Use `SearchTextField` plus `FilteringListModel` or a small custom `AbstractListModel` when custom matching/ranking is needed.
- Clear selection when filtered results are empty and provide `list.emptyText.text`.

### Avoid

- Do not use `ListPopupImpl` as the main abstraction for reusable rich list components.
- Do not use renderer `preferredSize` / `maximumSize` to force normal row or badge layout; fix the layout manager instead.
- Do not set backgrounds on nested renderer children when the root row background should be continuous.
- Do not hardcode runtime colors or raw Swing replacements where IntelliJ equivalents exist.
- Do not sort or reorder items based on active selection unless explicitly required; keep popup ordering stable.

### References

- `ListUtil.installAutoSelectOnMouseMove`: https://github.com/JetBrains/intellij-community/blob/master/platform/platform-api/src/com/intellij/ui/ListUtil.java
- `PopupChooserBuilder` flow: https://github.com/JetBrains/intellij-community/blob/master/platform/platform-api/src/com/intellij/openapi/ui/popup/PopupChooserBuilder.java
- `ListWithFilter`: https://github.com/JetBrains/intellij-community/blob/master/platform/platform-api/src/com/intellij/ui/speedSearch/ListWithFilter.java
- `PopupListElementRenderer`: https://github.com/JetBrains/intellij-community/blob/master/platform/platform-impl/src/com/intellij/ui/popup/list/PopupListElementRenderer.java
- `ListUiUtil.WithTallRow`: https://github.com/JetBrains/intellij-community/blob/master/platform/util/ui/src/com/intellij/util/ui/ListUiUtil.kt

## Lists and Trees

- Use `JBList`, not `JList`, for empty text, busy indicator, and tooltip truncation.
- Use `Tree`, not `JTree`, for wide selection painting and auto-scroll on drag-and-drop.
- Use `ColoredListCellRenderer` / `ColoredTreeCellRenderer` for custom renderers.
- Use `append()` for styled text and `setIcon()` for icons.
- Use `ListSpeedSearch(list)` / `TreeSpeedSearch(tree)` for speed search.
- Use `ToolbarDecorator.createDecorator(list).setAddAction { }.setRemoveAction { }.createPanel()` for editable lists with add/remove/reorder toolbar.

## Before Returning Code

Review generated UI code and remove:

- Explicit default property assignments such as unnecessary `isOpaque = false`
- Unnecessary `preferredSize`, `minimumSize`, or `maximumSize`
- Raw `Dimension`, `Insets`, `EmptyBorder`, or `Color`
- Inline runtime colors such as `Color(...)`, numeric `JBColor(...)`, `Gray.xNN`, `JBColor.GRAY`, or hex color literals
- Raw CSS color literals; `ColorUtil.toHtmlColor(themeColor)` is allowed because the source color is theme-derived
- Hardcoded font families, raw font sizes, or numeric-size `deriveFont(...)` calls
- Raw Swing components where IntelliJ replacements exist
- Manual layout code that Kotlin UI DSL can express cleanly
- Hardcoded spacing that should be a DSL gap, row gap, or `JBUI` value
- Cached `JBValue.UIInteger(...).get()` values in custom layouts; call `.get()` during layout and sizing instead
- Theme-derived borders, insets, colors, or arcs assigned once in constructors without `updateUI()` or Look and Feel handling
- SVG assets using `currentColor`, CSS variables, CSS classes, `<style>` blocks, or inherited styling for IntelliJ icon theming
- Extra helpers that do not make the UI clearer or more reusable

## References

- IntelliJ Platform UI Guidelines: https://jetbrains.design/intellij/
- User Interface Components: https://plugins.jetbrains.com/docs/intellij/user-interface-components.html
- UI FAQ: https://plugins.jetbrains.com/docs/intellij/ui-faq.html
- Kotlin UI DSL v2: https://plugins.jetbrains.com/docs/intellij/kotlin-ui-dsl-version-2.html
- Split mode for remote development: https://plugins.jetbrains.com/docs/intellij/split-mode-for-remote-development.html
