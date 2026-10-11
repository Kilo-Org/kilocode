---
name: jetbrains-arch
description: Use when adding or moving code across shared/frontend/backend modules in packages/kilo-jetbrains/ — split-mode RPC contracts, serialization classloader pitfall, threading/EDT annotations, services and coroutine scopes, EDT test rules, dependency bundling, and the CLI server protocol.
---

# JetBrains Split-Mode Architecture, Threading, and Dependencies

Detailed reference for `packages/kilo-jetbrains/` module boundaries, RPC, threading, and dependency rules. See `packages/kilo-jetbrains/AGENTS.md` for the hard restrictions summary; this skill covers the how and why.

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

### Never Ask a Shared DTO For Its Serializer From `frontend` or `backend`

`shared/` declares no kotlinx-serialization dependency, so its `@Serializable` DTOs bind to the platform's copy. `frontend/` and `backend/` each bundle their own `kotlinx-serialization-json`. Touching a shared DTO's generated serializer from either module therefore resolves `KSerializer` from two different classloaders and fails at runtime with:

```
java.lang.LinkageError: loader constraint violation: when resolving method
'kotlinx.serialization.KSerializer ai.kilocode.rpc.dto.SomeDto$Companion.serializer()'
```

In `frontend/` and `backend/`, do not call `Json.decodeFromString<SharedDto>(...)`, `Json.encodeToString(dto)`, `decodeFromJsonElement<SharedDto>(...)`, or `SharedDto.serializer()`. Module-local `@Serializable` types (for example `WorktreeNamesFile`) and built-ins like `List<String>` are fine, because the class and the serialization runtime come from the same loader — this is the reason two different patterns are used in `KiloBackendMarketplaceManager`:

- When the wire shape is a 1:1 match for the shared DTO (`MarketplaceResultDto`), decode into a private module-local wire type (e.g. `WireResult`) with `Json.decodeFromString<WireResult>(...)`, then map its fields onto the shared DTO by hand. Prefer this over raw `JsonObject` field extraction — it is real deserialization instead of hand-parsing, and any wire/DTO field mismatch fails at decode time instead of silently reading `null`.
- When the wire shape doesn't match the DTO at all — a discriminated union, fields nested differently, or DTO fields that are computed rather than present on the wire (`MarketplaceItemDto`'s `installedProject`/`methods`/`relevant`) — there is no serializer to safely call regardless of classloaders, so parse into a `JsonObject` and construct the DTO by hand; see `toDecoded()` in `KiloBackendMarketplaceManager` and `KiloCliDataParser`.

**Tests cannot catch this.** Gradle test runs put `shared`, the module under test, and kotlinx-serialization on one flat classpath, so the split only exists in a real IDE. Verify RPC paths that return shared DTOs in a sandbox run (`runIdeSplitMode`), not only under `./gradlew test`.

## Server Protocol

- The plugin spawns `kilo serve --port 0` (OS assigns random port) and reads stdout for `listening on http://...:(\d+)` to discover the port.
- A random 32-byte hex password is passed via `KILO_SERVER_PASSWORD` env var for Basic Auth.
- Fixed env vars set on every spawn: `KILO_CLIENT=jetbrains`, `KILO_PLATFORM=jetbrains`, `KILO_APP_NAME=kilo-code`, `KILO_ENABLE_QUESTION_TOOL=true`, `KILO_DISABLE_CLAUDE_CODE=true`, `KILOCODE_FEATURE=jetbrains-plugin`.
- Unless already provided by the base environment, the backend sets `KILO_CONFIG_CONTENT` to make `edit` and `bash` permissions ask by default for JetBrains-launched CLI processes.
- This is the same protocol used by the VS Code extension (`packages/kilo-vscode/src/services/cli-backend/server-manager.ts`).
