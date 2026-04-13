# AGENTS.md — Kilo JetBrains Plugin

## Architecture (Split Mode)

- **Split-mode plugin** with three Gradle modules: `shared/`, `frontend/`, `backend/`. The module descriptors are `kilo.jetbrains.shared.xml`, `kilo.jetbrains.frontend.xml`, `kilo.jetbrains.backend.xml` — these must stay in sync with `plugin.xml`'s `<content>` block.
- Reference template for the split-mode structure: https://github.com/nicewith/intellij-platform-modular-plugin-template
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

| Need                                                        | API                                                                                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Dialogs and settings pages with input fields bound to state | [Kotlin UI DSL v2](https://plugins.jetbrains.com/docs/intellij/kotlin-ui-dsl-version-2.html) (`com.intellij.ui.dsl.builder`) |
| Tool window panels, action-driven UI, custom components     | Standard Swing with IntelliJ Platform component replacements (see below)                                                     |
| Menus and toolbars                                          | [Action System](https://plugins.jetbrains.com/docs/intellij/action-system.html)                                              |

### Kotlin UI DSL v2

Use `panel { }` as the top-level builder — returns a `DialogPanel`. Structure: `panel` → `row` → cells (factory methods like `textField()`, `checkBox()`, `label()`). The DSL is for forms with bindings (`bindText`, `bindSelected`, etc.) and is **not** intended for general tool window UI.

```kotlin
// Settings/dialog example
panel {
    row("Label:") { textField().bindText(model::value) }
    group("Section") {
        row { checkBox("Enable feature").bindSelected(model::enabled) }
    }
}
```

Key patterns: `group {}` for titled sections, `indent {}` for left indent, `collapsibleGroup {}` for expandable sections, `buttonsGroup {}` for radio groups, `enabledIf()`/`visibleIf()` for reactive visibility, `.align(AlignX.FILL)` to stretch components.

To explore DSL capabilities interactively: **Tools → Internal Actions → UI → Kotlin UI DSL → UI DSL Showcase** (requires internal mode).

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

| Instead of            | Use                    | Package                         |
| --------------------- | ---------------------- | ------------------------------- |
| `JLabel`              | `JBLabel`              | `com.intellij.ui.components`    |
| `JTextField`          | `JBTextField`          | `com.intellij.ui.components`    |
| `JTextArea`           | `JBTextArea`           | `com.intellij.ui.components`    |
| `JList`               | `JBList`               | `com.intellij.ui.components`    |
| `JScrollPane`         | `JBScrollPane`         | `com.intellij.ui.components`    |
| `JTable`              | `JBTable`              | `com.intellij.ui.table`         |
| `JTree`               | `Tree`                 | `com.intellij.ui.treeStructure` |
| `JSplitPane`          | `JBSplitter`           | `com.intellij.ui`               |
| `JTabbedPane`         | `JBTabs`               | `com.intellij.ui.tabs`          |
| `JCheckBox`           | `JBCheckBox`           | `com.intellij.ui.components`    |
| `Color`               | `JBColor`              | `com.intellij.ui`               |
| `EmptyBorder`         | `JBUI.Borders.empty()` | `com.intellij.util.ui`          |
| Hardcoded pixel sizes | `JBUI.scale(px)`       | `com.intellij.util.ui`          |

Inspection `Plugin DevKit | Code | Undesirable class usage` highlights when you use raw Swing where a platform replacement exists.

### Multi-line and Rich Text

| Need                                                  | Component                                              |
| ----------------------------------------------------- | ------------------------------------------------------ |
| Rich HTML with modern CSS, icons, shortcuts           | `JBHtmlPane` (`com.intellij.ui.components.JBHtmlPane`) |
| Simple multi-line label with HTML                     | `JBLabel` + `XmlStringUtil.wrapInHtml()`               |
| Scrollable / wrapping HTML panel                      | `SwingHelper.createHtmlViewer()`                       |
| High-perf colored text fragments (trees/lists/tables) | `SimpleColoredComponent`                               |
| Plain-text newline splitting                          | `MultiLineLabel` — legacy, do not use in new code      |

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
