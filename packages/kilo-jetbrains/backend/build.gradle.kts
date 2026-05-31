import normalization.NormalizeOpenApiSpecTask

plugins {
    alias(libs.plugins.rpc)
    alias(libs.plugins.kotlin)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.openapi.generator)
    id("build-tasks")
}

kotlin {
    jvmToolchain(21)
}

val generatedApi = layout.buildDirectory.dir("generated/openapi/src/main/kotlin")
val rawSpec = layout.buildDirectory.file("generated/openapi-spec/openapi.raw.json")
val generatedSpec = layout.buildDirectory.file("generated/openapi-spec/openapi.json")

sourceSets {
    main {
        resources.srcDir(layout.buildDirectory.dir("generated/cli"))
        kotlin.srcDir(generatedApi)
    }
}

val generateOpenApiSpec by tasks.registering(GenerateOpenApiSpecTask::class) {
    description = "Generate CLI OpenAPI spec into the build directory"
    opencodeDir.set(rootProject.layout.projectDirectory.dir("../opencode"))
    serverSrcDir.set(rootProject.layout.projectDirectory.dir("../opencode/src/server"))
    spec.set(rawSpec)
}

val normalizeOpenApiSpec by tasks.registering(NormalizeOpenApiSpecTask::class) {
    description = "Normalize upstream CLI OpenAPI metadata before Kotlin client generation"
    dependsOn(generateOpenApiSpec)
    input.set(rawSpec)
    spec.set(generatedSpec)
}

openApiGenerate {
    generatorName.set("kotlin")
    library.set("jvm-okhttp4")
    inputSpec.set(generatedSpec.map { it.asFile.absolutePath })
    outputDir.set(layout.buildDirectory.dir("generated/openapi").get().asFile.absolutePath)
    packageName.set("ai.kilocode.jetbrains.api")
    apiPackage.set("ai.kilocode.jetbrains.api.client")
    modelPackage.set("ai.kilocode.jetbrains.api.model")
    configOptions.set(mapOf(
        "serializationLibrary" to "kotlinx_serialization",
        "omitGradleWrapper" to "true",
        "omitGradlePluginVersions" to "true",
        "useCoroutines" to "false",
        "sourceFolder" to "src/main/kotlin",
        "enumPropertyNaming" to "UPPERCASE",
    ))
    modelNameMappings.set(mapOf(
        "File" to "DiffFileInfo",
    ))
    typeMappings.set(mapOf(
        "AnyOfLessThanGreaterThan" to "kotlin.Any",
        "anyOf<>" to "kotlin.Any",
        "number" to "kotlin.Double",
        "decimal" to "kotlin.Double",
        "integer" to "kotlin.Long",
    ))
    openapiNormalizer.set(mapOf(
        "SIMPLIFY_ANYOF_STRING_AND_ENUM_STRING" to "true",
        "SIMPLIFY_ONEOF_ANYOF" to "true",
    ))
    generateApiTests.set(false)
    generateModelTests.set(false)
    generateApiDocumentation.set(false)
    generateModelDocumentation.set(false)
}

tasks.named("openApiGenerate") {
    dependsOn(normalizeOpenApiSpec)
}

val fixGeneratedApi by tasks.registering(FixGeneratedApiTask::class) {
    dependsOn("openApiGenerate")
    generated.set(generatedApi)
}

tasks.named("compileKotlin") {
    dependsOn(fixGeneratedApi)
    inputs.dir(generatedApi)
}

tasks.named("compileTestKotlin") {
    dependsOn(fixGeneratedApi)
    inputs.dir(generatedApi)
}

val cliDir = layout.buildDirectory.dir("generated/cli/cli")
val production = providers.gradleProperty("production").map { it.toBoolean() }.orElse(false)

val prepareLocalCli by tasks.registering(PrepareLocalCliTask::class) {
    description = "Prepare the local-platform CLI binary for JetBrains backend runs"
    root.set(rootProject.layout.projectDirectory)
    dir.set(cliDir)
    bunPath.convention(
        providers.gradleProperty("kilo.bun.path")
            .orElse(providers.environmentVariable("BUN_EXE"))
    )
}

val requiredPlatforms = listOf(
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "windows-x64",
    "windows-arm64",
)

val prod = production
val checkCli by tasks.registering(CheckCliTask::class) {
    description = "Verify CLI binaries exist before packaging"
    dir.set(cliDir)
    this.production.set(prod)
    platforms.set(requiredPlatforms)
}

// CLI binaries are verified only at packaging time (buildPlugin), not at
// processResources time, so that Kotlin compile and tests work without binaries.
// Wire checkCli to buildPlugin in the root build.gradle.kts instead.

dependencies {
    intellijPlatform {
        intellijIdea(libs.versions.intellij.platform)
        bundledModule("intellij.platform.kernel.backend")
        bundledModule("intellij.platform.rpc.backend")
        bundledModule("intellij.platform.backend")
    }

    implementation(project(":shared"))
    implementation(libs.okhttp)
    implementation(libs.okhttp.sse)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
}
