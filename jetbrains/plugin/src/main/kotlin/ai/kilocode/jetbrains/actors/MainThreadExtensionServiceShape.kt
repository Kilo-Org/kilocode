// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import ai.kilocode.jetbrains.core.ExtensionManager
import ai.kilocode.jetbrains.ipc.proxy.IRPCProtocol
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import java.net.URI

/**
 * Main thread extension service interface.
 * Defines the contract for managing extensions in the main thread context.
 * This interface provides methods for extension lifecycle management,
 * activation, error handling, and utility operations.
 */
interface MainThreadExtensionServiceShape : Disposable {
    /**
     * Retrieves extension information by extension ID.
     * @param extensionId Extension identifier, typically provided as a Map with "value" key
     * @return Extension description object containing metadata about the extension,
     *         or null if the extension is not found
     */
    fun getExtension(extensionId: Any): Any?

    /**
     * Activates an extension with the specified ID and reason.
     * This method triggers the extension activation process and waits for completion.
     * @param extensionId Extension identifier to activate
     * @param reason Optional activation reason or context information
     * @return Boolean indicating whether the activation was successful (true) or failed (false)
     */
    fun activateExtension(extensionId: Any, reason: Any?): Any

    /**
     * Called immediately before an extension is about to be activated.
     * This provides a hook for pre-activation setup or logging.
     * @param extensionId Extension identifier that will be activated
     */
    fun onWillActivateExtension(extensionId: Any)

    /**
     * Called after an extension has been successfully activated.
     * Provides detailed timing information about the activation process.
     * @param extensionId Extension identifier that was activated
     * @param codeLoadingTime Time taken to load extension code (in milliseconds)
     * @param activateCallTime Time taken for the activation call (in milliseconds)
     * @param activateResolvedTime Time taken to resolve activation (in milliseconds)
     * @param activationReason Reason or context for the activation
     */
    fun onDidActivateExtension(
        extensionId: Any,
        codeLoadingTime: Double,
        activateCallTime: Double,
        activateResolvedTime: Double,
        activationReason: Any?,
    )

    /**
     * Handles extension activation errors.
     * Called when an extension fails to activate due to errors or missing dependencies.
     * @param extensionId Extension identifier that failed to activate
     * @param error Error information or exception details
     * @param missingExtensionDependency Information about missing dependencies, if applicable
     * @return Unit (void) - the method handles the error internally
     */
    fun onExtensionActivationError(
        extensionId: Any,
        error: Any?,
        missingExtensionDependency: Any?,
    ): Any

    /**
     * Handles runtime errors that occur during extension execution.
     * Called when an extension encounters errors after successful activation.
     * @param extensionId Extension identifier that encountered the runtime error
     * @param error Error information or exception details
     */
    fun onExtensionRuntimeError(extensionId: Any, error: Any?)

    /**
     * Sets performance marks for extension profiling and monitoring.
     * Used to track performance metrics across extension lifecycle events.
     * @param marks List of performance mark objects containing timing information
     * @return Unit (void) - the method processes the marks internally
     */
    fun setPerformanceMarks(marks: List<Any>)

    /**
     * Converts a standard URI to a browser-compatible URI format.
     * This method ensures URIs are properly formatted for web browser contexts.
     * @param uri The original URI to convert
     * @return Browser-compatible URI object
     */
    fun asBrowserUri(uri: URI): URI
}

/**
 * Main thread extension service implementation.
 * Provides concrete implementation for extension management in the main thread,
 * handling extension lifecycle events, activation, and error management.
 *
 * @param extensionManager Core extension manager responsible for extension operations
 * @param rpcProtocol RPC protocol for inter-process communication with extensions
 */
