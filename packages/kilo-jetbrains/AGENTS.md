# AGENTS.md — Kilo JetBrains Plugin

This file is always loaded for work in this package. Detailed guidance lives in the skills and command listed in [Skill and Command Index](#skill-and-command-index) — load the relevant one before starting UI, session, architecture, or release work.

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
- `packages/kilo-jetbrains/package.json` version ↔ GitHub CLI release tag consumed by the backend downloader
- `packages/kilo-jetbrains/gradle.properties` `kilo.cli.pinned` ↔ Gradle and release-script gates
- `.kilo/skills/release-jetbrains/script/check-pin.ts` / `set-pin.ts` ↔ `/release-jetbrains` command and CLI pin documentation

### PR Hygiene

- Do not include `.kilo/plans/**` files in JetBrains commits or PRs unless the user explicitly asks to publish plan files.

## Hard Restrictions

- **No Kotlin UI DSL v2** (`com.intellij.ui.dsl.builder`), **no Kotlin Compose** (`intellij.platform.compose`), **no JCEF** (`JBCefBrowser`). Standard Swing with IntelliJ Platform components only — JCEF and Compose don't work reliably in split-mode remote dev. Details: `jetbrains-ui` skill.
- Do not use IntelliJ Platform APIs marked internal in the IntelliJ source repository. Find a public alternative or a supported extension point. Experimental APIs are acceptable but warn the user. Lookup priority ($INTELLIJ_REPO first): `jetbrains-arch` skill.
- **Bundle all third-party libraries** as `implementation` in `build.gradle.kts` — never rely on IntelliJ-bundled copies (OkHttp, Gson, Guava, kotlinx-serialization-json). `kotlinx.coroutines` is the one exception (platform-provided, never bundle it). Pin versions in `gradle/libs.versions.toml`.
- **Never call a shared DTO's kotlinx serializer from `frontend` or `backend`** (`Json.decodeFromString<SharedDto>()`, `SharedDto.serializer()`, etc.) — `shared/` and each module load serialization from different classloaders, causing a `LinkageError` at runtime that Gradle tests cannot catch. Full pattern and workaround: `jetbrains-arch` skill.
- **All Swing creation, mutation, and access must happen on the EDT.** Never call RPC from the EDT. Annotate methods touching Swing or `SessionModel` with `@RequiresEdt`. Full annotation set and services/coroutine rules: `jetbrains-arch` skill.
- Do not hardcode colors, fonts, sizes, insets, or borders — use theme-derived platform APIs. Do not use raw Swing where a JB component exists (`JLabel` → `JBLabel`, etc.). User-visible strings go in `*.properties` files. Full tables: `jetbrains-ui` skill.
- Do not run `java -version` as a routine preflight — Gradle already fails clearly when Java is missing or incompatible.
- Do not move, delete, or recreate JetBrains release tags (`jetbrains/v*`) casually. Release process: `/release-jetbrains` command.

## Reuse First — Common Code Index

Check these before writing a new component, constant, or test harness. Do not duplicate constants across files or hand-roll what already exists here.

| Need | Use | Location |
|---|---|---|
| Reusable colors, spacing, gaps | `UiStyle` | `frontend/.../ui/UiStyle.kt` |
| Session-specific style tokens | `SessionUiStyle` | `frontend/.../session/ui/style/SessionUiStyle.kt` |
| One-dimensional layout (row/column) | `Stack` | `ai.kilocode.client.ui.layout.Stack` |
| Single-component alignment | `Align` | `ai.kilocode.client.ui.layout.Align` |
| Single-line transcript text | `PlainLabel` | `ai.kilocode.client.ui.PlainLabel` |
| Icon-only clickable control | `HoverIcon` | `ai.kilocode.client.ui.HoverIcon` |
| Expandable transcript cards | `AbstractSessionPartView` | `frontend/.../session/ui/` |
| Settings pages, rows, lists | `BaseSettingsUi`, `SettingsRow*`, `SettingsListPanel` | `frontend/.../settings/base/` |
| EDT + real Application test base | `SessionControllerTestBase` | `test/.../session/` |
| Fake session RPC in tests | `FakeSessionRpcApi` | `test/.../session/` |
| Fake CLI HTTP server in tests | `MockCliServer` | test infra |

## Component Model

Swing is retained-mode UI, not React. Build the component tree once; mutate existing components via an `update(model)` method instead of a `state -> render()` rebuild loop.

- Do not recreate headers, text areas, markdown views, or scroll panes on every model/hover change.
- Derive expanded/hover state from actual component state (containment, background) instead of shadow booleans.
- Lazy-create expensive bodies (`JBTextArea`, `JBScrollPane`, markdown panes) on first expansion.
- Repaint/revalidate only the component that actually changed.

Full lifecycle rules, anti-patterns, and required stress/leak tests for streaming UI: `jetbrains-session` skill.

## Key Commands

| Task | Command (from `packages/kilo-jetbrains/`) |
|---|---|
| Typecheck | `bun run typecheck` or `./gradlew typecheck` |
| Test | `./gradlew test` |
| Full build | `bun run build` (`./gradlew buildPlugin`) |
| Run split-mode sandbox | `./gradlew --no-configuration-cache runIdeSplitMode` |
| Marketplace build | `script/build-version.sh <version>` |

Full build/run/debug workflow, sandbox recovery, dev storage isolation, CLI pin modes: `jetbrains-dev` skill.

## Skill and Command Index

| Topic | Load |
|---|---|
| UI layout, components, style tokens, theme colors/fonts, settings pages | `jetbrains-ui` skill (`.kilo/skills/jetbrains-ui/SKILL.md`) |
| Chat session UI, SessionModel/Controller, session tests | `jetbrains-session` skill (`.kilo/skills/jetbrains-session/SKILL.md`) |
| Split-mode/RPC, module placement, threading, services, serialization, IntelliJ source lookup | `jetbrains-arch` skill (`.kilo/skills/jetbrains-arch/SKILL.md`) |
| Build, sandbox runs, debugging, dev storage, CLI pin basics | `jetbrains-dev` skill (`.kilo/skills/jetbrains-dev/SKILL.md`) |
| Icons / SVG assets | `icon-jetbrains` skill (`.kilo/skills/icon-jetbrains/SKILL.md`) — always load for icon work |
| CLI pin/unpin/regen (one-shot, cleans artifacts) | `jetbrains-cli-pin` skill (`.kilo/skills/jetbrains-cli-pin/SKILL.md`) |
| Plugin release (version, changelog, publish) | `/release-jetbrains` command (`.kilo/command/release-jetbrains.md`) |
