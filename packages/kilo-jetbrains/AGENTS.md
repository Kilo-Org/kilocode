# AGENTS.md — Kilo JetBrains Plugin

## Skills

- Use `packages/kilo-jetbrains/.kilo/skills/jetbrains-ui-style/SKILL.md` when creating, modifying, or reviewing Kotlin/Swing UI code for this plugin. It covers IntelliJ UI conventions, platform components, theme-aware colors/fonts, spacing, manual Swing vs Kotlin UI DSL, session transcript styling, and retained Swing component-state patterns for hover/expand/update flows.

## Architecture (Split Mode)

- **Split-mode plugin** with three Gradle modules: `shared/`, `frontend/`, `backend/`. The module descriptors are `kilo.jetbrains.shared.xml`, `kilo.jetbrains.frontend.xml`, `kilo.jetbrains.backend.xml` — these must stay in sync with `plugin.xml`'s `<content>` block.
- Reference template for the split-mode structure: https://github.com/JetBrains/intellij-platform-modular-plugin-template
- Official docs: https://plugins.jetbrains.com/docs/intellij/split-mode-for-remote-development.html
- The JetBrains reference template mirrors our overall structure well: root project assembles the final plugin, `shared` holds contracts, `frontend` holds UI, and `backend` holds project-local logic. Copy its split-mode wiring and RPC layout, but **do not** copy its Compose UI approach.
- Kotlin source goes under `{module}/src/main/kotlin/ai/kilocode/jetbrains/`. Package name is `ai.kilocode.jetbrains` (matches `group` in root `build.gradle.kts`).
- **Module placement rules**: backend modules host project model, indexing, analysis, execution, and CLI process management. Frontend modules host UI, typing assistance, and latency-sensitive features. Shared modules define RPC interfaces and data types used by both sides.
- In monolithic IDE mode (non-remote), all three modules load in one process — split plugins work fine without remote dev.
- Frontend ↔ backend communication uses RPC interfaces defined in `shared/`. Data sent over RPC must use `kotlinx.serialization`. In monolithic mode RPC is just an in-process suspend call.
- **Testing split mode**: run `./gradlew generateSplitModeRunConfigurations` to create a "Run IDE (Split Mode)" config that starts both frontend and backend processes locally. Emulate latency via the Split Mode widget (requires internal mode: `-Didea.is.internal=true`).
- The root `plugin.xml` is wiring only: keep plugin metadata and the `<content>` block there. Register services, extensions, listeners, and actions in the module XML descriptors, not in root `plugin.xml`.
- Module descriptor files must live directly in `{module}/src/main/resources/`, not in `META-INF/`.
- Module XMLs use `<dependencies>`, not `<depends>`. The allowed top-level registration tags are limited; keep module XMLs focused on `<resource-bundle>`, `<extensions>`, `<extensionPoints>`, `<actions>`, `<applicationListeners>`, and `<projectListeners>`.
- Module dependencies determine where code loads. In monolith mode both frontend and backend dependencies are satisfied, so both modules load together.
- Run inspection `Plugin DevKit | Code | Frontend and Backend API Usage` when adding or moving split-mode code.

## Split Feature Development

- For any new split feature, follow this flow: put UI in `frontend`, heavy/project-local logic in `backend`, and shared contracts in `shared`.
- Shared cross-process payloads must be `@Serializable`. Keep `shared` lightweight and avoid pulling frontend-only or backend-only APIs into it.
- Define RPC APIs in `shared` with `@Rpc`, `RemoteApi<Unit>`, and `suspend` methods only.
- Implement RPC providers in `backend` and register them via `com.intellij.platform.rpc.backend.remoteApiProvider` when RPC is introduced.
- Call RPC from `frontend` coroutines only. Never call RPC on the EDT; do not paper over this with blocking wrappers.
- Wrap long-lived RPC calls and flows in `durable {}` so they survive reconnects and backend restarts.
- For backend -> frontend push events, prefer Remote Topics over ad-hoc polling.
- Render empty state immediately and progressively fill data from the backend. Do not block first paint on backend state.
- Avoid chatty RPC. Debounce UI events, batch requests, cache results where appropriate, and page large datasets instead of sending everything at once.
- If a new split feature requires RPC support similar to the JetBrains template, mirror the template's wiring: `shared` and `frontend` use the RPC/serialization plugins, and the backend adds the required backend RPC platform modules.

