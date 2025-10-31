// Copyright 2009-2025 Weibo, Inc.
// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.core

import ai.kilocode.jetbrains.ipc.proxy.IRPCProtocol
import ai.kilocode.jetbrains.util.URI
import ai.kilocode.jetbrains.util.toCompletableFuture
import com.google.gson.Gson
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import java.io.File
import java.nio.file.Paths
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap

/**
 * Extension manager
 * Responsible for managing extension registration and activation
 */
class ExtensionManager : Disposable {
    companion object {
        val LOG = Logger.getInstance(ExtensionManager::class.java)
    }

    // Registered extensions
    private val extensions = ConcurrentHashMap<String, ExtensionDescription>()

    // Gson instance
    private val gson = Gson()

    /**
     * Parse extension description information
     * @param extensionPath Extension path
     * @return Extension description object
     */
    private fun parseExtensionDescription(extensionPath: String): ExtensionDescription {
        LOG.info("Parsing extension: $extensionPath")

        // Read package.json file
        val packageJsonPath = Paths.get(extensionPath, "package.json").toString()
        val packageJsonContent = File(packageJsonPath).readText()
        val packageJson = gson.fromJson(packageJsonContent, PackageJson::class.java)

        // Create extension identifier
        val name = packageJson.name
        val publisher = "Kilo Code"
        val extensionIdentifier = ExtensionIdentifier("$publisher.$name")

        // Create extension description
        return ExtensionDescription(
            id = "$publisher.$name",
            identifier = extensionIdentifier,
            name = "$publisher.$name",
            displayName = packageJson.displayName,
            description = packageJson.description,
            version = packageJson.version ?: "1.0.0",
            publisher = "Kilo Code",
            main = packageJson.main ?: "./dist/extension.js",
            activationEvents = packageJson.activationEvents ?: listOf("onStartupFinished"),
            extensionLocation = URI.file(extensionPath),
            targetPlatform = "universal", // TargetPlatform.UNIVERSAL
            isBuiltin = false,
            isUserBuiltin = false,
            isUnderDevelopment = false,
            engines = packageJson.engines?.let {
                mapOf("vscode" to (it.vscode ?: "^1.0.0"))
            } ?: mapOf("vscode" to "^1.0.0"),
            preRelease = false,
            capabilities = mapOf(),
            extensionDependencies = packageJson.extensionDependencies ?: emptyList(),
        )
    }

    /**
     * Get all parsed extension descriptions
     * @return Extension description array
     */
    fun getAllExtensionDescriptions(): List<ExtensionDescription> {
        return extensions.values.toList()
    }

    /**
     * Get description information for the specified extension
     * @param extensionId Extension ID
     * @return Extension description object, or null if not found
     */
    fun getExtensionDescription(extensionId: String): ExtensionDescription? {
        return extensions[extensionId]
    }

    /**
     * Register extension
     * @param extensionPath Extension path
     * @return Extension description object
     */
    fun registerExtension(extensionPath: String): ExtensionDescription {
        val extensionDescription = parseExtensionDescription(extensionPath)
        extensions[extensionDescription.name] = extensionDescription
        LOG.info("Extension registered: ${extensionDescription.name}")
        return extensionDescription
    }

    /**
     * Activate extension
     * @param extensionId Extension ID
     * @param rpcProtocol RPC protocol
     * @return Completion Future
     */
    fun activateExtension(extensionId: String, rpcProtocol: IRPCProtocol): CompletableFuture<Boolean> {
        LOG.info("Activating extension: $extensionId")

        try {
            // Get extension description
            val extension = extensions[extensionId]
            if (extension == null) {
                LOG.error("Extension not found: $extensionId")
                val future = CompletableFuture<Boolean>()
                future.completeExceptionally(IllegalArgumentException("Extension not found: $extensionId"))
                return future
            }

            // Create activation parameters
            val activationParams = mapOf(
                "startup" to true,
                "extensionId" to extension.identifier,
                "activationEvent" to "api",
            )

            // Get proxy of ExtHostExtensionServiceShape type
            val extHostService = rpcProtocol.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostExtensionService)

            try {
                // Get LazyPromise instance and convert it to CompletableFuture<Boolean>
                val lazyPromise = extHostService.activate(extension.identifier.value, activationParams)

                return lazyPromise.toCompletableFuture<Any?>().thenApply { result ->
                    val boolResult = when (result) {
                        is Boolean -> result
                        else -> false
                    }
                    LOG.info("Extension activation ${if (boolResult) "successful" else "failed"}: $extensionId")
                    boolResult
                }.exceptionally { throwable ->
                    LOG.error("Failed to activate extension: $extensionId", throwable)
                    false
                }
            } catch (e: Exception) {
                LOG.error("Failed to call activate method: $extensionId", e)
                val future = CompletableFuture<Boolean>()
                future.completeExceptionally(e)
                return future
            }
        } catch (e: Exception) {
            LOG.error("Failed to activate extension: $extensionId", e)
            val future = CompletableFuture<Boolean>()
            future.completeExceptionally(e)
            return future
        }
    }

    /**
     * Release resources
     */
    override fun dispose() {
        LOG.info("Releasing ExtensionManager resources")
        extensions.clear()
    }
}

/**
 * package.json data class
 * Used for Gson parsing of extension's package.json file
 */
data class PackageJson(
    val name: String,
    val displayName: String? = null,
    val description: String? = null,
    val publisher: String? = null,
    val version: String? = null,
    val engines: Engines? = null,
    val activationEvents: List<String>? = null,
    val main: String? = null,
    val extensionDependencies: List<String>? = null,
)

/**
 * Engines data class
 * Used for parsing engines field
 */
data class Engines(
    val vscode: String? = null,
    val node: String? = null,
)

/**
 * Extension description
 * Corresponds to IExtensionDescription in VSCode
 */
data class ExtensionDescription(
    val id: String? = null,
    val identifier: ExtensionIdentifier,
    val name: String,
    val displayName: String? = null,
    val description: String? = null,
    val version: String,
    val publisher: String,
    val main: String? = null,
    val activationEvents: List<String>? = null,
    val extensionLocation: URI,
    val targetPlatform: String = "universal",
    val isBuiltin: Boolean = false,
    val isUserBuiltin: Boolean = false,
    val isUnderDevelopment: Boolean = false,
    val engines: Map<String, String>,
    val preRelease: Boolean = false,
    val capabilities: Map<String, Any> = emptyMap(),
    val extensionDependencies: List<String> = emptyList(),
)

/**
 * Convert ExtensionDescription to Map<String, Any?>
 * @return Map containing all properties of ExtensionDescription, where identifier is converted to sid string
 */
fun ExtensionDescription.toMap(): Map<String, Any?> {
    return mapOf(
        "identifier" to this.identifier.value,
        "name" to this.name,
        "displayName" to this.displayName,
        "description" to this.description,
        "version" to this.version,
        "publisher" to this.publisher,
        "main" to this.main,
        "activationEvents" to this.activationEvents,
        "extensionLocation" to this.extensionLocation,
        "targetPlatform" to this.targetPlatform,
        "isBuiltin" to this.isBuiltin,
        "isUserBuiltin" to this.isUserBuiltin,
        "isUnderDevelopment" to this.isUnderDevelopment,
        "engines" to this.engines,
        "preRelease" to this.preRelease,
        "capabilities" to this.capabilities,
        "extensionDependencies" to this.extensionDependencies,
    )
}
