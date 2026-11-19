import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import java.util.Properties

plugins {
    alias(libs.plugins.rpc)
    alias(libs.plugins.kotlin)
    alias(libs.plugins.kotlin.serialization)
}

kotlin { jvmToolchain(21) }

val generateV2Transport = tasks.register<Exec>("generateV2Transport") {
    description = "Generate Kotlin operations from the assembled v2 HTTP contract"
    val pkg = rootProject.layout.projectDirectory
    val output = layout.buildDirectory.dir("generated/v2/kotlin")
    workingDir(pkg)
    commandLine(providers.gradleProperty("bun.path").orElse("bun").get(), "script/generate.ts", output.get().asFile)
    inputs.file(pkg.file("script/generate.ts"))
    inputs.dir(pkg.dir("../protocol/src"))
    inputs.dir(pkg.dir("../schema/src"))
    inputs.file(pkg.file("../../bun.lock"))
    outputs.dir(output)
}

kotlin.sourceSets.main { kotlin.srcDir(generateV2Transport) }

val cliVersion = providers.fileContents(rootProject.layout.projectDirectory.file("package.json")).asText.map {
    Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(it)?.groupValues?.get(1) ?: error("Missing CLI pin in package.json")
}
val releaseManifest = providers.fileContents(layout.projectDirectory.file("src/main/resources/kilo-v2-cli.properties")).asText.map {
    Properties().apply { load(it.reader()) }
}
require(releaseManifest.get().getProperty("cli.version") == cliVersion.get()) {
    "The CLI release manifest does not match package.json. Run bun run pin:cli."
}

val stageBundledCli = tasks.register<Exec>("stageBundledCli") {
    description = "Stage verified v2 npm platform archives for an offline plugin distribution"
    val pkg = rootProject.layout.projectDirectory
    val output = layout.buildDirectory.dir("generated/cli-bundle")
    workingDir(pkg)
    commandLine(providers.gradleProperty("bun.path").orElse("bun").get(), "script/stage-cli.ts", output.get().asFile)
    inputs.file(pkg.file("script/stage-cli.ts"))
    inputs.file(layout.projectDirectory.file("src/main/resources/kilo-v2-cli.properties"))
    outputs.dir(output)
}
if (providers.gradleProperty("kilo.cli.bundled").map(String::toBooleanStrict).orElse(false).get()) {
    require(providers.gradleProperty("kilo.cli.pinned").get().toBooleanStrict()) { "Bundling requires kilo.cli.pinned=true" }
    sourceSets.main { resources.srcDir(stageBundledCli) }
}

dependencies {
    intellijPlatform {
        intellijIdea(libs.versions.intellij.platform)
        bundledModule("intellij.platform.kernel.backend")
        bundledModule("intellij.platform.rpc.backend")
        bundledModule("intellij.platform.backend")
        testFramework(TestFrameworkType.Platform)
    }
    implementation(project(":shared"))
    implementation(libs.okhttp)
    implementation(libs.okhttp.sse)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.commons.compress)

    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(kotlin("test"))
    testImplementation(libs.junit)
    testRuntimeOnly(libs.junit.vintage.engine)
}

tasks.test {
    useJUnitPlatform()
    jvmArgs("-Didea.force.use.core.classloader=true")
}