## CLI Integration

- CLI process spawning, extraction, and lifecycle belong in `backend`.
- Detect architecture with `com.intellij.util.system.CpuArch.CURRENT`, not `System.getProperty("os.arch")`.
- Detect OS with `com.intellij.openapi.util.SystemInfo.isMac` / `isLinux` / `isWindows`.
- For packaging/build plumbing, see `script/build.ts` and `backend/build.gradle.kts`.

## Dependencies

- **Always bundle third-party libraries with the plugin.** Do not rely on libraries bundled with the IntelliJ platform (e.g. OkHttp, Gson, Guava, kotlinx-serialization-json). The IDE's bundled versions change across releases without notice and can cause version collisions, classloader conflicts, or silent API breakage. Declare all third-party dependencies as `implementation` in the relevant `build.gradle.kts` so they ship inside the plugin JAR and load from the plugin's own classloader.
- `kotlinx.coroutines` is the one mandatory exception — it is provided by the platform and must not be bundled (the IntelliJ Platform Gradle plugin enforces this automatically).
- Pin exact versions in `gradle/libs.versions.toml` and reference them via the version catalog (`libs.*`) in `build.gradle.kts`. Never hardcode version strings in `build.gradle.kts`.

## Services and Coroutines

- Official docs: https://plugins.jetbrains.com/docs/intellij/plugin-services.html and https://plugins.jetbrains.com/docs/intellij/launching-coroutines.html
- **Prefer light services**: annotate with `@Service` (or `@Service(Service.Level.PROJECT)`) instead of registering in XML when the service won't be overridden or exposed as API. Light services must be `final` in Java (no `open` in Kotlin), cannot use constructor injection of other services, and don't support `os`/`client`/`overrides` attributes.
- Non-light services that need XML registration go in `kilo.jetbrains.backend.xml` under `<extensions defaultExtensionNs="com.intellij"><applicationService>` (or `<projectService>`).
- **Constructor-injected `CoroutineScope`**: the recommended way to launch coroutines. Each service gets its own scope (child of an intersection scope). The scope is cancelled on app/project shutdown or plugin unload. Supported signatures: `MyService(CoroutineScope)` for app services, `MyService(Project, CoroutineScope)` for project services.
- The injected scope's context contains `Dispatchers.Default` and `CoroutineName(serviceClass)`. Switch to `Dispatchers.IO` for blocking I/O.
- **Avoid heavy constructor work** — defer initialization to methods. Never cache service instances in fields; always retrieve via `service<T>()` at the call site.
- `runBlockingCancellable` exists but is **not recommended** — use service scopes instead. For actions, use `currentThreadCoroutineScope()` which lets the Action System cancel the coroutine.
- No extra coroutines dependency is needed — `kotlinx.coroutines` is bundled by the IntelliJ platform and available transitively.

## CLI Server Protocol

- The plugin spawns `kilo serve --port 0` (OS assigns random port) and reads stdout for `listening on http://...:(\d+)` to discover the port.
- A random 32-byte hex password is passed via `KILO_SERVER_PASSWORD` env var for Basic Auth.
- Key env vars: `KILO_CLIENT=jetbrains`, `KILO_PLATFORM=jetbrains`, `KILO_APP_NAME=kilo-code`, `KILO_ENABLE_QUESTION_TOOL=true`.
- This is the same protocol used by the VS Code extension (`packages/kilo-vscode/src/services/cli-backend/server-manager.ts`).

## Build

