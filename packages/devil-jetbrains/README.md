# Kilo JetBrains

AI coding agent plugin for JetBrains IDEs.

---

## Set up your environment

### Prerequisites

- **Bun** -- used to build CLI binaries and run build scripts
- **JDK 21+** -- required by Gradle and the IntelliJ Platform SDK
- **IntelliJ IDEA** -- to run the plugin in a sandboxed IDE

---

## Open in IntelliJ

When you open the monorepo root in IntelliJ IDEA, the Gradle project at `packages/kilo-jetbrains/` should be auto-detected via `.idea/gradle.xml`. If not, link it manually: **File > Settings > Build Tools > Gradle > +** and select `packages/kilo-jetbrains/settings.gradle.kts`.

---

## Build locally

From `packages/kilo-jetbrains/`:

```
bun run build
```

This builds the CLI binary for your current OS/arch only, copies it into the backend module resources, and runs `./gradlew buildPlugin`. The plugin archive is output to `build/distributions/`.

Or via Turbo from the repo root:

```
bun turbo build --filter=@kilocode/kilo-jetbrains
```

---

## Build for production

From `packages/kilo-jetbrains/`:

```
bun run build:production
```

This builds CLI binaries for all 6 desktop platforms (darwin-arm64, darwin-x64, linux-arm64, linux-x64, windows-x64, windows-arm64), copies them all into the backend jar, and fails if any are missing. Gradle also validates all platforms are present via `-Pproduction=true`.

The built plugin archive is at `build/distributions/kilo.jetbrains-<version>.zip`. This zip can be installed in any JetBrains IDE via **Settings > Plugins > Install Plugin from Disk**.

---

## Run the plugin

After building, use the `runIde` Gradle task (available in the Gradle tool window or via the "Run JetBrains Plugin" run configuration) to launch a sandboxed IntelliJ instance with the plugin installed.

Note: `runIde` does not build CLI binaries -- run `bun run build` at least once before using it. Subsequent Kotlin/Gradle changes can be iterated with `runIde` directly.

---

## Run Gradle directly

You can run `./gradlew buildPlugin` directly if CLI binaries are already in `backend/build/generated/cli/`. Gradle will fail with a clear error if they are missing.

For production verification:

```
./gradlew buildPlugin -Pproduction=true
```
