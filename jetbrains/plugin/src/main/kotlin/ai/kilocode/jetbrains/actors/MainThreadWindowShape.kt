// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import com.intellij.ide.BrowserUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.WindowManager
import java.net.URI

/**
 * Main thread window service interface
 * Corresponds to MainThreadWindowShape interface in VSCode
 */
interface MainThreadWindowShape : Disposable {
    /**
     * Get initial state
     * @return Initial window state including focus and active status
     */
    fun getInitialState(): Map<String, Boolean>

    /**
     * Open URI
     * @param uri URI component
     * @param uriString URI string
     * @param options Open options
     * @return Whether successfully opened
     */
    fun openUri(uri: Map<String, Any?>, uriString: String?, options: Map<String, Any?>): Boolean

    /**
     * Convert to external URI
     * @param uri URI component
     * @param options Open options
     * @return External URI component
     */
    fun asExternalUri(uri: Map<String, Any?>, options: Map<String, Any?>): Map<String, Any?>
}

/**
 * Main thread window service implementation
 * Provides IDEA platform window related functionality
 */
class MainThreadWindow(val project: Project) : MainThreadWindowShape {
    private val logger = Logger.getInstance(MainThreadWindow::class.java)

    override fun getInitialState(): Map<String, Boolean> {
        try {
            logger.info("Getting window initial state")

            // Get current project window state
            val frame = WindowManager.getInstance().getFrame(project)
            val isFocused = frame?.isFocused ?: false
            val isActive = frame?.isActive ?: false

            return mapOf(
                "isFocused" to isFocused,
                "isActive" to isActive,
            )
        } catch (e: Exception) {
            logger.error("Failed to get window initial state", e)
            return mapOf(
                "isFocused" to false,
                "isActive" to false,
            )
        }
    }

    override fun openUri(uri: Map<String, Any?>, uriString: String?, options: Map<String, Any?>): Boolean {
        try {
            logger.info("Opening URI: $uriString")

            // Try to get URI string
            val urlToOpen = if (uriString != null) {
                uriString
            } else {
                // Build from URI components
                val actualUri = createUriFromComponents(uri)
                actualUri?.toString()
            }

            return if (urlToOpen != null) {
                // Use IntelliJ's BrowserUtil which works reliably in JetBrains IDEs
                BrowserUtil.browse(urlToOpen)
                logger.info("Successfully opened URI in browser: $urlToOpen")
                true
            } else {
                logger.warn("Cannot create valid URI from components: $uri")
                false
            }
        } catch (e: Exception) {
            logger.error("Failed to open URI", e)
            return false
        }
    }

    override fun asExternalUri(uri: Map<String, Any?>, options: Map<String, Any?>): Map<String, Any?> {
        return try {
            logger.info("Converting to external URI: $uri")

            // For most cases, we directly return the same URI components
            // Actual implementation may need to handle specific protocol conversion
            uri
        } catch (e: Exception) {
            logger.error("Failed to convert to external URI", e)
            uri // Return original URI on error
        }
    }

    /**
     * Create URI from URI components
     * @param components URI components
     * @return Created URI or null
     */
    private fun createUriFromComponents(components: Map<String, Any?>): URI? {
        return try {
            val scheme = components["scheme"] as? String ?: return null
            val authority = components["authority"] as? String ?: ""
            val path = components["path"] as? String ?: ""
            val query = components["query"] as? String ?: ""
            val fragment = components["fragment"] as? String ?: ""

            URI(scheme, authority, path, query, fragment)
        } catch (e: Exception) {
            logger.warn("Failed to create URI from components: $components", e)
            null
        }
    }

    override fun dispose() {
        logger.info("Disposing MainThreadWindow")
    }
}
