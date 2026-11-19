import org.jetbrains.changelog.Changelog
import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.tasks.InstrumentCodeTask
import org.jetbrains.intellij.platform.gradle.tasks.RunIdeTask
import org.jetbrains.intellij.platform.gradle.tasks.aware.SplitModeAware.PluginInstallationTarget
import org.gradle.api.tasks.testing.Test
import org.gradle.api.tasks.testing.logging.TestExceptionFormat
import org.gradle.process.CommandLineArgumentProvider
import java.io.File
import java.time.LocalDate
import javax.inject.Inject

// The Gradle plugin classpath gets vulnerable jackson, guava, handlebars and jsoup from the IntelliJ
// Platform plugin (plugin-repository-rest-client) and openapi-generator, and their latest releases
// still pin them. Raise them to the security floors in libs.versions.toml. openapi-generator is
// declared below with `apply false` so it resolves in this same classpath.
buildscript {
    dependencies {
        classpath(platform(libs.security.jackson.bom))
        constraints {
            classpath(libs.security.guava)
            classpath(libs.security.handlebars)
            classpath(libs.security.jsoup)
        }
    }
}

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
    // The optional +<sha> is SemVer build metadata: it never affects release ordering (Release below
    // parses only the part before it) and only ever comes from a local override, never from a release
    // tag, so it cannot leak into a published version.
    require(Regex("^[0-9]+\\.[0-9]+\\.[0-9]+(-rc\\.[0-9]+)?(\\+[0-9a-f]+)?$").matches(value)) {
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
val pinned = providers.gradleProperty("kilo.cli.pinned").map { it.trim().toBoolean() }.orElse(true).get()
val e2e = providers.gradleProperty("kilo.e2e").map { it.trim().toBoolean() }.orElse(false).get()
val override = providers.gradleProperty("kilo.version").orNull?.trim()?.takeIf { it.isNotEmpty() }
val prop = providers.gradleProperty("kilo.jetbrains.version").orNull?.trim()?.takeIf { it.isNotEmpty() }
val tag = gitTag()?.removePrefix("jetbrains/v")
val ver = override?.let(::checked) ?: prop?.let(::checked) ?: if (release) checked(
    tag ?: error("Missing JetBrains plugin version. Publish builds must set kilo.jetbrains.version or run from a jetbrains/v<version> tag."),
) else checked(tag ?: "0.0.0-dev")

if (release && !pinned) error(
    "kilo.cli.pinned=false is a dev-only mode and cannot be released. Set kilo.cli.pinned=true before a production/publish build."
)

if (e2e && pinned) error(
    "The Kilo UI e2e task requires the local repo CLI. Pass -Pkilo.cli.pinned=false (and -Pkilo.e2e=true) or run through packages/kilo-jetbrains/script/e2e-driver.ts."
)

if (e2e && release) error(
    "The Kilo UI e2e task cannot run in a production/release build. Drop -Pproduction=true."
)

// Kotlin and the IntelliJ RPC compiler plugin must move together. The RPC plugin is a Kotlin compiler
// plugin built for one Kotlin minor line (its version starts with that Kotlin version: 2.3.21-RC2-0.1
// targets 2.3.x) and relies on compiler internals that change between minors. Under a newer Kotlin,
// :shared:compileKotlin fails with an opaque ClassCastException (IrGenerationExtension$Companion cannot
// be cast to ProjectExtensionDescriptor) that does not point at the cause. Dependabot keeps proposing
// Kotlin minor bumps on their own and never proposes RPC plugin bumps, so this fails at configuration
// time with the actual rule instead. The Kotlin serialization compiler plugin ships with Kotlin itself,
// so it must match kotlin-jvm-plugin exactly rather than only on the minor.
// Context: #14755, #14950, #15157 and #15421 (Kotlin 2.4.x bumps closed for this reason) and #15540
// (Dependabot grouping).
fun minor(value: String): String =
    Regex("^(\\d+\\.\\d+)\\.").find(value)?.groupValues?.get(1)
        ?: error("Unexpected version format in gradle/libs.versions.toml: $value")

val compiler = libs.versions.kotlin.jvm.plugin.get()
val serialization = libs.versions.kotlin.serialization.plugin.get()
val rpc = libs.versions.intellij.rpc.plugin.get()
if (serialization != compiler) error(
    "kotlin-serialization-plugin is $serialization but kotlin-jvm-plugin is $compiler. The serialization compiler " +
        "plugin ships with Kotlin and must use the same version: bump both together in gradle/libs.versions.toml."
)
if (minor(compiler) != minor(rpc)) error(
    "Kotlin $compiler requires an IntelliJ RPC compiler plugin built for Kotlin ${minor(compiler)}.x, but " +
        "intellij-rpc-plugin is $rpc (built for ${minor(rpc)}.x). Bump kotlin-jvm-plugin, " +
        "kotlin-serialization-plugin and intellij-rpc-plugin together in gradle/libs.versions.toml, " +
        "using an RPC build from https://packages.jetbrains.team/maven/p/ij/intellij-dependencies/rpc/rpc.gradle.plugin/"
)

val channel = providers.gradleProperty("kilo.channel").map { it.trim() }.orElse("default")
val splitPort = providers.gradleProperty("kilo.splitModeServerPort").map(::port).orElse(0)
val isolated = providers.gradleProperty("kilo.dev.storage.isolated").map { it.toBoolean() }.orElse(false)
val worktreeRoot = providers.gradleProperty("kilo.dev.worktree.root").orElse(
    providers.provider { rootProject.layout.projectDirectory.asFile.parentFile.parentFile.canonicalPath }
)

val ides = file(".intellijPlatform/ides")
val corrupt = ides.listFiles()
    ?.filter { ide ->
        // layoutIndex is the platform plugin's own layout cache (stored here since 2.19.0), not an IDE.
        ide.isDirectory && ide.name != "layoutIndex" && (
            ide.walkTopDown().none { it.name == "product-info.json" } ||
                ide.resolve("lib").listFiles()?.any { jar -> jar.isFile && jar.extension == "jar" } != true
        )
    }
    .orEmpty()

if (corrupt.isNotEmpty()) {
    val paths = corrupt.joinToString("\n") { ide -> "- ${ide.absolutePath}" }
    error(
        """
        Incomplete IntelliJ Platform extraction detected:
        $paths

        Remove .intellijPlatform/ides, .intellijPlatform/localPlatformArtifacts, .intellijPlatform/layoutIndex,
        and .intellijPlatform/coroutines-javaagent.jar, then rerun the Gradle task.
        """.trimIndent(),
    )
}

version = ver

plugins {
    application
    id("java")
    alias(libs.plugins.intellij.platform)
    alias(libs.plugins.detekt)
    alias(libs.plugins.changelog)

    alias(libs.plugins.kotlin)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.openapi.generator) apply false
}

