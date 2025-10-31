// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.CompletableDeferred

/**
 * URL handling related interface
 */
interface MainThreadUrlsShape : Disposable {
    /**
     * Register URI handler
     * @param handle Handler identifier
     * @param extensionId Extension ID
     * @param extensionDisplayName Extension display name
     * @return Execution result
     */
    suspend fun registerUriHandler(handle: Int, extensionId: Map<String, String>, extensionDisplayName: String): Any

    /**
     * Unregister URI handler
     * @param handle Handler identifier
     * @return Execution result
     */
    suspend fun unregisterUriHandler(handle: Int): Any

    /**
     * Create application URI
     * @param uri URI components
     * @return Created URI components
     */
    suspend fun createAppUri(uri: Map<String, Any?>): Map<String, Any?>
}

class MainThreadUrls : MainThreadUrlsShape {
    private val logger = Logger.getInstance(MainThreadUrls::class.java)

    override suspend fun registerUriHandler(handle: Int, extensionId: Map<String, String>, extensionDisplayName: String): Any {
        logger.info("Registering URI handler: handle=$handle, extensionId=$extensionId, displayName=$extensionDisplayName")
        return CompletableDeferred<Unit>().also { it.complete(Unit) }.await()
    }

    override suspend fun unregisterUriHandler(handle: Int): Any {
        logger.info("Unregistering URI handler: handle=$handle")
        return CompletableDeferred<Unit>().also { it.complete(Unit) }.await()
    }

    override suspend fun createAppUri(uri: Map<String, Any?>): Map<String, Any?> {
        logger.info("Creating application URI: uri=$uri")
        // Simply return original URI
        return uri
    }

    override fun dispose() {
        logger.info("Disposing MainThreadUrls resources")
    }
}