class MainThreadExtensionService(
    private val extensionManager: ExtensionManager,
    private val rpcProtocol: IRPCProtocol,
) : MainThreadExtensionServiceShape {
    private val logger = Logger.getInstance(MainThreadExtensionService::class.java)

    /**
     * Retrieves extension information by extension ID.
     * Safely extracts the extension ID from various input formats and queries the extension manager.
     *
     * @param extensionId Extension identifier, expected as Map with "value" key or any other type
     * @return Extension description object containing metadata, or null if not found
     */
    override fun getExtension(extensionId: Any): Any? {
        // Safely extract extension ID string from input parameter
        val extensionIdStr = try {
            (extensionId as? Map<*, *>)?.get("value") as? String
        } catch (e: Exception) {
            // Fallback to string representation if extraction fails
            "$extensionId"
        }
        logger.info("Retrieving extension: $extensionIdStr")
        return extensionManager.getExtensionDescription(extensionIdStr.toString())
    }

    /**
     * Activates an extension with the specified ID and reason.
     * Uses asynchronous activation via Future and waits for completion.
     *
     * @param extensionId Extension identifier to activate
     * @param reason Optional activation reason or context information
     * @return Boolean indicating activation success (true) or failure (false)
     */
    override fun activateExtension(extensionId: Any, reason: Any?): Any {
        // Safely extract extension ID string from input parameter
        val extensionIdStr = try {
            (extensionId as? Map<*, *>)?.get("value") as? String
        } catch (e: Exception) {
            // Fallback to string representation if extraction fails
            "$extensionId"
        }
        logger.info("Activating extension: $extensionIdStr, reason: $reason")

        // Use Future to get asynchronous activation result
        val future = extensionManager.activateExtension(extensionIdStr.toString(), rpcProtocol)

        return try {
            // Wait for Future completion and return result
            val result = future.get()
            logger.info("Extension $extensionIdStr activation ${if (result) "successful" else "failed"}")
            true
        } catch (e: Exception) {
            logger.error("Extension $extensionIdStr activation exception", e)
            false
        }
    }

    /**
     * Called immediately before extension activation begins.
     * Provides logging for pre-activation state tracking.
     *
     * @param extensionId Extension identifier about to be activated
     */
    override fun onWillActivateExtension(extensionId: Any) {
        // Safely extract extension ID string from input parameter
        val extensionIdStr = try {
            (extensionId as? Map<*, *>)?.get("value") as? String
        } catch (e: Exception) {
            // Fallback to string representation if extraction fails
            "$extensionId"
        }
        logger.info("Extension $extensionIdStr is about to be activated")
    }

    /**
     * Called after extension activation has completed successfully.
     * Logs activation completion with detailed timing information.
     *
     * @param extensionId Extension identifier that was activated
     * @param codeLoadingTime Time taken to load extension code (milliseconds)
     * @param activateCallTime Time taken for activation call (milliseconds)
     * @param activateResolvedTime Time taken to resolve activation (milliseconds)
     * @param activationReason Reason or context for activation
     */
    override fun onDidActivateExtension(
        extensionId: Any,
        codeLoadingTime: Double,
        activateCallTime: Double,
        activateResolvedTime: Double,
        activationReason: Any?,
    ) {
        // Safely extract extension ID string from input parameter
        val extensionIdStr = try {
            (extensionId as? Map<*, *>)?.get("value") as? String
        } catch (e: Exception) {
            // Fallback to string representation if extraction fails
            "$extensionId"
        }
        logger.info("Extension $extensionIdStr activated, reason: $activationReason")
    }

    /**
     * Handles extension activation errors with detailed logging.
     * Called when extension activation fails due to errors or missing dependencies.
     *
     * @param extensionId Extension identifier that failed activation
     * @param error Error information or exception details
     * @param missingExtensionDependency Information about missing dependencies
     * @return Unit (void) - error is handled through logging
     */
    override fun onExtensionActivationError(
        extensionId: Any,
        error: Any?,
        missingExtensionDependency: Any?,
    ): Any {
        // Safely extract extension ID string from input parameter
        val extensionIdStr = try {
            (extensionId as? Map<*, *>)?.get("value") as? String
        } catch (e: Exception) {
            // Fallback to string representation if extraction fails
            "$extensionId"
        }
        logger.error("Extension $extensionIdStr activation error: $error, missing dependency: $missingExtensionDependency")
        return Unit
    }

    /**
     * Handles runtime errors that occur during extension execution.
     * Called when an activated extension encounters runtime errors.
     *
     * @param extensionId Extension identifier that encountered the error
     * @param error Error information or exception details
     */
    override fun onExtensionRuntimeError(extensionId: Any, error: Any?) {
        // Safely extract extension ID string from input parameter
        val extensionIdStr = try {
            (extensionId as? Map<*, *>)?.get("value") as? String
        } catch (e: Exception) {
            // Fallback to string representation if extraction fails
            "$extensionId"
        }
        logger.warn("Extension $extensionIdStr runtime error: $error")
    }

    /**
     * Sets performance marks for extension profiling and monitoring.
     * Used to track performance metrics across extension operations.
     *
     * @param marks List of performance mark objects containing timing information
     */
    override fun setPerformanceMarks(marks: List<Any>) {
        logger.info("Setting performance marks: $marks")
    }

    /**
     * Converts a standard URI to browser-compatible format.
     * Ensures URIs are properly formatted for web browser contexts.
     *
     * @param uri The original URI to convert
     * @return Browser-compatible URI object (currently returns the original URI)
     */
    override fun asBrowserUri(uri: URI): URI {
        logger.info("Converting to browser URI: $uri")
        return uri
    }

    /**
     * Disposes of resources when the service is no longer needed.
     * Called during application shutdown or when the extension service is being replaced.
     */
    override fun dispose() {
        logger.info("Disposing MainThreadExtensionService")
    }
}
