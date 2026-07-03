# AGENTS.md — Kilo JetBrains Plugin

## Package Overview

- **Split-mode plugin** with three Gradle modules: `shared/`, `frontend/`, `backend/`. The module descriptors are `kilo.jetbrains.shared.xml`, `kilo.jetbrains.frontend.xml`, `kilo.jetbrains.backend.xml` — these must stay in sync with `plugin.xml`'s `<content>` block.
- Reference template for the split-mode structure: https://github.com/JetBrains/intellij-platform-modular-plugin-template
- Official docs: https://plugins.jetbrains.com/docs/intellij/split-mode-for-remote-development.html
- Kotlin source goes under `{module}/src/main/kotlin/ai/kilocode/jetbrains/`. Package name is `ai.kilocode.jetbrains` (matches `group` in root `build.gradle.kts`).
- The root `plugin.xml` is wiring only: keep plugin metadata and the `<content>` block there. Register services, extensions, listeners, and actions in the module XML descriptors, not in root `plugin.xml`.
- Module descriptor files must live directly in `{module}/src/main/resources/`, not in `META-INF/`.
- Module XMLs use `<dependencies>`, not `<depends>`. The allowed top-level registration tags are limited; keep module XMLs focused on `<resource-bundle>`, `<extensions>`, `<extensionPoints>`, `<actions>`, `<applicationListeners>`, and `<projectListeners>`.

### Files That Must Change Together

- `plugin.xml` `<content>` entries ↔ module XML descriptors (`kilo.jetbrains.{shared,frontend,backend}.xml`)
- Service classes ↔ `<applicationService>`/`<projectService>` entries in the corresponding module XML
- `script/build.ts` platform list ↔ `backend/build.gradle.kts` `requiredPlatforms` list

## IntelliJ Platform Source Lookup

When looking for IntelliJ Platform API usage, implementation examples, extension points, services, actions, inspections, PSI/VFS/editor behavior, or plugin patterns, prefer real IntelliJ source code over Gradle caches, downloaded jars, generated parser artifacts, or decompiled classes.

Do not use IntelliJ Platform APIs marked as internal in the IntelliJ source repository. Find a public API alternative or keep the integration behind supported extension points. Experimental APIs are acceptable when needed, but warn the user that the integration relies on an experimental IntelliJ API.

Use this priority order:

1. Check whether `$INTELLIJ_REPO` is set and points to a readable IntelliJ Community checkout.
   - If set, search source files under that directory first.
   - Prefer implementation source files from `platform/`, `plugins/`, `java/`, `xml/`, `json/`, `jvm/`, and related modules.
   - Do not assume the IntelliJ checkout is a sibling of the current repo or worktree.
2. If `$INTELLIJ_REPO` is unset, empty, unreadable, or does not appear to contain an IntelliJ source checkout, tell the user to set it up.
   - Suggested instruction: `Set INTELLIJ_REPO to the path of a local intellij-community checkout, for example: export INTELLIJ_REPO=/path/to/intellij-community`
   - Do not invent or hardcode a machine-specific absolute path.
3. If a local checkout is unavailable, fall back to the public IntelliJ Community repository: https://github.com/JetBrains/intellij-community
4. Only inspect Gradle caches, downloaded jars, generated parser jars, decompiled classes, or dependency internals as a last resort when neither a local IntelliJ source checkout nor the public GitHub repository provides the needed information.

Avoid starting searches in `~/.gradle/caches`, `.gradle/`, downloaded dependency jars, generated parser artifacts, or decompiled library sources.

## Split-Mode Architecture and Feature Development

The JetBrains reference template mirrors our overall structure well: root project assembles the final plugin, `shared` holds contracts, `frontend` holds UI, and `backend` holds project-local logic. Copy its split-mode wiring and RPC layout, but **do not** copy its Compose UI approach.

In monolithic IDE mode (non-remote), all three modules load in one process — split plugins work fine without remote dev.

### Module Placement

