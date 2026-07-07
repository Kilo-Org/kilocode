import normalization.NormalizeOpenApiSpecTask
import org.gradle.api.tasks.WriteProperties

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
val generatedProps = layout.buildDirectory.dir("generated/kilo-props")

val pinnedCliVersion = providers.fileContents(rootProject.layout.projectDirectory.file("package.json")).asText.map { text ->
    Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(text)?.groupValues?.get(1)
        ?: error("Could not read version from package.json")
}

sourceSets {
    main {
        resources.srcDir(generatedProps)
        kotlin.srcDir(generatedApi)
    }
}

val writeKiloProperties by tasks.registering(WriteProperties::class) {
    description = "Write pinned Kilo CLI properties"
    val out = generatedProps.map { it.file("kilo.properties") }
    destinationFile.set(out)
    property("cli.version", pinnedCliVersion)
}

val generateOpenApiSpec by tasks.registering(GenerateOpenApiSpecTask::class) {
    description = "Generate CLI OpenAPI spec into the build directory"
    cliVersion.set(pinnedCliVersion)
    token.set(
        providers.environmentVariable("GH_TOKEN")
            .orElse(providers.environmentVariable("GITHUB_TOKEN"))
    )
    cacheDir.set(layout.buildDirectory.dir("cli-cache"))
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
    dependsOn(fixGeneratedApi, writeKiloProperties)
    inputs.dir(generatedApi)
}

tasks.named("processResources") {
    dependsOn(writeKiloProperties)
}

tasks.named("compileTestKotlin") {
    dependsOn(fixGeneratedApi)
    inputs.dir(generatedApi)
}

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
    implementation(libs.commons.compress)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
}
