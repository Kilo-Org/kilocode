import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.tasks.RunIdeTask
import org.jetbrains.intellij.platform.gradle.tasks.aware.SplitModeAware.SplitModeTarget

group = "ai.kilocode.jetbrains"

val ports = 49152..65535

fun fallback(): Int {
    return ports.random()
}

fun port(value: String): Int {
    val text = value.trim()
    if (text.isEmpty()) return fallback()
    val n = text.toIntOrNull()
        ?: error("kilo.splitModeServerPort must be an integer from 0 to 65535; use 0 or omit it for a random high port")
    require(n in 0..65535) {
        "kilo.splitModeServerPort must be an integer from 0 to 65535; use 0 or omit it for a random high port"
    }
    if (n == 0) return fallback()
    return n
}

fun checked(value: String): String {
    if (value == "0.0.0-dev") return value
    require(Regex("^[0-9]+\\.[0-9]+\\.[0-9]+(-rc\\.[0-9]+)?$").matches(value)) {
        "Invalid JetBrains plugin version: $value"
    }
    return value
}

fun gitTag(): String? {
    val text = providers.exec {
        commandLine("git", "tag", "--points-at", "HEAD")
    }.standardOutput.asText.get()
    return text.lineSequence().map { it.trim() }.firstOrNull { it.startsWith("jetbrains/v") }
}

val release = providers.gradleProperty("production").map { it.toBoolean() }.orElse(false).get()
val ver = if (release) checked(
    gitTag()?.removePrefix("jetbrains/v")
        ?: error("Missing JetBrains plugin version. Publish builds must run from a jetbrains/v<version> tag."),
) else checked(gitTag()?.removePrefix("jetbrains/v") ?: "0.0.0-dev")

val notes = providers.gradleProperty("kilo.changeNotes").orElse("Release candidate build.")
val channel = providers.gradleProperty("kilo.channel").map { it.trim() }.orElse("default")
val splitPort = providers.gradleProperty("kilo.splitModeServerPort").map(::port).orElse(providers.provider(::fallback))
val isolated = providers.gradleProperty("kilo.dev.storage.isolated").map { it.toBoolean() }.orElse(false)
val worktreeRoot = providers.gradleProperty("kilo.dev.worktree.root").orElse(
    providers.provider { rootProject.layout.projectDirectory.asFile.parentFile.parentFile.canonicalPath }
)

version = ver

plugins {
    application
    id("java")
    alias(libs.plugins.intellij.platform)
    alias(libs.plugins.detekt)

    alias(libs.plugins.kotlin) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.compose.compiler) apply false
}

subprojects {
    apply(plugin = "org.jetbrains.intellij.platform.module")
    apply(plugin = "io.gitlab.arturbosch.detekt")

    detekt {
        config.setFrom(rootProject.file("detekt.yml"))
        buildUponDefaultConfig = true
        source.setFrom("src/main/kotlin")
    }
}

detekt {
    config.setFrom(file("detekt.yml"))
    buildUponDefaultConfig = true
    source.setFrom("src/main/kotlin")
}

allprojects {
    repositories {
        mavenCentral()
        intellijPlatform {
            defaultRepositories()
        }
        maven("https://packages.jetbrains.team/maven/p/ij/intellij-dependencies/")
    }
}

dependencies {
    intellijPlatform {
        intellijIdea(libs.versions.intellij.platform)

        pluginModule(implementation(project(":shared")))
        pluginModule(implementation(project(":frontend")))
        pluginModule(implementation(project(":backend")))
        testFramework(TestFrameworkType.Platform)
    }
}

intellijPlatform {
    splitMode = true
    splitModeTarget = SplitModeTarget.BOTH

    pluginConfiguration {
        id = "ai.kilocode.jetbrains"
        name = "Kilo Code"
        version = provider { ver }
        changeNotes = notes

        ideaVersion {
            untilBuild = provider { null }
        }

        vendor {
            name = "Kilo Code"
            url = "https://kilo.ai"
        }
    }

    publishing {
        token = providers.environmentVariable("JETBRAINS_MARKETPLACE_TOKEN")
        channels = channel.map { value ->
            if (value.isBlank() || value == "default") return@map listOf("default")
            listOf(value)
        }
    }

    signing {
        certificateChain = providers.environmentVariable("JETBRAINS_CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("JETBRAINS_PRIVATE_KEY")
        password = providers.environmentVariable("JETBRAINS_PRIVATE_KEY_PASSWORD")
    }

    pluginVerification {
        ides {
            create(IntelliJPlatformType.IntellijIdea, libs.versions.intellij.platform)
        }
    }
}

tasks {
    runIdeBackend {
        splitModeServerPort.set(splitPort)
        dependsOn(":backend:prepareLocalCli")
        dependsOn(":backend:processResources")
    }
}

project(":backend").tasks.named("processResources") {
    mustRunAfter(":backend:prepareLocalCli")
}

// Compile-only typecheck: verifies Kotlin compiles (including generated API client)
// without running processResources, CLI binary prep, or buildPlugin.
tasks.register("typecheck") {
    dependsOn(
        ":shared:compileKotlin",
        ":frontend:compileKotlin",
        ":backend:compileKotlin",
        ":frontend:compileTestKotlin",
        ":backend:compileTestKotlin",
    )
}

// CLI binaries must be present before packaging. Wire the check here (not in
// :backend:processResources) so compile/test tasks work without CLI binaries.
tasks.named("buildPlugin") {
    dependsOn(":backend:checkCli")
}

tasks.named<JavaExec>("runIde") {
    dependsOn(":backend:processResources")
    jvmArgumentProviders += CommandLineArgumentProvider {
        listOf("-Dnosplash=true")
    }
}

tasks.withType<RunIdeTask> {
    val level = providers.gradleProperty("kilo.dev.log.level").orNull ?: "DEBUG"
    val content = providers.gradleProperty("kilo.dev.log.chat.content").orNull ?: "off"
    val preview = providers.gradleProperty("kilo.dev.log.chat.preview.max").orNull ?: "160"
    systemProperty("kilo.dev.log.level", level)
    systemProperty("kilo.dev.log.chat.content", content)
    systemProperty("kilo.dev.log.chat.preview.max", preview)
    systemProperty("kilo.dev.storage.isolated", isolated.get().toString())
    systemProperty("kilo.dev.worktree.root", worktreeRoot.get())
}

tasks.named<Delete>("clean") {
    delete(layout.buildDirectory)
}
