import org.jetbrains.intellij.platform.gradle.TestFrameworkType

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
        testFramework(TestFrameworkType.Platform)
    }

    implementation(project(":shared"))

    implementation(libs.commonmark)
    implementation(libs.commonmark.autolink)
    implementation(libs.commonmark.tables)
    implementation(libs.commonmark.strikethrough)

    testImplementation(kotlin("test"))
    testImplementation("junit:junit:4.13.2")
    testRuntimeOnly("org.junit.vintage:junit-vintage-engine:5.11.4")
}

tasks.test {
    // BasePlatformTestCase uses JUnit 3 test naming (test prefix),
    // discovered by the vintage engine via JUnit Platform
    useJUnitPlatform()
    // Ensure JUnit 3/4 tests run via vintage engine
    jvmArgs("-Didea.force.use.core.classloader=true")
}
