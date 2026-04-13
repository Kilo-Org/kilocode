plugins {
    alias(libs.plugins.rpc)
    alias(libs.plugins.kotlin)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.openapi.generator)
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
        "serializationLibrary" to "moshi",
        "omitGradleWrapper" to "true",
        "omitGradlePluginVersions" to "true",
        "useCoroutines" to "false",
        "sourceFolder" to "src/main/kotlin",
        "enumPropertyNaming" to "UPPERCASE",
    ))
    // Remap schema "File" so the generated class is not named java.io.File
    modelNameMappings.set(mapOf(
        "File" to "DiffFileInfo",
    ))
    // Map empty anyOf references to kotlin.Any
    typeMappings.set(mapOf(
        "AnyOfLessThanGreaterThan" to "kotlin.Any",
        "anyOf<>" to "kotlin.Any",
    ))
    // Normalise OpenAPI 3.1 → 3.0-compatible patterns
    openapiNormalizer.set(mapOf(
        "SIMPLIFY_ANYOF_STRING_AND_ENUM_STRING" to "true",
        "SIMPLIFY_ONEOF_ANYOF" to "true",
    ))
    generateApiTests.set(false)
    generateModelTests.set(false)
    generateApiDocumentation.set(false)
    generateModelDocumentation.set(false)
}

// Fix openapi-generator 3.1.1 codegen bugs in generated Kotlin sources.
//
// The OpenAPI spec uses `const: true` on boolean fields (e.g. `healthy`).
// openapi-generator turns these into single-value enum classes:
//
//   val healthy: GlobalHealth200Response.Healthy
//   enum class Healthy(val value: kotlin.Boolean) { @Json(name = "true") TRUE("true") }
//
// Moshi's EnumJsonAdapter calls nextString() for the value, but the server sends
// a JSON boolean `true`, not a JSON string `"true"`, causing:
//   JsonDataException: Expected a string but was BOOLEAN at path $.healthy
//
// Fix: replace the enum field type with kotlin.Boolean, remove the enum class.
val fixGeneratedApi by tasks.registering {
    dependsOn("openApiGenerate")
    val dir = generatedApi
    doLast {
        // Regex to find boolean const enum declarations inside data classes.
        // Captures the enum name so we can find and fix the corresponding field.
        val enumDecl = Regex(
            """enum class (\w+)\(val value: kotlin\.Boolean\)"""
        )
        dir.get().asFile.walkTopDown().filter { it.extension == "kt" }.forEach { file ->
            var text = file.readText()
            val names = enumDecl.findAll(text).map { it.groupValues[1] }.toList()
            if (names.isEmpty()) return@forEach

            for (name in names) {
                // Replace field type: `val foo: EnclosingClass.EnumName` → `val foo: kotlin.Boolean`
                text = text.replace(Regex("""(val \w+:\s*)\w+\.$name""")) { m ->
                    "${m.groupValues[1]}kotlin.Boolean"
                }
                // Remove the @JsonClass annotation + enum class block
                text = text.replace(Regex(
                    """\n\s*@JsonClass\(generateAdapter = false\)\s*\n\s*enum class $name\(val value: kotlin\.Boolean\)\s*\{[^}]*\}"""
                ), "")
                // Remove the orphaned KDoc block that preceded the enum (lines of ` *` ending with `*/`)
                // These look like:  \n    /**\n     * \n     *\n     * Values: TRUE\n     */
                text = text.replace(Regex(
                    """\n\s*/\*\*\s*\n(\s*\*[^\n]*\n)*\s*\*/\s*(?=\n\s*\n)"""
                ), "")
            }
            file.writeText(text)
        }
    }
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

val checkCli by tasks.registering {
    description = "Verify CLI binaries exist before building"
    val dir = cliDir.map { it.asFile }
    val prod = production.get()
    val platforms = requiredPlatforms.toList()
    doLast {
        val resolved = dir.get()
        if (!resolved.exists() || resolved.listFiles()?.isEmpty() != false) {
            throw GradleException(
                "CLI binaries not found at ${resolved.absolutePath}.\n" +
                "Run 'bun run build' from packages/kilo-jetbrains/ to build CLI and plugin together."
            )
        }
        if (prod) {
            val missing = platforms.filter { platform ->
                val dir = File(resolved, platform)
                val exe = if (platform.startsWith("windows")) "kilo.exe" else "kilo"
                !File(dir, exe).exists()
            }
            if (missing.isNotEmpty()) {
                throw GradleException(
                    "Production build requires all platform CLI binaries.\n" +
                    "Missing: ${missing.joinToString(", ")}\n" +
                    "Run 'bun run build:production' to build all platforms."
                )
            }
        }
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
    implementation(libs.moshi)
    implementation(libs.moshi.kotlin)
}
