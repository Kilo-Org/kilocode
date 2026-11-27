# Kilo JetBrains v2 preview

This is a native IntelliJ Platform plugin on the `v2` line. Read the repository's `migration-tracking/principles.md` before changing it. Use the v1 target in `migration-tracking/progress/features.json` as a behavioral reference, not as a source of HTTP clients or release scripts.

## Module boundaries

- `frontend/src/main/kotlin/ai/kilocode/client/`: Swing, editor integration, settings and actions. Use IntelliJ UI components and theme tokens. Put user-facing strings in the module's `messages/KiloBundle` resources. Keep UI access on the EDT; collect flows and perform RPC off the EDT, in the owning service or view's scope.
- `shared/src/main/kotlin/ai/kilocode/`: split RPC interfaces, serializable DTOs, plugin identity and logging. Treat this boundary as crossing JVMs: send data, never native IDE objects, server passwords, or loopback URLs. Do not invoke a shared DTO's kotlinx serializer with a different module's JSON runtime.
- `backend/src/main/kotlin/ai/kilocode/backend/`: canonical project paths, filesystem, git, CLI process and network. Use `KiloBackendCliManager.client()` for generated v2 HTTP operations, native events and `kilocode.*` plugin RPCs. Do not add v1-shaped HTTP handlers or an embedded webview. Platform coroutines are supplied by the IDE; other runtime libraries are declared by the consuming Gradle module and pinned in `gradle/libs.versions.toml`.
- `script/generate.ts` derives Kotlin operations from this checkout's v2 protocol. `:backend:generateV2Transport` runs before Kotlin compilation. Change the generator or source contract rather than editing output under `build/`.

The root plugin descriptor is `src/main/resources/META-INF/plugin.xml`. Each content module's descriptor is directly under its own `src/main/resources/`, named `kilo.jetbrains.v2.{shared,frontend,backend}.xml`. Keep the Gradle project name, packaged module JAR names, module names and dependencies in sync. Use module XML for extensions, actions, listeners, and explicitly registered services; IntelliJ light services use `@Service` instead.

## Identity and development

The preview is `ai.kilocode.jetbrains.v2`; it cannot run in the same IDE as `ai.kilocode.jetbrains`. Keep the incompatible-plugin declaration. New native preferences, logs, cached binaries and worktree state must not share writable storage with v1. See [RELEASING.md](RELEASING.md) for installation, pinning, canary and rollback.

Run `bun install` from the repository root. From **this package**:

| Task | Command |
|---|---|
| TypeScript and Kotlin compilation | `bun run typecheck` |
| Module tests | `./gradlew test` |
| Focused test | `./gradlew :shared:test --tests 'ai.kilocode.log.KiloLogTest'` |
| Installable ZIP | `bun run build` |
| Split IDE development sandbox | `./gradlew --no-configuration-cache runIdeSplitMode` |

Use temporary IDE profiles, homes and workspaces for both preview and v1 testing. The Gradle development launcher points the backend at `script/dev-isolated.ts`; test the release downloader separately using an installed ZIP without that development override. For a fixture-backed local/split UI run, see [script/self-test/README.md](script/self-test/README.md).
