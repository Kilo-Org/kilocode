import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.tasks.InstrumentCodeTask
import org.jetbrains.intellij.platform.gradle.tasks.RunIdeTask
import org.jetbrains.intellij.platform.gradle.tasks.aware.SplitModeAware.PluginInstallationTarget

plugins {
    java
    alias(libs.plugins.intellij.platform)
    alias(libs.plugins.kotlin) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}

group = "ai.kilocode.jetbrains"
version = providers.gradleProperty("kilo.version").orElse(providers.gradleProperty("kilo.jetbrains.version")).get()

val pinned = providers.gradleProperty("kilo.cli.pinned").map(String::toBooleanStrict).get()
if (providers.gradleProperty("production").orNull == "true") {
    require(pinned) { "Production builds require kilo.cli.pinned=true" }
}

subprojects {
    apply(plugin = "org.jetbrains.intellij.platform.module")
}

allprojects {
    repositories {
        mavenCentral()
        intellijPlatform { defaultRepositories() }
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
        id = "ai.kilocode.jetbrains.v2"
        name = "Kilo Code (v2 preview)"
        version = project.version.toString()
        ideaVersion { untilBuild = provider { null } }
        vendor { name = "Kilo Code"; url = "https://kilo.ai" }
    }
    publishing {
        token = providers.environmentVariable("JETBRAINS_MARKETPLACE_TOKEN")
        channels = providers.gradleProperty("kilo.channel").orElse("eap").map { listOf(it) }
    }
    signing {
        certificateChain = providers.environmentVariable("JETBRAINS_CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("JETBRAINS_PRIVATE_KEY")
        certificateChainFile.fileProvider(providers.environmentVariable("JETBRAINS_CERTIFICATE_CHAIN_FILE").map(::File))
        privateKeyFile.fileProvider(providers.environmentVariable("JETBRAINS_PRIVATE_KEY_FILE").map(::File))
        password = providers.environmentVariable("JETBRAINS_PRIVATE_KEY_PASSWORD")
    }
    pluginVerification {
        ides { create(IntelliJPlatformType.IntellijIdea, libs.versions.intellij.platform) }
    }
}

val worktreeRoot = providers.gradleProperty("kilo.dev.worktree.root").orElse(
    layout.projectDirectory.dir("../..").asFile.canonicalPath,
)
val splitPort = providers.gradleProperty("kilo.splitModeServerPort").map { it.toInt().also { n -> require(n in 0..65535) } }.orElse(0)

tasks {
    buildPlugin {
        from(layout.projectDirectory.file("../../LICENSE"))
    }
    if (providers.gradleProperty("kilo.cli.bundled").map(String::toBooleanStrict).orElse(false).get()) {
        buildPlugin { archiveClassifier.set("bundled") }
    }
    named("verifyPluginSignature") { dependsOn("signPlugin") }
    withType<InstrumentCodeTask> { enabled = false }
    withType<RunIdeTask> { systemProperty("kilo.dev.worktree.root", worktreeRoot.get()) }
    runIdeBackend { splitModeServerPort.set(splitPort) }
    runIdeFrontend { splitModeServerPort.set(splitPort) }
    runIdeSplitMode { splitModeServerPort.set(splitPort) }
    register("typecheck") {
        dependsOn(":shared:compileKotlin", ":frontend:compileKotlin", ":backend:compileKotlin",
            ":frontend:compileTestKotlin", ":backend:compileTestKotlin")
    }
}
