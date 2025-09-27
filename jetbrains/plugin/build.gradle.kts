// Copyright 2009-2025 Weibo, Inc.
// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: APACHE2.0
// SPDX-License-Identifier: Apache-2.0

// Convenient for reading variables from gradle.properties
fun properties(key: String) = providers.gradleProperty(key)

buildscript {
    dependencies {
        classpath("com.google.code.gson:gson:2.10.1")
    }
}

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "1.8.10"
    id("org.jetbrains.intellij") version "1.17.4"
    id("org.jlleitschuh.gradle.ktlint") version "11.6.1"
}

apply("genPlatform.gradle")

// ------------------------------------------------------------
// The 'debugMode' setting controls how plugin resources are prepared during the build process.
// It supports the following three modes:
//
// 1. "idea" — Local development mode (used for debugging VSCode plugin integration)
//    - Copies theme resources from src/main/resources/themes to:
//        ../resources/<vscodePlugin>/src/integrations/theme/default-themes/
//    - Automatically creates a .env file, which the Extension Host (Node.js side) reads at runtime.
//    - Enables the VSCode plugin to load resources from this directory for integration testing.
//    - Typically used when running IntelliJ with an Extension Host for live debugging and hot-reloading.
//
// 2. "release" — Production build mode (used to generate deployment artifacts)
//    - Requires platform.zip to exist, which can be retrieved via git-lfs or generated with genPlatform.gradle.
//    - This file includes the full runtime environment for VSCode plugins (e.g., node_modules, platform.txt).
//    - The zip is extracted to build/platform/, and its node_modules take precedence over other dependencies.
//    - Copies compiled host outputs (dist, package.json, node_modules) and plugin resources.
//    - The result is a fully self-contained package ready for deployment across platforms.
//
// 3. "none" (default) — Lightweight mode (used for testing and CI)
//    - Does not rely on platform.zip or prepare VSCode runtime resources.
//    - Only copies the plugin's core assets such as themes.
//    - Useful for early-stage development, static analysis, unit tests, and continuous integration pipelines.
//
// How to configure:
//   - Set via gradle argument: -PdebugMode=idea / release / none
//     Example: ./gradlew prepareSandbox -PdebugMode=idea
//   - Defaults to "none" if not explicitly set.
// ------------------------------------------------------------
ext {
    set("debugMode", project.findProperty("debugMode") ?: "none")
    set("debugResource", project.projectDir.resolve("../resources").absolutePath)
    set("vscodePlugin", project.findProperty("vscodePlugin") ?: "kilocode")
}

project.afterEvaluate {
    tasks.findByName(":prepareSandbox")?.inputs?.properties?.put("build_mode", ext.get("debugMode"))
}

fun Sync.prepareSandbox() {
    // Set duplicate strategy to include files, with later sources taking precedence
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
    
    if (ext.get("debugMode") == "idea") {
        from("${project.projectDir.absolutePath}/src/main/resources/themes/") {
            into("${ext.get("debugResource")}/${ext.get("vscodePlugin")}/integrations/theme/default-themes/")
        }
        doLast {
            val vscodePluginDir = File("${ext.get("debugResource")}/${ext.get("vscodePlugin")}")
            vscodePluginDir.mkdirs()
            File(vscodePluginDir, ".env").createNewFile()
        }
    } else {
        val vscodePluginDir = File("./plugins/${ext.get("vscodePlugin")}")
        if (!vscodePluginDir.exists()) {
            throw IllegalStateException("missing plugin dir")
        }
        val list = mutableListOf<String>()
        val depfile = File("prodDep.txt")
        if (!depfile.exists()) {
            throw IllegalStateException("missing prodDep.txt")
        }
        depfile.readLines().let {
            it.forEach { line ->
                list.add(line.substringAfterLast("node_modules/") + "/**")
            }
        }

        from("../host/dist") { into("${intellij.pluginName.get()}/runtime/") }
        from("../host/package.json") { into("${intellij.pluginName.get()}/runtime/") }
        
        // First copy host node_modules
        from("../resources/node_modules") {
            into("${intellij.pluginName.get()}/node_modules/")
            list.forEach {
                include(it)
            }
        }

        from("${vscodePluginDir.path}/extension") { into("${intellij.pluginName.get()}/${ext.get("vscodePlugin")}") }
        from("src/main/resources/themes/") { into("${intellij.pluginName.get()}/${ext.get("vscodePlugin")}/integrations/theme/default-themes/") }
        
        // The platform.zip file required for release mode is associated with the code in ../base/vscode, currently using version 1.100.0. If upgrading this code later
        // Need to modify the vscodeVersion value in gradle.properties, then execute the task named genPlatform, which will generate a new platform.zip file for submission
        // To support new architectures, modify according to the logic in genPlatform.gradle script
        if (ext.get("debugMode") == "release") {
            // Check if platform.zip file exists and is larger than 1MB, otherwise throw exception
            val platformZip = File("platform.zip")
            if (platformZip.exists() && platformZip.length() >= 1024 * 1024) {
                // Extract platform.zip to the platform subdirectory under the project build directory
                val platformDir = File("${layout.buildDirectory.get().asFile}/platform")
                platformDir.mkdirs()
                copy {
                    from(zipTree(platformZip))
                    into(platformDir)
                }
            } else {
                throw IllegalStateException("platform.zip file does not exist or is smaller than 1MB. This file is supported through git lfs and needs to be obtained through git lfs")
            }

            from(File(layout.buildDirectory.get().asFile, "platform/platform.txt")) { into("${intellij.pluginName.get()}/") }
            // Copy platform node_modules last to ensure it takes precedence over host node_modules
            from(File(layout.buildDirectory.get().asFile, "platform/node_modules")) { into("${intellij.pluginName.get()}/node_modules") }
        }

        doLast {
            File("${destinationDir}/${intellij.pluginName.get()}/${ext.get("vscodePlugin")}/.env").createNewFile()
        }
    }
}