- **Backend modules** host project model, indexing, analysis, execution, and CLI process management.
- **Frontend modules** host UI, typing assistance, and latency-sensitive features.
- **Shared modules** define RPC interfaces and data types used by both sides.
- Module dependencies determine where code loads. In monolith mode both frontend and backend dependencies are satisfied, so both modules load together.
- Non-light services that need XML registration go in `kilo.jetbrains.backend.xml` under `<extensions defaultExtensionNs="com.intellij"><applicationService>` (or `<projectService>`).

### RPC Contracts and Payloads

- Frontend ↔ backend communication uses RPC interfaces defined in `shared/`. Data sent over RPC must use `kotlinx.serialization`. In monolithic mode RPC is just an in-process suspend call.
- Define RPC APIs in `shared` with `@Rpc`, `RemoteApi<Unit>`, and `suspend` methods only.
- Shared cross-process payloads must be `@Serializable`. Keep `shared` lightweight and avoid pulling frontend-only or backend-only APIs into it.
- Implement RPC providers in `backend` and register them via `com.intellij.platform.rpc.backend.remoteApiProvider` when RPC is introduced.
- If a new split feature requires RPC support similar to the JetBrains template, mirror the template's wiring: `shared` and `frontend` use the RPC/serialization plugins, and the backend adds the required backend RPC platform modules.

### Frontend ↔ Backend Rules

- Call RPC from `frontend` coroutines only. Never call RPC on the EDT; do not paper over this with blocking wrappers.
- Wrap long-lived RPC calls and flows in `durable {}` so they survive reconnects and backend restarts.
- For backend → frontend push events, prefer Remote Topics over ad-hoc polling.

### Remote Development UX Rules

- Render empty state immediately and progressively fill data from the backend. Do not block first paint on backend state.
- Avoid chatty RPC. Debounce UI events, batch requests, cache results where appropriate, and page large datasets instead of sending everything at once.

### Required Inspections

- Run inspection `Plugin DevKit | Code | Frontend and Backend API Usage` when adding or moving split-mode code.

## Threading, Services, and Coroutines

### Threading and Coroutine Context Annotations

IntelliJ Platform provides method-level annotations to declare threading and coroutine context requirements. All annotations live in `com.intellij.util.concurrency.annotations`. Source in `$INTELLIJ_REPO`: `platform/core-api/src/com/intellij/util/concurrency/annotations/`.

| Annotation | Requirement |
|---|---|
| `@RequiresEdt` | Must run on EDT. Injects a runtime assertion by default. |
| `@RequiresBackgroundThread` | Must run off EDT. Injects a runtime assertion by default. |
| `@RequiresReadLock` | Must hold read or write lock. |
| `@RequiresWriteLock` | Must hold write lock. |
| `@RequiresReadLockAbsence` | Must not hold any read or write lock. |
| `@RequiresBlockingContext` | Must not be called from a `suspend` context. Source-retained only, no runtime assertion. |

All five `Requires*` thread/lock annotations accept `generateAssertion = false` to document intent without injecting a runtime check.

For custom dispatchers/context return types that are IO-safe or non-blocking, use `@BlockingExecutor` / `@NonBlockingExecutor` from `org.jetbrains.annotations`.

For blocking I/O in coroutines, move the dispatcher switch inside the callee using `withContext(Dispatchers.IO)`. There is no annotation that requires `Dispatchers.IO`; the `BlockingMethodInNonBlockingContextInspection` static analysis covers this.

**Decision guide:**

| Situation | Solution |
|---|---|
| Method must run on EDT | `@RequiresEdt` |
| Method must run off EDT | `@RequiresBackgroundThread` |
| Method requires read or write access | `@RequiresReadLock` |
| Method requires write access | `@RequiresWriteLock` |
| Method must not hold any lock | `@RequiresReadLockAbsence` |
| Blocking function, suspend alternative exists | `@RequiresBlockingContext` |
| Blocking I/O work in a coroutine | `withContext(Dispatchers.IO)` inside the callee |
| Custom IO-safe dispatcher | `@BlockingExecutor` on the return type or class |
| Custom non-blocking dispatcher | `@NonBlockingExecutor` on the return type or class |

### EDT Requirements for UI Updates