kotlin {
    jvmToolchain(21)
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

val uiE2e = sourceSets.create("uiTest") {
    compileClasspath = project.configurations[compileClasspathConfigurationName]
    runtimeClasspath = files(
        project.configurations[runtimeClasspathConfigurationName],
        output,
        project.layout.buildDirectory.dir("classes/kotlin/uiTest"),
    )
}
dependencies {
    intellijPlatform {
        intellijIdea(libs.versions.intellij.platform)

        pluginModule(implementation(project(":shared")))
        pluginModule(implementation(project(":frontend")))
        pluginModule(implementation(project(":backend")))
        testFramework(TestFrameworkType.Platform)
        testFramework(
            TestFrameworkType.Starter,
            libs.versions.intellij.starter.get(),
            configurationName = "uiTestImplementation",
        )
    }

    "uiTestImplementation"(kotlin("stdlib"))
    "uiTestImplementation"(libs.junit.jupiter)
    "uiTestRuntimeOnly"(libs.junit.platform.launcher)
    "uiTestImplementation"(libs.kodein.di)
    "uiTestImplementation"(libs.kotlinx.coroutines)
    "uiTestImplementation"(libs.kotlinx.serialization.json)
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
        // CI passes raw secret content so signing can run without writing secrets to disk.
        // Local release builds can still point these properties at pre-existing secret files.
        certificateChain = providers.environmentVariable("JETBRAINS_CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("JETBRAINS_PRIVATE_KEY")
        certificateChainFile.fileProvider(providers.environmentVariable("JETBRAINS_CERTIFICATE_CHAIN_FILE").map { File(it) })
        privateKeyFile.fileProvider(providers.environmentVariable("JETBRAINS_PRIVATE_KEY_FILE").map { File(it) })
        password = providers.environmentVariable("JETBRAINS_PRIVATE_KEY_PASSWORD")
    }

    pluginVerification {
        ides {
            create(IntelliJPlatformType.IntellijIdea, libs.versions.intellij.platform)
        }
    }
}

val e2eRequest = providers.gradleProperty("kilo.e2e.request")
val e2eResult = providers.gradleProperty("kilo.e2e.result")
val backendCliArchive = project(":backend").layout.buildDirectory.file("generated/kilo-cli-res/kilo-cli.zip")

val uiTest by intellijPlatformTesting.testIdeUi.registering {
    splitMode.set(true)
    pluginInstallationTarget.set(PluginInstallationTarget.BOTH)
    testFramework(TestFrameworkType.Starter, libs.versions.intellij.starter.get())

    task {
        group = "verification"
        description = "Run the headful Starter/Driver split-mode Kilo UI adapter"
        notCompatibleWithConfigurationCache("Kilo UI e2e consumes request/result paths and the descriptor environment at execution time")
        testClassesDirs = files(uiE2e.output.classesDirs, layout.buildDirectory.dir("classes/kotlin/uiTest"))
        classpath = uiE2e.runtimeClasspath
        useJUnitPlatform()
        maxHeapSize = "4g"
        maxParallelForks = 1
        outputs.upToDateWhen { false }
        filter { includeTestsMatching("ai.kilocode.e2e.JetBrainsDriverTest") }
        testLogging {
            events("passed", "failed", "skipped")
            showStandardStreams = true
            exceptionFormat = TestExceptionFormat.FULL
        }
        systemProperty("java.awt.headless", "false")
        systemProperty("kilo.e2e.pinned", pinned.toString())
        jvmArgumentProviders += CommandLineArgumentProvider {
            listOf(
                "-Dkilo.e2e.request=${e2eRequest.orNull.orEmpty()}",
                "-Dkilo.e2e.result=${e2eResult.orNull.orEmpty()}",
                "-Dkilo.e2e.pluginArchive=${archiveFile.get().asFile.absolutePath}",
                "-Dkilo.e2e.cliArchive=${backendCliArchive.get().asFile.absolutePath}",
                "-Dkilo.e2e.cliMode=${if (pinned) "released" else "repo"}",
                "-Dkilo.e2e.ideVersion=${libs.versions.intellij.platform.get()}",
            )
        }
        doFirst {
            if (!e2e) throw GradleException(
                "uiTest requires -Pkilo.e2e=true and -Pkilo.cli.pinned=false. " +
                    "Run packages/kilo-jetbrains/script/e2e-driver.ts instead.",
            )
            if (pinned) throw GradleException(
                "uiTest requires -Pkilo.cli.pinned=false so the plugin uses the local repo CLI.",
            )
            if (e2eRequest.orNull.isNullOrBlank()) throw GradleException("uiTest requires -Pkilo.e2e.request=<path>.")
            if (e2eResult.orNull.isNullOrBlank()) throw GradleException("uiTest requires -Pkilo.e2e.result=<path>.")
        }
    }
}

if (!pinned) {
    tasks.named("uiTest") {
        dependsOn(":backend:buildRepoCli")
    }
}

tasks.register<Test>("uiTestUnit") {
    group = "verification"
    description = "Run the non-IDE K1 protocol and redaction tests"
    testClassesDirs = files(uiE2e.output.classesDirs, layout.buildDirectory.dir("classes/kotlin/uiTest"))
    classpath = uiE2e.runtimeClasspath
    useJUnitPlatform()
    filter { includeTestsMatching("ai.kilocode.e2e.ProtocolTest") }
    testLogging {
        events("passed", "failed", "skipped")
        exceptionFormat = TestExceptionFormat.FULL
    }
}

tasks {
    named("verifyPluginSignature") {
        dependsOn("signPlugin")
    }

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
// without running buildPlugin. compileUiTestKotlin keeps the headful Starter/Driver adapter
// covered in CI without launching an IDE.
tasks.register("typecheck") {
    dependsOn(
        ":shared:compileKotlin",
        ":frontend:compileKotlin",
        ":backend:compileKotlin",
        ":frontend:compileTestKotlin",
        ":backend:compileTestKotlin",
        "compileUiTestKotlin",
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
    // Suppress IntelliJ feedback surveys ("Share Your Experience" / "Take Survey" popups) in dev runs.
    // These are registry keys from platform/feedback; registry values can be overridden with -D<key>=<value>.
    systemProperty("platform.feedback", "false")
    systemProperty("csat.survey.enabled", "false")
    systemProperty("editor.ux.survey.enabled", "false")
    // Internal mode: enables the Split Mode latency widget and the Internal Actions menu.
    // Property name is ApplicationManagerEx.IS_INTERNAL_PROPERTY; the embedded JetBrains Client
    // inherits it from the backend (EmbeddedClientLauncher.passProperties).
    systemProperty("idea.is.internal", "true")
}

tasks.named<Delete>("clean") {
    delete(layout.buildDirectory)
}

// ide-starter (UI e2e driver) and the IntelliJ test framework pin vulnerable netty, bouncycastle,
// jackson, guava, jsoup and OpenTelemetry versions, and the newest 2026.1 builds still do. This
// rule fixes their published metadata: it adds the security BOMs and constraints from
// libs.versions.toml, which Gradle only ever uses to raise a version.
abstract class SecurityFloors @Inject constructor(
    private val boms: List<String>,
    private val floors: List<String>,
) : ComponentMetadataRule {
    @get:Inject
    abstract val objects: ObjectFactory

    override fun execute(context: ComponentMetadataContext) {
        context.details.allVariants {
            withDependencies {
                boms.forEach { bom ->
                    add(bom) {
                        attributes { attribute(Category.CATEGORY_ATTRIBUTE, objects.named(Category.REGULAR_PLATFORM)) }
                    }
                }
            }
            withDependencyConstraints {
                floors.forEach { add(it) }
            }
        }
    }
}

fun coords(lib: Provider<MinimalExternalModuleDependency>) = lib.get().let { "${it.module}:${it.version}" }

val boms = listOf(libs.security.jackson.bom, libs.security.opentelemetry.bom).map(::coords)
val floors = listOf(
    libs.security.netty.buffer,
    libs.security.netty.codec.compression,
    libs.security.netty.codec.http2,
    libs.security.bcprov,
    libs.security.bcpkix,
    libs.security.guava,
    libs.security.jsoup,
).map(::coords)
val lz4 = coords(libs.security.lz4)

allprojects {
    dependencies.components {
        listOf("com.jetbrains.intellij.tools:ide-starter-squashed", "com.jetbrains.intellij.platform:test-framework-core").forEach {
            withModule(it, SecurityFloors::class) { params(boms, floors) }
        }
    }
    // org.lz4:lz4-java is abandoned with unfixed advisories (ide-starter pulls it in). Swap it for
    // its maintained fork wherever it appears in a graph, at any depth.
    configurations.configureEach {
        resolutionStrategy.dependencySubstitution {
            substitute(module("org.lz4:lz4-java")).using(module(lz4)).because("org.lz4 is unmaintained, use the at.yawk.lz4 fork")
        }
    }
}