group = properties("pluginGroup").get()
version = properties("pluginVersion").get()

repositories {
    mavenCentral()
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.10.0")
    implementation("com.google.code.gson:gson:2.10.1")
    testImplementation("junit:junit:4.13.2")
}

// Configure Java toolchain to force Java 17
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

// Configure Gradle IntelliJ Plugin
// Read more: https://plugins.jetbrains.com/docs/intellij/tools-gradle-intellij-plugin.html
intellij {
    version = properties("platformVersion")
    type = properties("platformType")

    plugins.set(
        listOf(
            "com.intellij.java",
            // Add JCEF support
            "org.jetbrains.plugins.terminal"
        )
    )
}

tasks {

    // Create task for generating configuration files
    register("generateConfigProperties") {
        description = "Generate properties file containing plugin configuration"
        doLast {
            val configDir = File("$projectDir/src/main/resources/ai/kilocode/jetbrains/plugin/config")
            configDir.mkdirs()

            val configFile = File(configDir, "plugin.properties")
            configFile.writeText("debug.mode=${ext.get("debugMode")}")
            configFile.appendText("\n")
            configFile.appendText("debug.resource=${ext.get("debugResource")}")
            println("Configuration file generated: ${configFile.absolutePath}")
        }
    }

    prepareSandbox {
        prepareSandbox()
    }

    // Generate configuration file before compilation
    withType<JavaCompile> {
        dependsOn("generateConfigProperties")
    }

    // Set the JVM compatibility versions
    withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
        dependsOn("generateConfigProperties")
        kotlinOptions {
            jvmTarget = "17"
        }
    }

    withType<JavaCompile> {
        sourceCompatibility = "17"
        targetCompatibility = "17"
    }

    // Add task to generate plugin.xml from template
    register<Exec>("updatePluginXml") {
        description = "Update plugin.xml from template with change notes"
        group = "build"
        
        workingDir = projectDir
        commandLine("node", "scripts/update_change_notes.js")
        
        inputs.files("src/main/resources/META-INF/plugin.xml.template", "gradle.properties", "../../../CHANGELOG.md")
        outputs.file("src/main/resources/META-INF/plugin.xml")
    }

    patchPluginXml {
        version.set(properties("pluginVersion"))
        sinceBuild.set(properties("pluginSinceBuild"))
        untilBuild.set("")
        dependsOn("updatePluginXml")
    }

    signPlugin {
        certificateChain.set(System.getenv("CERTIFICATE_CHAIN"))
        privateKey.set(System.getenv("PRIVATE_KEY"))
        password.set(System.getenv("PRIVATE_KEY_PASSWORD"))
    }

    publishPlugin {
        token.set(System.getenv("PUBLISH_TOKEN"))
    }

    // Convert the extension's JSON translation files to JetBrains ResourceBundle .properties format
    register("convertTranslations") {
        description = "Convert JSON translation files to the native ResourceBundle .properties format"
        
        val sourceDir = file("../../src/i18n/locales")
        val targetDir = file("src/main/resources/messages")
        
        inputs.dir(sourceDir)
        outputs.dir(targetDir)
        
        doLast {
            if (!sourceDir.exists()) {
                throw IllegalStateException("Source translation directory not found: ${sourceDir.absolutePath}")
            }
            
            targetDir.mkdirs()
            
            // Find all JSON bundles (jetbrains.json, kilocode.json, etc.)
            val jsonBundles = mutableSetOf<String>()
            sourceDir.listFiles()?.forEach { localeDir ->
                if (localeDir.isDirectory) {
                    localeDir.listFiles { file -> file.extension == "json" }?.forEach { jsonFile ->
                        jsonBundles.add(jsonFile.nameWithoutExtension)
                    }
                }
            }
            println("Found translation bundles: ${jsonBundles.joinToString(", ")}")
            
            jsonBundles.forEach { bundleName ->
                convertBundleToProperties(sourceDir, targetDir, bundleName)
            }
            println("Converted ${jsonBundles.size} translation bundles to ResourceBundle .properties format")
        }
    }

    named("processResources") {
        dependsOn("convertTranslations")
    }

}