- **All Swing UI creation, mutation, and access must happen on the EDT.** This is not negotiable. The IntelliJ platform enforces it at runtime via `@RequiresEdt` and `ThreadingAssertions`.
- Annotate every method that touches Swing components or `SessionModel` with `@RequiresEdt`.
- Never create Swing components, update labels/colors/borders, or call `revalidate()`/`repaint()` from a background thread or coroutine. Use `ApplicationManager.getApplication().invokeLater { }` or `withContext(Dispatchers.Main)` to switch to the EDT.
- For tool-window-related EDT tasks, use `ToolWindowManager.invokeLater()` instead of `Application.invokeLater()`.

### Services

- Official docs: https://plugins.jetbrains.com/docs/intellij/plugin-services.html and https://plugins.jetbrains.com/docs/intellij/launching-coroutines.html
- **Prefer light services**: annotate with `@Service` (or `@Service(Service.Level.PROJECT)`) instead of registering in XML when the service won't be overridden or exposed as API. Light services must be `final` in Java (no `open` in Kotlin), cannot use constructor injection of other services, and don't support `os`/`client`/`overrides` attributes.
- **Avoid heavy constructor work** — defer initialization to methods. Never cache service instances in fields; always retrieve via `service<T>()` at the call site.

### Coroutine Scopes

- **Constructor-injected `CoroutineScope`**: the recommended way to launch coroutines. Each service gets its own scope (child of an intersection scope). The scope is cancelled on app/project shutdown or plugin unload. Supported signatures: `MyService(CoroutineScope)` for app services, `MyService(Project, CoroutineScope)` for project services.
- The injected scope's context contains `Dispatchers.Default` and `CoroutineName(serviceClass)`. Switch to `Dispatchers.IO` for blocking I/O.
- `runBlockingCancellable` exists but is **not recommended** — use service scopes instead. For actions, use `currentThreadCoroutineScope()` which lets the Action System cancel the coroutine.

### General EDT/UI Tests

- Any code path that modifies UI state or depends on EDT threading must have tests that exercise the actual implementation.
- Extend `BasePlatformTestCase` to get a real IntelliJ Application and EDT in tests. The session package already uses `SessionControllerTestBase` which wraps this.
- Do not mock the EDT or threading assertions — test against the real threading model.
- Do not add production methods whose only purpose is test access. Prefer exercising the public API and inspecting the real Swing component tree in tests.
- Do not expose `internal` accessors, helper methods, or synthetic seams just so tests can inspect private implementation details. If a test needs this, either assert observable UI/action behavior or refactor the production API so the new seam has real product value.
- For state-driven updates, assert that the component state matches after flushing coroutines and draining the EDT.
- For retained Swing components, assert that expand/collapse, update, and no-op paths work correctly without rebuilding the component tree.

### Integration Test Timeouts

- Prefer deterministic synchronization over timeouts: wait for explicit state transitions, event emissions, fake server hooks, latches, or coroutine completions that prove the system reached the expected condition.
- Use timeouts only when an integration test cannot otherwise protect the suite from a stuck process, external boundary, or coroutine. Treat them as watchdogs, not as the mechanism that makes the test pass.
- When a timeout is necessary, define one named timeout or wait helper near the top of the test file and reuse it. Do not scatter literal timeout values through individual assertions.
- Timeout failures should include the last observed state and useful logs or errors so CI explains what blocked progress.
- Do not use `delay`, sleeps, or repeated polling to guess when asynchronous work is done unless the behavior under test is timing-specific.

## Dependencies

- **Always bundle third-party libraries with the plugin.** Do not rely on libraries bundled with the IntelliJ platform (e.g. OkHttp, Gson, Guava, kotlinx-serialization-json). The IDE's bundled versions change across releases without notice and can cause version collisions, classloader conflicts, or silent API breakage. Declare all third-party dependencies as `implementation` in the relevant `build.gradle.kts` so they ship inside the plugin JAR and load from the plugin's own classloader.
- `kotlinx.coroutines` is the one mandatory exception — it is provided by the platform and must not be bundled (the IntelliJ Platform Gradle plugin enforces this automatically).
- Pin exact versions in `gradle/libs.versions.toml` and reference them via the version catalog (`libs.*`) in `build.gradle.kts`. Never hardcode version strings in `build.gradle.kts`.

## CLI Integration