- **Full build**: `bun run build` from `packages/kilo-jetbrains/` (builds CLI + Gradle plugin).
- **Gradle only**: `./gradlew buildPlugin` from `packages/kilo-jetbrains/` (requires CLI binaries already present).
- **Via Turbo**: `bun turbo build --filter=@kilocode/kilo-jetbrains` from repo root.
- **Run in sandbox**: `./gradlew runIde` — launches sandboxed IntelliJ with the plugin. Does NOT build CLI binaries.

## Files That Must Change Together

- `plugin.xml` `<content>` entries ↔ module XML descriptors (`kilo.jetbrains.{shared,frontend,backend}.xml`)
- Service classes ↔ `<applicationService>`/`<projectService>` entries in the corresponding module XML
- `script/build.ts` platform list ↔ `backend/build.gradle.kts` `requiredPlatforms` list

## Session Component

The chat session feature uses a three-layer Model / Controller / View architecture. All files live under
`frontend/src/main/kotlin/ai/kilocode/client/session/`.

### Layers

**`SessionModel`** (`model/SessionModel.kt`)

- Single source of truth for session content and runtime state.
- **EDT-only access** — no synchronisation. `SessionController` guarantees all reads and writes happen on the EDT.
- State is mutated only through dedicated methods (`setState`, `upsertMessage`, `setDiff`, etc.), never via direct field assignment from outside the model.
- Every mutation fires a sealed `SessionModelEvent` that carries the data needed for rendering — UI never needs to read back from the model after receiving an event.
- Each event overrides `toString()` with a compact, stable label (e.g. `"MessageAdded msg1"`, `"DiffUpdated files=2"`). Tests assert events by comparing joined `toString()` output.
- `loadHistory()` and `clear()` reset all state fields — diff, todos, compactionCount, messages, and `SessionState.Idle`. Call them when opening or clearing a session.

**`SessionController`** (`SessionController.kt`)

- Owns one `SessionModel`. UIs read from `model` and subscribe to `SessionModelEvent` via `model.addListener()`.
- Accepts an optional `id` at construction.
  - `id = null` → lazily creates a new session on the first `prompt()` call. This guarantees events are subscribed before the prompt is sent, eliminating race conditions.
  - `id != null` → immediately loads history and subscribes to SSE events on construction.
- After history load, `recoverPending()` seeds state in this priority order: (1) pending permission, (2) pending question, (3) current session status (`busy`/`retry`/`offline` from `KiloSessionService.statuses`), (4) `Idle`.
- All SSE events are filtered by `sessionID` before being handled. `session.error` events with `null` sessionID are treated as global and pass through.
- Publishes coarser lifecycle updates (app/workspace changes, view switching) via `SessionControllerEvent` to registered listeners — keep these separate from the fine-grained `SessionModelEvent` stream.

**View** (UI classes under `ui/`)

- Listens to `SessionModelEvent` via `model.addListener(parent) { event -> when(event) { ... } }`.
- The `when` block must be exhaustive — add `-> Unit` branches for events the view intentionally ignores so new events surface as compile errors.
- Views call `SessionController` actions (`prompt()`, `replyPermission()`, etc.) on the EDT; the controller dispatches RPC calls to a coroutine scope.
- Views must never access RPC or services directly — everything goes through the controller.

### Adding a New Event

1. Add a subclass to `SessionModelEvent` with a stable `toString()`.
2. Add the corresponding state field and mutation method to `SessionModel`. Reset the field in both `loadHistory()` and `clear()`.
3. Handle the new `ChatEventDto` in `SessionController.handle()` by calling the model mutation method.
4. Add `-> Unit` stubs for the new event in any existing exhaustive `when` blocks in view code.

### Testing

Controller tests extend `SessionControllerTestBase` (`test/…/session/SessionControllerTestBase.kt`),
which provides a real IntelliJ Application and EDT via `BasePlatformTestCase`, real frontend services
wired to `FakeSessionRpcApi`, and a set of shared helpers.

**Two setups:**