// Helper function to convert JSON bundle to .properties files
fun convertBundleToProperties(sourceDir: File, targetDir: File, bundleName: String) {
    val gson = com.google.gson.Gson()
    
    sourceDir.listFiles()?.forEach { localeDir ->
        if (localeDir.isDirectory) {
            val jsonFile = File(localeDir, "$bundleName.json")
            if (jsonFile.exists()) {
                try {
                    val locale = localeDir.name
                    val capitalizedBundleName = bundleName.replaceFirstChar { it.uppercase() }
                    
                    // Determine properties file name
                    val propertiesFileName = if (locale == "en") {
                        "${capitalizedBundleName}Bundle.properties"
                    } else {
                        "${capitalizedBundleName}Bundle_${locale.replace("-", "_")}.properties"
                    }
                    
                    val propertiesFile = File(targetDir, propertiesFileName)
                    
                    // Parse JSON
                    val jsonContent = jsonFile.readText()
                    val jsonObject = gson.fromJson(jsonContent, com.google.gson.JsonObject::class.java)
                    
                    // Convert to flat properties
                    val properties = mutableMapOf<String, String>()
                    flattenJsonObject(jsonObject, "", properties)
                    
                    // Write properties file
                    propertiesFile.writeText("# Auto-generated from $bundleName.json - do not edit directly\n")
                    properties.toSortedMap().forEach { (key, value) ->
                        // Keep named parameters as {{paramName}} for Kotlin named substitution
                        val escapedValue = value
                            .replace("\\", "\\\\")
                            .replace("\n", "\\n")
                            .replace("\r", "\\r")
                            .replace("\t", "\\t")
                            .replace("=", "\\=")
                            .replace(":", "\\:")
                            .replace("#", "\\#")
                            .replace("!", "\\!")
                        
                        propertiesFile.appendText("$key=$escapedValue\n")
                    }
                    
                    println("  → $locale: ${properties.size} keys → $propertiesFileName")
                    
                } catch (e: Exception) {
                    throw RuntimeException("Failed to convert $jsonFile", e)
                }
            }
        }
    }
}

// Helper function to flatten nested JSON objects into dot-notation keys
fun flattenJsonObject(jsonObject: com.google.gson.JsonObject, prefix: String, properties: MutableMap<String, String>) {
    for (entry in jsonObject.entrySet()) {
        val key = entry.key
        val element = entry.value
        val fullKey = if (prefix.isEmpty()) key else "$prefix.$key"
        
        when {
            element.isJsonObject -> {
                flattenJsonObject(element.asJsonObject, fullKey, properties)
            }
            element.isJsonPrimitive -> {
                properties[fullKey] = element.asString
            }
            else -> {
                // Skip arrays and other complex types for now
                println("  Warning: Skipping complex type for key: $fullKey")
            }
        }
    }
}

// Configure ktlint
ktlint {
    version.set("0.50.0")
    debug.set(false)
    verbose.set(true)
    android.set(false)
    outputToConsole.set(true)
    outputColorName.set("RED")
    ignoreFailures.set(true)
    enableExperimentalRules.set(false)
    filter {
        exclude("**/generated/**")
        include("**/kotlin/**")
    }
}