- CLI process spawning, extraction, and lifecycle belong in `backend`.
- For OS and environment checks, prefer IntelliJ Platform classes over raw JVM APIs such as `System.getProperty(...)` or `System.getenv(...)`.
- Detect architecture with `com.intellij.util.system.CpuArch.CURRENT`, not `System.getProperty("os.arch")`.
- Detect OS with `com.intellij.openapi.util.SystemInfo.isMac` / `isLinux` / `isWindows`.
- Read environment variables with `com.intellij.util.EnvironmentUtil.getValue(...)` or `getEnvironmentMap()` when platform-aware environment handling matters.
- Resolve IDE paths with `com.intellij.openapi.application.PathManager` rather than inferring paths from process working directories.
- For packaging/build plumbing, see `script/build.ts` and `backend/build.gradle.kts`.

### Server Protocol

- The plugin spawns `kilo serve --port 0` (OS assigns random port) and reads stdout for `listening on http://...:(\d+)` to discover the port.
- A random 32-byte hex password is passed via `KILO_SERVER_PASSWORD` env var for Basic Auth.
- Fixed env vars set on every spawn: `KILO_CLIENT=jetbrains`, `KILO_PLATFORM=jetbrains`, `KILO_APP_NAME=kilo-code`, `KILO_ENABLE_QUESTION_TOOL=true`, `KILO_DISABLE_CLAUDE_CODE=true`, `KILOCODE_FEATURE=jetbrains-plugin`.
- Unless already provided by the base environment, the backend sets `KILO_CONFIG_CONTENT` to make `edit` and `bash` permissions ask by default for JetBrains-launched CLI processes.
- This is the same protocol used by the VS Code extension (`packages/kilo-vscode/src/services/cli-backend/server-manager.ts`).

### Dev Storage Isolation