| Setup | When to use |
|---|---|
| `val (m, events, modelEvents) = prompted()` | New-session flow — sets app/workspace to ready, creates a controller with no ID, sends an initial prompt. `model.showMessages` is `true`. Start all event-driven tests from here. |
| `controller("ses_test")` + manual `appRpc`/`projectRpc` setup + `flush()` | Existing-session flow — opens a specific session, triggers history load and `recoverPending()`. `model.showMessages` is `false`. Use for recovery and history tests. Pass `show = false` to `assertSession`. |

**Core assertion helpers:**

```kotlin
// Full controller state — includes model transcript + status line.
// show=true is the default; pass show=false for existing-session tests.
assertSession("""
    assistant#msg1
    text#prt1:
      hello

    [code] [kilo/gpt-5] [idle]
""", m)

// Just the model transcript (no status line)
assertModel("diff: src/A.kt src/B.kt", m)

// Model event stream — one event per line via event.toString()
assertModelEvents("""
    MessageAdded msg1
    ContentAdded msg1/prt1
""", modelEvents)

// Controller lifecycle events
assertControllerEvents("WorkspaceReady", events)
```

**Emitting events and flushing:**

```kotlin
emit(ChatEventDto.TurnOpen("ses_test"))         // emits + flushes by default
emit(ChatEventDto.PartDelta(…), flush = false)  // batch without intermediate flush
flush()                                          // settle coroutines + drain EDT
```

**`FakeSessionRpcApi` configurable state:**

| Field | Purpose |
|---|---|
| `rpc.events` (`MutableSharedFlow`) | Emit `ChatEventDto` events the controller will receive |
| `rpc.statuses` (`MutableStateFlow<Map<String, SessionStatusDto>>`) | Seed the status map read during `recoverPending()` |
| `rpc.history` | Messages returned by `messages()` (history load) |
| `rpc.pendingPermissionList` | Permissions returned during recovery |
| `rpc.pendingQuestionList` | Questions returned during recovery |
| `rpc.prompts`, `rpc.permissionReplies`, etc. | Call tracking for RPC side-effects |

**String format of `model.toString()`** (used by `assertModel` / `assertSession`):

```
role#msgId
text#partId:
  line one
  line two
---
tool#partId toolName [STATE] optional title
---
question#id
tool: msgId/callId
header: …
prompt: …
option: label - description
multiple: false
custom: true
---
diff: file1 file2
---
todo: [status] content
---
compacted: N
```

Sections are separated by `---`. Only non-empty sections appear. The status line appended by `SessionController.toString()` is:

```
[agentName] [provider/modelId] [idle|busy|retry|offline|error|awaiting-question|awaiting-permission] [optional detail]
```

## UI Design Guidelines

Official references:

