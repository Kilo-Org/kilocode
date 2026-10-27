---
name: jetbrains-dev
description: Use when building, running, or debugging the JetBrains plugin — Gradle build/typecheck tasks, sandbox runIde* modes and recovery, stopping sandbox runs, dev storage isolation, debug/chat logging, CLI pin modes and pin bumping.
---

# JetBrains Plugin Build, Run, and Debug

Detailed reference for building, running, and debugging `packages/kilo-jetbrains/`. See `packages/kilo-jetbrains/AGENTS.md` for the always-on restrictions and key command summary; this skill covers the full workflow.

## CLI Integration

- CLI process spawning, download, extraction, and lifecycle belong in `backend`.
- By default, the plugin does not bundle CLI binaries. At connect time the backend downloads the GitHub Release asset for the version pinned in `packages/kilo-jetbrains/package.json`; `backend` resources include `kilo.properties` with `cli.version` and `cli.pinned` for split-mode RPC and runtime use.
- Bundled release builds pass `-Pkilo.cli.bundled=true` while keeping `kilo.cli.pinned=true`. This build-only flag stages all pinned CLI release assets into `kilo-cli.zip`; runtime detects that resource and extracts only the current platform instead of downloading. Do not add a `cli.bundled` key to `kilo.properties` or repurpose `kilo.cli.pinned=false` for public bundled releases.
- For release questions, use the `/release-jetbrains` command; it verifies the CLI pin before creating immutable `jetbrains/v*` tags.
- For OS and environment checks, prefer IntelliJ Platform classes over raw JVM APIs such as `System.getProperty(...)` or `System.getenv(...)`.
- Detect architecture with `com.intellij.util.system.CpuArch.CURRENT`, not `System.getProperty("os.arch")`.
- Detect OS with `com.intellij.openapi.util.SystemInfo.isMac` / `isLinux` / `isWindows`.
- Read environment variables with `com.intellij.util.EnvironmentUtil.getValue(...)` or `getEnvironmentMap()` when platform-aware environment handling matters.
- Resolve IDE paths with `com.intellij.openapi.application.PathManager` rather than inferring paths from process working directories.
- For packaging/build plumbing, see `script/build.ts` and `backend/build.gradle.kts`.

### CLI Pinning, Unpinning, and Bumping

The JetBrains plugin has two independent CLI controls. Use the commands below directly when asked to change either one; do not hand-edit versions by guesswork.

For a one-shot pin/unpin/regen that also cleans every leftover CLI binary and build artifact in the current worktree, use the `jetbrains-cli-pin` skill (`.kilo/skills/jetbrains-cli-pin/SKILL.md`): `bun .kilo/skills/jetbrains-cli-pin/script/cli-pin.ts <pin|unpin|regen|clean>`.

**Pin mode** (`kilo.cli.pinned` in `packages/kilo-jetbrains/gradle.properties`) controls release CLI vs local repo CLI.

| Ask | Do |
|---|---|
| Unpin / use local repo CLI | Set `kilo.cli.pinned=false`, then run `./gradlew :backend:buildRepoCli` from `packages/kilo-jetbrains/`. `:backend:stageRepoCli` bundles `packages/opencode/dist/@kilocode/cli-<os>-<arch>/bin/`; runtime extracts it instead of downloading. |
| Re-pin / use release CLI | Set `kilo.cli.pinned=true`. This is the default and the only releasable state. |

`kilo.cli.pinned=false` is dev-only: OpenAPI generation runs from local `packages/opencode/` source and the local binary is bundled. Production Gradle builds, `script/build-version.sh`, and the release scripts hard-fail on `false`, so restore `true` before releasing.

**Pinned CLI version** (`packages/kilo-jetbrains/package.json` `version`) controls which GitHub CLI release the plugin downloads and generates the client from. The JetBrains release locks the value already merged to `origin/main`. Checking or bumping the pin (`check-pin.ts` / `set-pin.ts`) is part of the `/release-jetbrains` command flow — see `.kilo/command/release-jetbrains.md` for the full process (resolve version, pin verification, prepare, changelog, publish).

