import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.gradle.api.tasks.Copy

plugins {
    alias(libs.plugins.rpc)
    alias(libs.plugins.kotlin)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    intellijPlatform {
        intellijIdea(libs.versions.intellij.platform)
        bundledModule("intellij.platform.frontend")
        bundledPlugin("org.jetbrains.plugins.terminal")
        bundledModule("intellij.terminal.frontend")
        testFramework(TestFrameworkType.Platform)
    }

    implementation(project(":shared"))

    implementation(libs.commonmark)
    implementation(libs.commonmark.autolink)
    implementation(libs.commonmark.tables)
    implementation(libs.commonmark.strikethrough)
    // Bundled explicitly rather than relied on as a transitive of commonmark-ext-autolink: the URL
    // scanner is used directly to linkify code spans.
    implementation(libs.autolink)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.zxing.core)

    testImplementation(kotlin("test"))
    testImplementation(libs.junit)
    testRuntimeOnly(libs.junit.vintage.engine)
}

val providerIcons = tasks.register<Copy>("generateProviderIcons") {
    val src = layout.projectDirectory.dir("../../ui/src/assets/icons/provider")
    val out = layout.buildDirectory.dir("generated/provider-icons/icons/providers")
    from(src) {
        include("*.svg")
        filter { line: String -> line.replace("currentColor", "#6E6E6E") }
    }
    into(out)
}

val providerIconsDark = tasks.register<Copy>("generateProviderIconsDark") {
    val src = layout.projectDirectory.dir("../../ui/src/assets/icons/provider")
    val out = layout.buildDirectory.dir("generated/provider-icons/icons/providers")
    from(src) {
        include("*.svg")
        rename { name -> name.removeSuffix(".svg") + "_dark.svg" }
        filter { line: String -> line.replace("currentColor", "#CED0D6") }
    }
    into(out)
}

sourceSets.main {
    resources.srcDir(layout.buildDirectory.dir("generated/provider-icons"))
}

tasks.processResources {
    dependsOn(providerIcons, providerIconsDark)
}

tasks.test {
    // BasePlatformTestCase uses JUnit 3 test naming (test prefix),
    // discovered by the vintage engine via JUnit Platform
    useJUnitPlatform()
    // Ensure JUnit 3/4 tests run via vintage engine
    jvmArgs("-Didea.force.use.core.classloader=true")
}