- [IntelliJ Platform UI Guidelines](https://jetbrains.design/intellij/)
- [User Interface Components](https://plugins.jetbrains.com/docs/intellij/user-interface-components.html)
- [UI FAQ (colors, borders, icons)](https://plugins.jetbrains.com/docs/intellij/ui-faq.html)

### Do Not Use Kotlin Compose

**Do not use Kotlin Compose or `intellij.platform.compose` in this plugin.** The JetBrains modular template uses Compose for its demo tool window, but Kilo should use standard Swing with IntelliJ Platform components only. Keep all plugin UI in the existing Swing-based stack.

### Do Not Use JCEF (Embedded Browser)

**Do not use JCEF (`JBCefBrowser`) in this plugin.** JCEF does not work in JetBrains remote development (split mode): the frontend process runs on the client machine but JCEF requires a display on the host, making it effectively unusable for remote users. Use standard Swing with IntelliJ Platform components for all UI.

### When to Use What

| Need | API |
|---|---|
| Dialogs, settings pages, forms, any layout with components | **Preferred**: [Kotlin UI DSL v2](https://plugins.jetbrains.com/docs/intellij/kotlin-ui-dsl-version-2.html) (`com.intellij.ui.dsl.builder`) |
| Tool window panels, action-driven UI, custom components | Standard Swing with IntelliJ Platform component replacements (see below) |
| Menus and toolbars | [Action System](https://plugins.jetbrains.com/docs/intellij/action-system.html) |

### Kotlin UI DSL v2 (Preferred)

**Use Kotlin UI DSL v2 as the default way to build UI** for dialogs, settings pages, forms, and any layout composed of standard components. It produces correct spacing, label alignment, HiDPI scaling, and accessibility automatically. Only fall back to manual Swing layout when you need a fully custom component (e.g. a canvas, rich list renderer, or tool-window chrome that the DSL can't express).

The top-level builder is `panel { }` (returns `DialogPanel`). Structure: **panel → row → cells**. Cell factory methods (`textField()`, `checkBox()`, `label()`, etc.) add components. The DSL lives in `com.intellij.ui.dsl.builder`.

To explore DSL capabilities interactively: **Tools → Internal Actions → UI → Kotlin UI DSL → UI DSL Showcase** (requires internal mode: `-Didea.is.internal=true`).

Reference: [Kotlin UI DSL v2 docs](https://plugins.jetbrains.com/docs/intellij/kotlin-ui-dsl-version-2.html)

#### Basics — Panel / Row / Cell

Rows occupy full width. The last cell in a row takes remaining space. Rows have a `layout` property (see Row Layout below).

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

#### Row Layout

Every row uses one of three layouts. Default is `LABEL_ALIGNED` when a label is provided for the row, `INDEPENDENT` otherwise.

| Layout | Behavior |
|---|---|
| `LABEL_ALIGNED` | Label column + content columns, aligned across rows |
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

    row("LABEL_ALIGNED (default with label):") {
        textField()
    }

    row {
        label("INDEPENDENT (default without label):")
        textField()
    }
}
```

#### Components Reference

All cell factory methods available inside `row { }`:

| Method | Description |
|---|---|
| `checkBox("text")` | Checkbox |
| `threeStateCheckBox("text")` | Three-state checkbox |
| `radioButton("text", value)` | Radio button (must be inside `buttonsGroup {}`) |
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
| `textFieldWithBrowseButton()` | Text field + browse dialog |
| `expandableTextField()` | Expandable multi-line text field |
| `extendableTextField()` | Text field with extension icons |
| `intTextField(range)` | Integer input with validation |
| `spinner(intRange)` / `spinner(doubleRange, step)` | Numeric spinner |
| `slider(min, max, minorTick, majorTick)` | Slider (use `.labelTable()` for tick labels) |
| `textArea()` | Multi-line text (use `.rows(n)` and `.align(AlignX.FILL)`) |
| `comboBox(items)` | Combo box / dropdown |
| `comment("text")` | Gray comment text (standalone) |
| `cell(component)` | Wrap any arbitrary Swing component |
| `scrollCell(component)` | Wrap component in a scroll pane |
| `cell()` | Empty placeholder cell for grid alignment |

Key component examples:

```kotlin
panel {
    // Radio button group
    var color = "grey"
    buttonsGroup {
        row("Color:") {
            radioButton("White", "white")
            radioButton("Grey", "grey")
        }
    }.bind({ color }, { color = it })

    // Slider with tick labels
    row("slider:") {
        slider(0, 10, 1, 5)
            .labelTable(mapOf(
                0 to JLabel("0"),
                5 to JLabel("5"),
                10 to JLabel("10"),
            ))
    }

    // Text area with proper alignment
    row {
        label("textArea:")
            .align(AlignY.TOP)
            .gap(RightGap.SMALL)
        textArea()
            .rows(5)
            .align(AlignX.FILL)
    }.layout(RowLayout.PARENT_GRID)
}
```

#### Component Labels

Labels for modifiable components **must** be connected via one of two methods — this ensures correct spacing, mnemonic support, and accessibility:

- **Row label**: `row("&Label:") { textField() }` — mnemonic via `&`, label in left column
- **Cell label**: `textField().label("&Label:", LabelPosition.TOP)` — label attached to cell, optionally on top

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

Note: when a row contains a `checkBox` or `radioButton`, the DSL automatically increases space after the row label per [UI Guidelines](https://plugins.jetbrains.com/docs/intellij/layout.html#checkboxes-and-radio-buttons).

#### Comments

Three types of comments, each with different placement and semantics:

| Type | Method | Placement |
|---|---|---|
| Cell comment (bottom) | `cell.comment("text")` | Below the cell |
| Cell comment (right) | `cell.commentRight("text")` | Right of the cell |
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

Comments support HTML with clickable links (pass a lambda for the click handler), bundled icons via `<icon src='...'>`, and line width control via `maxLineLength` parameter. Use `MAX_LINE_LENGTH_NO_WRAP` to prevent wrapping.

#### Groups and Structure

| Method | Grid | Description |
|---|---|---|
| `panel {}` | Own grid | Sub-panel occupying full width |
| `rowsRange {}` | Parent grid | Grouped rows sharing parent grid — useful with `enabledIf` |
| `group("Title") {}` | Own grid | Titled section with vertical spacing before/after |
| `groupRowsRange("Title") {}` | Parent grid | Titled section sharing parent grid alignment |
| `collapsibleGroup("Title") {}` | Own grid | Expandable section (Tab-focusable, supports mnemonics) |
| `buttonsGroup("Title") {}` | — | Groups `radioButton` or `checkBox` under a title |
| `separator()` | — | Horizontal separator line |
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

#### Gaps and Spacing

- **Horizontal gaps**: `cell.gap(RightGap.SMALL)` between a label-like checkbox and its related field. Medium gap is the default between cells.
- **Two-column layout**: `twoColumnsRow({}, {})` or `gap(RightGap.COLUMNS)` with `.layout(RowLayout.PARENT_GRID)`.
- **Left indent**: `indent {}` for indented sub-content.
- **Vertical gaps**: `.topGap(TopGap.MEDIUM)` / `.bottomGap(BottomGap.MEDIUM)` on rows to separate unrelated groups. Attach gaps to the "related" row so hiding rows doesn't break layout.

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

#### Enabled / Visible (Reactive State)

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

#### Binding (Property Binding)

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

// Later:
panel.isModified()  // true if UI differs from model
panel.apply()       // write UI values to model
panel.reset()       // revert UI to model values
```

#### Validation

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

#### Tips and Common Patterns

| Pattern | Usage |
|---|---|
| `.bold()` | Bold text on any cell |
| `.columns(COLUMNS_MEDIUM)` | Set preferred width of textField / comboBox / textArea |
| `.text("initial")` | Set initial text on text components |
| `.resizableColumn()` | Column fills remaining horizontal space |
| `cell()` | Empty placeholder cell for grid alignment |
| `.widthGroup("name")` | Equalize widths across rows (cannot combine with `AlignX.FILL`) |
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

### Tool Windows

- Register declaratively in module XML via `com.intellij.toolWindow` extension point (already done in `kilo.jetbrains.frontend.xml`).
- Implement `ToolWindowFactory.createToolWindowContent()` — called lazily on first click (zero overhead if unused).
- Use `SimpleToolWindowPanel(vertical = true)` as a convenient base — supports toolbar + content layout.
- Add tabs via `ToolWindow.contentManager`: create content with `ContentFactory.getInstance().createContent(component, title, isLockable)`, then `contentManager.addContent()`.
- For conditional display, implement `ToolWindowFactory.isApplicableAsync(project)`.
- Always use `ToolWindowManager.invokeLater()` instead of `Application.invokeLater()` for tool-window-related EDT tasks.

### Dialogs

- Extend `DialogWrapper`. Call `init()` from the constructor. Override `createCenterPanel()` to return UI content — prefer Kotlin UI DSL v2 for the panel contents.
- Override `getPreferredFocusedComponent()` for initial focus, `getDimensionServiceKey()` for size persistence.
- Show with `showAndGet()` (modal, returns boolean) or `show()` (then use `getExitCode()`).
- Input validation: call `initValidation()` in constructor, override `doValidate()` → return `null` if valid or `ValidationInfo(message, component)` if not.

### Platform Components — Always Use Instead of Raw Swing

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
| `Color` | `JBColor` | `com.intellij.ui` |
| `EmptyBorder` | `JBUI.Borders.empty()` | `com.intellij.util.ui` |
| Hardcoded pixel sizes | `JBUI.scale(px)` | `com.intellij.util.ui` |

Inspection `Plugin DevKit | Code | Undesirable class usage` highlights when you use raw Swing where a platform replacement exists.

### Multi-line and Rich Text

| Need | Component |
|---|---|
| Rich HTML with modern CSS, icons, shortcuts | `JBHtmlPane` (`com.intellij.ui.components.JBHtmlPane`) |
| Simple multi-line label with HTML | `JBLabel` + `XmlStringUtil.wrapInHtml()` |
| Scrollable / wrapping HTML panel | `SwingHelper.createHtmlViewer()` |
| High-perf colored text fragments (trees/lists/tables) | `SimpleColoredComponent` |
| Plain-text newline splitting | `MultiLineLabel` — legacy, do not use in new code |

- Build HTML programmatically with `HtmlChunk`/`HtmlBuilder` (`com.intellij.openapi.util.text.HtmlChunk`). Avoid raw HTML string concatenation — it risks injection and breaks localization.
- For simple wrapping/escaping: `XmlStringUtil.wrapInHtml(content)`, `XmlStringUtil.wrapInHtmlLines(lines...)`, `XmlStringUtil.escapeString(text)`.
- Selectable/copyable label text: `JBLabel.setCopyable(true)` (switches internally to `JEditorPane` while preserving label appearance). Use `setAllowAutoWrapping(true)` for auto-wrap.
- When creating a `JEditorPane` manually, always use `HTMLEditorKitBuilder` instead of constructing `HTMLEditorKit` directly: `editorPane.setEditorKit(HTMLEditorKitBuilder.simple())` or `.withWordWrapViewFactory().build()`.
- Single-line overflow/ellipsis: use `SwingTextTrimmer` — do not manually truncate strings.
- All user-visible strings go in `*.properties` files; HTML markup in values is acceptable.

### Colors and Theming

- **Never** use `java.awt.Color` directly. Use `JBColor(lightColor, darkColor)` or `JBColor.namedColor("key", fallback)` for theme-aware colors.
- For lazy color retrieval (e.g. in painting), use `JBColor.lazy { UIManager.getColor("key") }`.
- Check current theme: `JBColor.isBright()` returns `true` for light themes.
- Generic UI colors: `UIUtil.getContextHelpForeground()`, `UIUtil.getLabelForeground()`, `UIUtil.getPanelBackground()`, etc.

### Borders, Insets, and Spacing

- Always create via `JBUI.Borders.empty(top, left, bottom, right)` and `JBUI.insets()` — DPI-aware and auto-update on zoom.
- Use `JBUI.scale(int)` for any pixel dimension to ensure proper HiDPI scaling.

### Icons

- **Reuse platform icons**: browse at https://intellij-icons.jetbrains.design. Access via `AllIcons.*` constants.
- Custom icons: SVG files in `resources/icons/`. Load via `IconLoader.getIcon("/icons/foo.svg", MyClass::class.java)`.
- Organize in an `icons` package or a `*Icons` object with `@JvmField` on each constant.
- **Sizing**: actions/nodes = 16×16, tool window = 13×13 (classic) or 20×20 + 16×16 compact (New UI), editor gutter = 12×12 (classic) / 14×14 (New UI).
- **Dark variants**: `icon.svg` + `icon_dark.svg`. HiDPI: `icon@2x.svg` + `icon@2x_dark.svg`.
- **New UI support**: place New UI icons in `expui/` directory, create `*IconMappings.json`, register via `com.intellij.iconMapper` extension point. New UI icon colors: light `#6C707E`, dark `#CED0D6`.

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