- In development (`runIdeSplitMode`, `runIdeBackend`, `runIdeFrontend`, or `runIde`), the Gradle property `kilo.dev.storage.isolated=true` makes the backend set `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, and `XDG_CACHE_HOME` to `<worktree>/.kilo-dev/{data,config,state,cache}` before spawning the CLI. The worktree root comes from the `kilo.dev.worktree.root` JVM system property (auto-set by Gradle from the project directory).
- The checked-in `Run IDE (Backend)`, `Run IDE (Frontend)`, and `Run IDE (Split Mode)` run configurations enable isolation by default (`-Pkilo.dev.storage.isolated=true`). Developers can disable it by passing `-Pkilo.dev.storage.isolated=false`.
- Use standard `XDG_*_HOME` env vars for this isolation. Do not introduce custom `KILO_DATA_DIR`, `KILO_GLOBAL_CONFIG_DIR`, `KILO_STATE_DIR`, or `KILO_CACHE_DIR` env vars — the CLI core already respects `XDG_*_HOME` via `xdg-basedir`.
- The `.kilo-dev/` directory is gitignored and created automatically on first run.
- The implementation lives in `KiloBackendCliManager.buildEnv()` / `devStorageEnv()`. Tests: `KiloBackendCliManagerEnvTest`.

### Debugging Session Event Logs

- Use `script/dev/part-update.sh client <session-id>` from `packages/kilo-jetbrains/` to print frontend `message.part.delta` text by part id.
- Use `script/dev/part-update.sh backend <session-id>` from `packages/kilo-jetbrains/` for backend sandbox events.
- Append with `>> file.txt` when you need to keep the output.
- For full chat payload previews in JetBrains dev runs, pass `-Pkilo.dev.log.chat.content=<mode>` where `<mode>` is `off` (default, no content), `preview` (cleaned/truncated content), or `full` (cleaned full content).
- `-Pkilo.dev.log.chat.preview.max=<n>` controls preview length, clamped from 1 to 2000.

## Build and Verification

- **Marketplace version build**: Use `script/build-version.sh <version>` from `packages/kilo-jetbrains/` to clean, prepare production CLI binaries, build, sign, and verify the JetBrains Marketplace plugin ZIP. Pass `--skip-verification` only when explicitly needed.
- **Test version build**: If the user asks for a JetBrains test build, still require a version and use `script/build-version.sh <version> --skip-signing --skip-verification` from `packages/kilo-jetbrains/` so no signing secrets are needed. Add `--skip-clean` only when the user wants a faster incremental test build.
- **Typecheck**: `bun run typecheck` or `./gradlew typecheck` from `packages/kilo-jetbrains/` — compiles all Kotlin sources including the generated API client. Does NOT require CLI binaries.
- **Full build**: `bun run build` from `packages/kilo-jetbrains/` (prepares CLI binaries + runs Gradle `buildPlugin`).
- **Gradle only**: `./gradlew buildPlugin` from `packages/kilo-jetbrains/` (requires CLI binaries already present in `backend/build/generated/cli/`; run `bun run build --prepare-cli` first).
- **Java checks**: Do not run `java -version` as a routine preflight. Gradle commands already fail clearly when Java is missing or incompatible; check Java only when diagnosing that failure mode.
- **Via Turbo**: `bun turbo build --filter=@kilocode/kilo-jetbrains` from repo root.
- **Run split mode**: `./gradlew --no-configuration-cache runIdeSplitMode` or the checked-in `Run IDE (Split Mode)` configuration — launches backend and frontend locally and prepares the local-platform CLI binary automatically. Emulate latency via the Split Mode widget (requires internal mode: `-Didea.is.internal=true`).
- **Run split backend**: `./gradlew --no-configuration-cache runIdeBackend` — prepares the local-platform CLI binary automatically; if it exits shortly after startup, check for an orphaned Java process from a previous backend run and kill it before restarting.
- **Run in monolithic sandbox**: `./gradlew runIde` — launches sandboxed IntelliJ with the plugin. Does NOT build CLI binaries.

### CLI/SDK Change Awareness

- JetBrains runtime behavior depends on the bundled CLI artifact under `backend/build/generated/cli/`; Gradle-only tasks and sandbox runs do not rebuild it.
- If there are relevant changes outside `packages/kilo-jetbrains/` in the CLI (`packages/opencode/`) or SDK/API generation paths (`packages/sdk/js/`, server endpoints, OpenAPI outputs), warn the user that the JetBrains run may be using stale generated CLI or SDK artifacts.
- Do not regenerate or rebuild those artifacts automatically just because such changes exist. Ask the user whether to refresh them first, typically with `bun run build --prepare-cli` from `packages/kilo-jetbrains/` for CLI artifacts and `./script/generate.ts` from the repo root for server/API SDK changes.

## UI Guidelines

### Technology Choices

**Do not use Kotlin UI DSL v2 (`com.intellij.ui.dsl.builder`) in this plugin.** Use standard Swing with IntelliJ Platform components for all UI layout. The JetBrains modular template and some older sections of the codebase reference the DSL, but Kilo should not introduce it.

**Do not use Kotlin Compose or `intellij.platform.compose` in this plugin.** The JetBrains modular template uses Compose for its demo tool window, but Kilo should use standard Swing with IntelliJ Platform components only. Keep all plugin UI in the existing Swing-based stack.

**Do not use JCEF (`JBCefBrowser`) in this plugin.** JCEF does not work in JetBrains remote development (split mode): the frontend process runs on the client machine but JCEF requires a display on the host, making it effectively unusable for remote users. Use standard Swing with IntelliJ Platform components for all UI.

| Need | API |
|---|---|
| Any layout, forms, panels | Standard Swing with IntelliJ Platform component replacements |
| Tool windows | `SimpleToolWindowPanel` + `ToolWindow.contentManager` |
| Menus and toolbars | [Action System](https://plugins.jetbrains.com/docs/intellij/action-system.html) |
| Dialogs | Extend `DialogWrapper` |

### Style Tokens

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

### Primary UI Rules

- Use IntelliJ platform components instead of raw Swing where an equivalent exists (see [Platform Components](#platform-components-and-utilities) table below).
- When implementing a new user-facing action, consider adding metrics so usage can be tracked.
- Do not set default Swing properties explicitly. Avoid `isOpaque = false` unless the component default differs or there is a documented rendering reason.
- Avoid hardcoded dimensions, colors, and font sizes — use the platform style APIs described in [Theme-Derived Colors](#theme-derived-colors), [Theme-Derived Fonts](#theme-derived-fonts), and [Borders, Insets, and Spacing](#borders-insets-and-spacing).
- Put user-visible strings in `*.properties` files.
- Do not add decorative helper functions, wrappers, or defensive UI code unless they materially improve clarity or correctness.

### Swing Component Lifecycle

Swing is retained-mode UI. For dynamic Swing surfaces such as session cards, transcript parts, hover rows, and collapsible panels, build a stable component tree once and then mutate existing components in response to model or interaction changes.

- Do not use a React-style `state -> render()` loop for Swing components.
- Avoid card-level `render()` methods that remove/recreate headers, text areas, markdown views, controls, or scroll panes after every click, hover, or model update.
- Give each renderer an `update(model)` method that applies model changes directly to existing UI components.
- In `update(model)`, compare before assigning when practical: label text, icons, foregrounds, fonts, body text, visibility, cursor, and containment.
- Do not duplicate state in booleans when Swing component state already answers the question.
- Derive expanded state from containment (e.g. `scroll.parent === root`) rather than maintaining an `open` boolean.
- Derive hover state from the current header background or other component property rather than maintaining a `hover` boolean.
- Expand/collapse should attach or detach the existing body component and update controls only if attachment changed.
- Hover should update only the affected component (usually the header background) and repaint only that component when the effective color changed.
- Lazy-create expensive bodies such as `JBTextArea`, `JBScrollPane`, markdown panes, and HTML panes on first expansion or first direct access.
- Parent containers should refresh for add/remove/reorder operations, not automatically after every delegated child update or streaming delta.
- Child views should call `revalidate()`/`repaint()` only when they changed preferred size, visibility, containment, or paint output.
- Empty deltas, identical text, unchanged styles, repeated hover values, and no-op toggles should not repaint the whole card.
- Private helpers named `render()` in Swing views invite full tree rebuilds. Prefer names like `syncBody()`, `syncArrow()`, `syncHtml()`, or `applyModel()`.

Tests for retained Swing components should assert:
- Collapsed components start unattached; expensive bodies are not created until first expansion.
- First expansion creates the body once; collapse detaches it; re-expansion reuses the same instance.
- `isExpanded()` agrees with actual containment.
- `update(model)` changes existing labels/body text without duplicating components.
- Updates while collapsed do not eagerly create lazy bodies.
- No-op updates, empty deltas, repeated hover values, and toggling non-expandable cards do not repaint/revalidate the whole view.
- Streaming/rebuilding surfaces additionally require stress + leak tests (see below).

### Stress and Leak Tests for Streaming UI

Session/transcript UI that streams updates or rebuilds its component tree (markdown
views, code blocks, transcript parts, collapsible cards) must ship stress + leak tests in
addition to behavior tests. These tests must:

- Drive many updates (hundreds of streamed deltas or `set` cycles) through the public API.
- Assert that retained component instances stay identical across updates (`assertSame`).
- Assert the component count stays bounded — no growth per update.
- Assert disposable-backed resources return to baseline after churn + clear/dispose.
  For code editors, compare `EditorFactory.getInstance().allEditors.size` against a
  baseline captured before the loop.

See `MdViewHybridStressTest` for the reference pattern.

### Platform Components and Utilities

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

### Multi-line and Rich Text

| Need | Component |
|---|---|
| Rich HTML with modern CSS, icons, shortcuts | `JBHtmlPane` (`com.intellij.ui.components.JBHtmlPane`) |
| Simple multi-line label with HTML | `JBLabel` + `XmlStringUtil.wrapInHtml()` |
| Scrollable / wrapping HTML panel | `SwingHelper.createHtmlViewer()` |
| High-performance colored text fragments in trees/lists/tables | `SimpleColoredComponent` |
| Plain-text newline splitting | `MultiLineLabel` — legacy, do not use in new code |

- Build HTML programmatically with `HtmlChunk`/`HtmlBuilder` (`com.intellij.openapi.util.text.HtmlChunk`). Avoid raw HTML string concatenation — it risks injection and breaks localization.
- For simple wrapping/escaping: `XmlStringUtil.wrapInHtml(content)`, `XmlStringUtil.wrapInHtmlLines(lines...)`, `XmlStringUtil.escapeString(text)`.
- Selectable/copyable label text: `JBLabel.setCopyable(true)`. Use `setAllowAutoWrapping(true)` for auto-wrap.
- When creating a `JEditorPane` manually, always use `HTMLEditorKitBuilder` instead of constructing `HTMLEditorKit` directly.
- Single-line overflow/ellipsis: use `SwingTextTrimmer`. Do not manually truncate strings.
- All user-visible strings go in `*.properties` files; HTML markup in values is acceptable.

### Theme-Derived Colors

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

### Theme-Derived Fonts

Do not hardcode font sizes or font families.

- Prefer component default fonts when no style change is needed.
- Use `JBFont.h1()` through `JBFont.h4()` for headings.
- Use `.asBold()`, `.asItalic()`, and `.asPlain()` for style changes on `JBFont` values.
- Use `JBFont.regular()`, `JBFont.medium()`, and `JBFont.small()` for regular and secondary text.
- Use `RelativeFont` when adjusting an existing component font relatively.
- For errors, grayed text, shortcuts, and links in renderers, prefer `SimpleTextAttributes.ERROR_ATTRIBUTES`, `GRAYED_ATTRIBUTES`, `SHORTCUT_ATTRIBUTES`, and `LINK_ATTRIBUTES`.

Avoid `Font("...")`, raw font sizes, and `deriveFont(14f)` style calls.

### Borders, Insets, and Spacing

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

### Stack — One-Dimensional Multi-Component Layout

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

### Align — Single-Component Alignment Wrapper

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

### IntelliJ UI Surfaces

#### Tool Windows

- Register declaratively in module XML via `com.intellij.toolWindow` extension point (already done in `kilo.jetbrains.frontend.xml`).
- Implement `ToolWindowFactory.createToolWindowContent()` — called lazily on first click.
- Use `SimpleToolWindowPanel(vertical = true)` as a convenient base — supports toolbar + content layout.
- Add tabs via `ToolWindow.contentManager`: create content with `ContentFactory.getInstance().createContent(component, title, isLockable)`, then `contentManager.addContent()`.
- For conditional display, implement `ToolWindowFactory.isApplicableAsync(project)`.
- Always use `ToolWindowManager.invokeLater()` instead of `Application.invokeLater()` for tool-window-related EDT tasks.

#### Dialogs

- Extend `DialogWrapper`. Call `init()` from the constructor. Override `createCenterPanel()` to return UI content.
- Override `getPreferredFocusedComponent()` for initial focus, `getDimensionServiceKey()` for size persistence.
- Show with `showAndGet()` (modal, returns boolean) or `show()` (then use `getExitCode()`).
- Input validation: call `initValidation()` in constructor, override `doValidate()` — return `null` if valid or `ValidationInfo(message, component)` if not.
- For hand-built Swing forms, use `ComponentValidator` with `withValidator`, `withFocusValidator`, and `andRegisterOnDocumentListener` instead of custom tooltip/error border logic.

#### Notifications

- Declare in module XML: `<notificationGroup id="Kilo Code" displayType="BALLOON"/>`.
- Show: `Notification("Kilo Code", "message", NotificationType.INFORMATION).notify(project)`.
- Add actions: `.addAction(NotificationAction.createSimpleExpiring("Label") { ... })`.
- Sticky (user must dismiss): `displayType="STICKY_BALLOON"` + `.setSuggestionType(true)`.
- Tool-window-bound: `displayType="TOOL_WINDOW" toolWindowId="Kilo Code"`.
- Prefer non-modal notifications over `Messages.show*()` dialogs.

#### Popups

- Use `JBPopupFactory.getInstance()` for lightweight floating UI (no chrome, auto-dismiss on focus loss).
- `createComponentPopupBuilder(component, focusable)` for arbitrary Swing content; `createPopupChooserBuilder(list)` for item selection; `createActionGroupPopup()` for action menus.
- Show with `showInBestPositionFor(editor)`, `showUnderneathOf(component)`, or `showInCenterOf(component)`.

#### Lists and Trees

- `JBList` not `JList` — adds empty text, busy indicator, tooltip truncation.
- `Tree` not `JTree` — adds wide selection painting, auto-scroll on DnD.
- Custom renderers: `ColoredListCellRenderer` / `ColoredTreeCellRenderer` — `append()` for styled text, `setIcon()` for icons.
- Speed search: `ListSpeedSearch(list)` / `TreeSpeedSearch(tree)`.
- Editable list with add/remove/reorder toolbar: `ToolbarDecorator.createDecorator(list).setAddAction { }.setRemoveAction { }.createPanel()`.
- Use `ListUtil.installAutoSelectOnMouseMove(list)` for popup-like hover-selection behavior.
- Use `ScrollingUtil.installActions(list)` for keyboard navigation.
- Use `CollectionListModel<T>` for simple item storage; `FilteringListModel<T>` for filtering with speed search.

### Icons and SVG Assets

Official references:
- [IntelliJ Platform UI Guidelines](https://jetbrains.design/intellij/)
- [User Interface Components](https://plugins.jetbrains.com/docs/intellij/user-interface-components.html)
- [UI FAQ (colors, borders, icons)](https://plugins.jetbrains.com/docs/intellij/ui-faq.html)

- For compact icon-only actions, use `ai.kilocode.client.ui.HoverIcon` so the control gets the standard 24×24 hover treatment. Do not create `JButton(icon)` or wrap a bare icon in a button just to make it clickable.
- **Reuse platform icons**: browse at https://intellij-icons.jetbrains.design. Access via `AllIcons.*` constants.
- Custom icons: SVG files in `resources/icons/`. Load via `IconLoader.getIcon("/icons/foo.svg", MyClass::class.java)`.
- Organize in an `icons` package or a `*Icons` object with `@JvmField` on each constant.
- **Sizing**: actions/nodes = 16×16, tool window = 13×13 (classic) or 20×20 + 16×16 compact (New UI), editor gutter = 12×12 (classic) / 14×14 (New UI).
- **Dark variants**: `icon.svg` + `icon_dark.svg`. HiDPI: `icon@2x.svg` + `icon@2x_dark.svg`.
- **New UI support**: place New UI icons in `expui/` directory, create `*IconMappings.json`, register via `com.intellij.iconMapper` extension point. New UI icon colors: light `#6C707E`, dark `#CED0D6`.

