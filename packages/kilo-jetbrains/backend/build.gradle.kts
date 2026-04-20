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

sourceSets {
    main {
        resources.srcDir(layout.buildDirectory.dir("generated/cli"))
        kotlin.srcDir(generatedApi)
    }
}

openApiGenerate {
    generatorName.set("kotlin")
    library.set("jvm-okhttp4")
    inputSpec.set("${rootDir}/../sdk/openapi.json")
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

val fixGeneratedApi by tasks.registering(FixGeneratedApiTask::class) {
    dependsOn("openApiGenerate")
    generated.set(generatedApi)
}

tasks.named("compileKotlin") {
    dependsOn(fixGeneratedApi)
}

val cliDir = layout.buildDirectory.dir("generated/cli/cli")
val production = providers.gradleProperty("production").map { it.toBoolean() }.orElse(false)

val requiredPlatforms = listOf(
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "windows-x64",
    "windows-arm64",
)

val localCli by tasks.registering(PrepareLocalCliTask::class) {
    description = "Prepare local CLI binary for JetBrains dev"
    val os = providers.systemProperty("os.name").map {
        val name = it.lowercase()
        if (name.contains("mac")) return@map "darwin"
        if (name.contains("win")) return@map "windows"
        if (name.contains("linux")) return@map "linux"
        throw GradleException("Unsupported host OS: $it")
    }
    val arch = providers.systemProperty("os.arch").map {
        val name = it.lowercase()
        if (name == "aarch64" || name == "arm64") return@map "arm64"
        if (name == "x86_64" || name == "amd64") return@map "x64"
        throw GradleException("Unsupported host arch: $it")
    }
    script.set(rootProject.layout.projectDirectory.file("script/build.ts"))
    root.set(rootProject.layout.projectDirectory)
    out.set(cliDir)
    platform.set(os.zip(arch) { a, b -> "$a-$b" })
    exe.set(platform.map { if (it.startsWith("windows")) "kilo.exe" else "kilo" })
}

val prod = production
val checkCli by tasks.registering(CheckCliTask::class) {
    description = "Verify CLI binaries exist before building"
    dir.set(cliDir)
    this.production.set(prod)
    platforms.set(requiredPlatforms)
    if (!prod.get()) {
        dependsOn(localCli)
    }
}

tasks.processResources {
    dependsOn(checkCli)
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
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
}
