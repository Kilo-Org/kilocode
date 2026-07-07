import org.jetbrains.changelog.Changelog
import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.tasks.InstrumentCodeTask
import org.jetbrains.intellij.platform.gradle.tasks.RunIdeTask
import org.jetbrains.intellij.platform.gradle.tasks.aware.SplitModeAware.PluginInstallationTarget
import java.time.LocalDate

group = "ai.kilocode.jetbrains"

fun port(value: String): Int {
    val text = value.trim()
    require(text.isNotEmpty()) {
        "kilo.splitModeServerPort must be an integer from 0 to 65535; use 0 or omit it for a random port"
    }
    val n = text.toIntOrNull()
        ?: error("kilo.splitModeServerPort must be an integer from 0 to 65535; use 0 or omit it for a random port")
    require(n in 0..65535) {
        "kilo.splitModeServerPort must be an integer from 0 to 65535; use 0 or omit it for a random port"
    }
    return n
}

fun checked(value: String): String {
    if (value == "0.0.0-dev") return value
    require(Regex("^[0-9]+\\.[0-9]+\\.[0-9]+(-rc\\.[0-9]+)?$").matches(value)) {
        "Invalid JetBrains plugin version: $value"
    }
    return value
}

data class Release(val major: Int, val minor: Int, val patch: Int, val rc: Int?) : Comparable<Release> {
    val stable = rc == null
    val base get() = if (stable) this else Release(major, minor, patch, null)
    val text = listOfNotNull("$major.$minor.$patch", rc?.let { "rc.$it" }).joinToString("-")

    override fun compareTo(other: Release): Int {
        val cmp = compareValuesBy(this, other, Release::major, Release::minor, Release::patch)
        if (cmp != 0) return cmp
        return compareValues(rc ?: Int.MAX_VALUE, other.rc ?: Int.MAX_VALUE)
    }
}

fun release(value: String): Release? {
    val match = Regex("^(\\d+)\\.(\\d+)\\.(\\d+)(?:-rc\\.(\\d+))?$").matchEntire(value) ?: return null
    return Release(
        match.groupValues[1].toInt(),
        match.groupValues[2].toInt(),
        match.groupValues[3].toInt(),
        match.groupValues[4].takeIf { it.isNotEmpty() }?.toInt(),
    )
}

fun releases(): List<Release> {
    val heading = Regex("^## \\[(.+?)](?: - .*)?$|^## ([^\\[]\\S*)$")
    return file("CHANGELOG.md").readLines()
        .mapNotNull { line ->
            val match = heading.matchEntire(line.trim()) ?: return@mapNotNull null
            release(match.groupValues[1].ifEmpty { match.groupValues[2] })
        }
        .distinctBy { it.text }
}

fun selected(value: String): List<String> {
    val current = release(value) ?: return emptyList()
    val entries = releases()
    val rcs = if (current.stable) emptyList() else entries
        .filter { !it.stable && it.base == current.base && it <= current }
        .sortedDescending()
    val stables = entries
        .filter { it.stable && if (current.stable) it <= current else it < current.base }
        .sortedDescending()
        .take(5)
    return (rcs + stables).map { it.text }
}

fun gitTag(): String? {
    val text = providers.exec {
        commandLine("git", "tag", "--points-at", "HEAD")
    }.standardOutput.asText.get()
    return text.lineSequence().map { it.trim() }.firstOrNull { it.startsWith("jetbrains/v") }
}

val release = providers.gradleProperty("production").map { it.toBoolean() }.orElse(false).get()
val override = providers.gradleProperty("kilo.version").orNull?.trim()?.takeIf { it.isNotEmpty() }
val prop = providers.gradleProperty("kilo.jetbrains.version").orNull?.trim()?.takeIf { it.isNotEmpty() }
val tag = gitTag()?.removePrefix("jetbrains/v")
val ver = override?.let(::checked) ?: prop?.let(::checked) ?: if (release) checked(
    tag ?: error("Missing JetBrains plugin version. Publish builds must set kilo.jetbrains.version or run from a jetbrains/v<version> tag."),
) else checked(tag ?: "0.0.0-dev")

val channel = providers.gradleProperty("kilo.channel").map { it.trim() }.orElse("default")
val splitPort = providers.gradleProperty("kilo.splitModeServerPort").map(::port).orElse(0)
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
    alias(libs.plugins.changelog)

    alias(libs.plugins.kotlin) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.compose.compiler) apply false
}

changelog {
    version = ver
    path = file("CHANGELOG.md").canonicalPath
    header = provider { "[${version.get()}] - ${LocalDate.now()}" }
    unreleasedTerm = "[Unreleased]"
    keepUnreleasedSection = true
    repositoryUrl = "https://github.com/Kilo-Org/kilocode"
    groups = listOf("Added", "Changed", "Fixed", "Removed", "Security")
    combinePreReleases = false
}

val notes = providers.gradleProperty("kilo.changeNotes").orElse(
    provider {
        val versions = selected(ver).filter { changelog.has(it) }
        if (versions.isNotEmpty()) return@provider versions.joinToString("\n") { item ->
            changelog.renderItem(
                changelog.get(item).withHeader(true).withEmptySections(false),
                Changelog.OutputType.HTML,
            )
        }
        val item = if (changelog.has(ver)) changelog.get(ver) else changelog.getUnreleased()
        changelog.renderItem(item.withHeader(false).withEmptySections(false), Changelog.OutputType.HTML)
    },
)

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
    pluginInstallationTarget = PluginInstallationTarget.BOTH

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
    withType<InstrumentCodeTask> {
        enabled = false
    }

    runIdeBackend {
        splitModeServerPort.set(splitPort)
        dependsOn(":backend:processResources")
    }

    runIdeFrontend {
        splitModeServerPort.set(splitPort)
    }

    runIdeSplitMode {
        splitModeServerPort.set(splitPort)
        dependsOn(":backend:processResources")
    }
}

// Compile-only typecheck: verifies Kotlin compiles (including generated API client)
// without running buildPlugin.
tasks.register("typecheck") {
    dependsOn(
        ":shared:compileKotlin",
        ":frontend:compileKotlin",
        ":backend:compileKotlin",
        ":frontend:compileTestKotlin",
        ":backend:compileTestKotlin",
    )
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
