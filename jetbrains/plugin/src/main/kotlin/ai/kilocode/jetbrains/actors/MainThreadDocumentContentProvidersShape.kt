// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.CompletableDeferred

/**
 * Interfaces related to document content providers.
 */
interface MainThreadDocumentContentProvidersShape : Disposable {
    /**
     * Registers a text content provider.
     * @param handle Provider handle
     * @param scheme URI scheme
     */
    fun registerTextContentProvider(handle: Int, scheme: String)

    /**
     * Unregisters a text content provider.
     * @param handle Provider handle
     */
    fun unregisterTextContentProvider(handle: Int)

    /**
     * Virtual document content change.
     * @param uri Document URI
     * @param value New content
     * @return Execution result
     */
    suspend fun onVirtualDocumentChange(uri: Map<String, Any?>, value: String): Any
}

class MainThreadDocumentContentProviders : MainThreadDocumentContentProvidersShape {
    private val logger = Logger.getInstance(MainThreadDocumentContentProviders::class.java)

    override fun registerTextContentProvider(handle: Int, scheme: String) {
        logger.info("Register text content provider: handle=$handle, scheme=$scheme")
    }

    override fun unregisterTextContentProvider(handle: Int) {
        logger.info("Unregister text content provider: handle=$handle")
    }

    override suspend fun onVirtualDocumentChange(uri: Map<String, Any?>, value: String): Any {
        logger.info("Virtual document content changed: uri=$uri")
        return CompletableDeferred<Unit>().also { it.complete(Unit) }.await()
    }

    override fun dispose() {
        logger.info("Disposing MainThreadDocumentContentProviders resources")
    }
}