CLI releases also attempt a pin bump PR automatically after publishing and label it `jetbrains-cli-pin-bump`. Pre-release CLI bump PRs also receive the `pre-release` label, including preview-channel releases with a plain semver version. The CLI release workflow logs the PR URL when creation succeeds and logs a warning without failing the release if PR creation fails.

## Dev Storage Isolation

- In development (`runIdeSplitMode`, `runIdeBackend`, `runIdeFrontend`, or `runIde`), the Gradle property `kilo.dev.storage.isolated=true` makes the backend set `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, and `XDG_CACHE_HOME` to `<worktree>/.kilo-dev/{data,config,state,cache}` before spawning the CLI. The worktree root comes from the `kilo.dev.worktree.root` JVM system property (auto-set by Gradle from the project directory).
- The checked-in `Run IDE (Backend)`, `Run IDE (Frontend)`, and `Run IDE (Split Mode)` run configurations enable isolation by default (`-Pkilo.dev.storage.isolated=true`). Developers can disable it by passing `-Pkilo.dev.storage.isolated=false`.
- Use standard `XDG_*_HOME` env vars for this isolation. Do not introduce custom `KILO_DATA_DIR`, `KILO_GLOBAL_CONFIG_DIR`, `KILO_STATE_DIR`, or `KILO_CACHE_DIR` env vars — the CLI core already respects `XDG_*_HOME` via `xdg-basedir`.
- The `.kilo-dev/` directory is gitignored and created automatically on first run.
- The implementation lives in `KiloBackendCliManager.buildEnv()` / `devStorageEnv()`. Tests: `KiloBackendCliManagerEnvTest`.

## Debugging Session Event Logs

- Use `script/dev/part-update.sh client <session-id>` from `packages/kilo-jetbrains/` to print frontend `message.part.delta` text by part id.
- Use `script/dev/part-update.sh backend <session-id>` from `packages/kilo-jetbrains/` for backend sandbox events.
- Append with `>> file.txt` when you need to keep the output.
- For full chat payload previews in JetBrains dev runs, pass `-Pkilo.dev.log.chat.content=<mode>` where `<mode>` is `off` (default, no content), `preview` (cleaned/truncated content), or `full` (cleaned full content).
- `-Pkilo.dev.log.chat.preview.max=<n>` controls preview length, clamped from 1 to 2000.

## Build and Verification

- **Marketplace version build**: Use `script/build-version.sh <version>` from `packages/kilo-jetbrains/` to clean, build, sign, and verify the JetBrains Marketplace plugin ZIP. Pass `--skip-verification` only when explicitly needed.
- **Test version build**: If the user asks for a JetBrains test build, still require a version and use `script/build-version.sh <version> --skip-signing --skip-verification` from `packages/kilo-jetbrains/` so no signing secrets are needed. Add `--skip-clean` only when the user wants a faster incremental test build.
- **Typecheck**: `bun run typecheck` or `./gradlew typecheck` from `packages/kilo-jetbrains/` — compiles all Kotlin sources including the generated API client. A cold pinned build downloads the pinned CLI release via `generateOpenApiSpec` and needs network access; Gradle-cached incremental runs skip the download. Repo CLI mode (`-Pkilo.cli.pinned=false`) generates the spec from local source and bundles the staged local CLI binary.
- **Build local repo CLI for JetBrains dev**: `./gradlew :backend:buildRepoCli` from `packages/kilo-jetbrains/` builds `packages/opencode/dist/@kilocode/cli-<os>-<arch>/bin/`. `stageRepoCli` intentionally does not depend on this task; missing binaries fail with instructions instead of silently starting a slow CLI build.
- **Full build**: `bun run build` from `packages/kilo-jetbrains/` (runs Gradle `buildPlugin`).
- **Gradle only**: `./gradlew buildPlugin` from `packages/kilo-jetbrains/`.
- **Java checks**: Do not run `java -version` as a routine preflight. Gradle commands already fail clearly when Java is missing or incompatible; check Java only when diagnosing that failure mode.
- **Via Turbo**: `bun turbo build --filter=@kilocode/kilo-jetbrains` from repo root.
- **Run split mode**: `./gradlew --no-configuration-cache runIdeSplitMode` or the checked-in `Run IDE (Split Mode)` configuration — launches backend and frontend locally. Emulate latency via the Split Mode widget — internal mode is already on for every dev run (see below).
- **Run split backend**: `./gradlew --no-configuration-cache runIdeBackend` — if it exits shortly after startup, check for an orphaned Java process from a previous backend run and kill it before restarting.
- **Corrupt IDE extraction**: if `runIdeBackend` or `runIdeSplitMode` fails before startup with `coroutinesJavaAgentFile` / `Collection contains no element matching the predicate`, the extracted IDE under `.intellijPlatform/ides/` is likely incomplete. Health check: `ls .intellijPlatform/ides/*/lib/*.jar | wc -l` should be in the hundreds. Repair by removing `.intellijPlatform/ides`, `.intellijPlatform/localPlatformArtifacts`, `.intellijPlatform/layoutIndex`, and `.intellijPlatform/coroutines-javaagent.jar`, then rerun the Gradle task.
- **Run in monolithic sandbox**: `./gradlew runIde` — launches sandboxed IntelliJ with the plugin. Does not build or bundle CLI binaries; the backend downloads the pinned release at connect time.
- **Surveys are off in dev runs**: every `runIde*` task sets `platform.feedback=false`, `csat.survey.enabled=false`, and `editor.ux.survey.enabled=false` so IntelliJ feedback surveys ("Share Your Experience" / "Take Survey") never interrupt a sandbox run. These are IntelliJ registry keys overridden as JVM system properties; keep them unconditional.
- **Internal mode is on in dev runs**: every `runIde*` task sets `idea.is.internal=true` (`ApplicationManagerEx.IS_INTERNAL_PROPERTY`), which enables the Split Mode latency widget and the Internal Actions menu. The embedded JetBrains Client inherits this property from the backend; the survey keys above are not on that inherit list, so a split-mode client may still need them set in its own Registry.

### Stopping a Sandbox Run

Quit the sandbox IDE from inside it (File → Exit) instead of pressing Stop on the Gradle run tab. Stop on an external-system configuration only calls `CancellationTokenSource.cancel()` through the Gradle tooling API — the IDE never learns the forked JVM's pid, sends it no signal, and `ExternalSystemProcessHandler` does not implement `KillableProcess`, so there is no force-kill escalation either. Quitting the sandbox IDE lets it run its real shutdown sequence and the `JavaExec` task then completes on its own. Cancelling the build instead is what leaves the orphaned Java processes noted above.

Do not start a second `runIde*` task for a checkout while a sandbox IDE launched from that same checkout is still running. All `runIde*` tasks share one sandbox container per checkout (`.intellijPlatform/sandbox/kilo.jetbrains/<ide>/plugins_runIde*`), and `prepareSandbox` rewrites the running IDE's own plugin jars. The IDE then attempts a hot reload that cannot succeed and reports `Failed to unload modified plugins: Kilo Code`.

### CLI/SDK Change Awareness

- JetBrains runtime behavior normally depends on the downloaded CLI release pinned by `packages/kilo-jetbrains/package.json`; local `packages/opencode/` changes are used only with `kilo.cli.pinned=false` repo CLI mode.
- If there are relevant server/API changes outside `packages/kilo-jetbrains/`, warn the user that JetBrains may need a newly published/pinned CLI release and regenerated SDK artifacts.
