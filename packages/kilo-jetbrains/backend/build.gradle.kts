plugins {
    alias(libs.plugins.kotlin)
}

kotlin {
    jvmToolchain(21)
}

sourceSets {
    main {
        resources.srcDir(layout.buildDirectory.dir("generated/cli"))
    }
}

val cliDir = layout.buildDirectory.dir("generated/cli/cli")
val production = providers.gradleProperty("production").map { it.toBoolean() }.orElse(false)

val requiredPlatforms = listOf(
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "windows-x64",
    "windows-arm64",
)

val checkCli by tasks.registering {
    description = "Verify CLI binaries exist before building"
    val dir = cliDir.map { it.asFile }
    val prod = production.get()
    val platforms = requiredPlatforms.toList()
    doLast {
        val resolved = dir.get()
        if (!resolved.exists() || resolved.listFiles()?.isEmpty() != false) {
            throw GradleException(
                "CLI binaries not found at ${resolved.absolutePath}.\n" +
                "Run 'bun run build' from packages/kilo-jetbrains/ to build CLI and plugin together."
            )
        }
        if (prod) {
            val missing = platforms.filter { platform ->
                val dir = File(resolved, platform)
                val exe = if (platform.startsWith("windows")) "kilo.exe" else "kilo"
                !File(dir, exe).exists()
            }
            if (missing.isNotEmpty()) {
                throw GradleException(
                    "Production build requires all platform CLI binaries.\n" +
                    "Missing: ${missing.joinToString(", ")}\n" +
                    "Run 'bun run build:production' to build all platforms."
                )
            }
        }
    }
}

tasks.processResources {
    dependsOn(checkCli)
}

dependencies {
    intellijPlatform {
        intellijIdea(libs.versions.intellij.platform)
        bundledModule("intellij.platform.backend")
    }

    implementation(project(":shared"))
}
