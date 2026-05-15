import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.tasks.RunIdeTask
import org.jetbrains.intellij.platform.gradle.tasks.aware.SplitModeAware.SplitModeTarget

group = "ai.kilocode.jetbrains"

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
        splitModeServerPort.set(12345)
    }
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
}

tasks.named<Delete>("clean") {
    delete(layout.buildDirectory)
}