IntelliJ does not theme SVG icons with `currentColor`, CSS classes, CSS variables, `<style>` blocks, or inherited styles. `SVGLoader` patches icon colors by matching literal hex values in `fill` and `stroke` attributes against the active theme palette. Use hardcoded palette hex values in SVG assets and provide dark variants. This exception applies to icon asset files only; runtime Swing UI code must still derive colors from theme APIs.

| Do | Do not |
|---|---|
| `fill="#6E6E6E"` | `fill="currentColor"` |
| `stroke="#3574F0"` | CSS variables or classes |
| `icon.svg` plus `icon_dark.svg` | `<style>` blocks for theming |
| `fill-opacity="0.5"` | Inherited styling |

Themes can override palette colors through `icons.ColorPalette` in the theme JSON.

### Before Returning UI Code

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

## Session Component

The chat session feature uses a three-layer Model / Controller / View architecture. All files live under
`frontend/src/main/kotlin/ai/kilocode/client/session/`.

### Architecture

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

### Editor-Dependent Session Styling

Session UI components that render text using editor fonts or colors must not read global editor settings directly on every paint. Instead they must:

1. Implement `SessionEditorStyleTarget` (`session/ui/style/SessionEditorStyle.kt`).
2. Hold a snapshot field initialised with `SessionEditorStyle.current()`.
3. Override `applyStyle(style: SessionEditorStyle)` and update all fonts/colors in one place without rebuilding Swing nodes.

`SessionUi` propagates a refreshed `SessionEditorStyle` to every registered `SessionEditorStyleTarget` child when the global editor scheme changes. New session elements that depend on editor settings must be registered through this flow, not through ad hoc `EditorColorsManager` listeners.

**Anti-patterns to avoid:**
- Do not pass `SessionEditorStyle` fields through constructors or method parameters when the component can implement the interface and receive updates via `applyStyle`.
- Do not store individual style properties (e.g. a separate `font` field copied from the style) when holding the full `SessionEditorStyle` snapshot is cleaner.

### Session Testing

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
