// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import java.net.URI

/**
 * Main thread search service interface.
 * Corresponds to the MainThreadSearchShape interface in VSCode.
 */
interface MainThreadSearchShape : Disposable {
    /**
     * Registers file search provider.
     * @param handle Provider ID
     * @param scheme Scheme
     */
    fun registerFileSearchProvider(handle: Int, scheme: String)

    /**
     * Registers AI text search provider.
     * @param handle Provider ID
     * @param scheme Scheme
     */
    fun registerAITextSearchProvider(handle: Int, scheme: String)

    /**
     * Registers text search provider.
     * @param handle Provider ID
     * @param scheme Scheme
     */
    fun registerTextSearchProvider(handle: Int, scheme: String)

    /**
     * Unregisters provider.
     * @param handle Provider ID
     */
    fun unregisterProvider(handle: Int)

    /**
     * Handles file match.
     * @param handle Provider ID
     * @param session Session ID
     * @param data List of URI components
     */
    fun handleFileMatch(handle: Int, session: Int, data: List<Map<String, Any?>>)

    /**
     * Handles text match.
     * @param handle Provider ID
     * @param session Session ID
     * @param data Raw file match data
     */
    fun handleTextMatch(handle: Int, session: Int, data: List<Map<String, Any?>>)

    /**
     * Handles telemetry data.
     * @param eventName Event name
     * @param data Telemetry data
     */
    fun handleTelemetry(eventName: String, data: Any?)
}

/**
 * Implementation of the main thread search service.
 * Provides search-related functionality for the IDEA platform.
 */
class MainThreadSearch : MainThreadSearchShape {
    private val logger = Logger.getInstance(MainThreadSearch::class.java)
    private val searchProviders = mutableMapOf<Int, String>()
    private val fileSessions = mutableMapOf<Int, MutableList<URI>>()
    private val textSessions = mutableMapOf<Int, MutableList<Map<String, Any?>>>()

    override fun registerFileSearchProvider(handle: Int, scheme: String) {
        try {
            logger.info("Registering file search provider: handle=$handle, scheme=$scheme")
            searchProviders[handle] = "file:$scheme"
        } catch (e: Exception) {
            logger.error("Failed to register file search provider", e)
        }
    }

    override fun registerAITextSearchProvider(handle: Int, scheme: String) {
        try {
            logger.info("Registering AI text search provider: handle=$handle, scheme=$scheme")
            searchProviders[handle] = "aitext:$scheme"
        } catch (e: Exception) {
            logger.error("Failed to register AI text search provider", e)
        }
    }

    override fun registerTextSearchProvider(handle: Int, scheme: String) {
        try {
            logger.info("Registering text search provider: handle=$handle, scheme=$scheme")
            searchProviders[handle] = "text:$scheme"
        } catch (e: Exception) {
            logger.error("Failed to register text search provider", e)
        }
    }

    override fun unregisterProvider(handle: Int) {
        try {
            logger.info("Unregistering provider: handle=$handle")
            searchProviders.remove(handle)
        } catch (e: Exception) {
            logger.error("Failed to unregister search provider", e)
        }
    }

    override fun handleFileMatch(handle: Int, session: Int, data: List<Map<String, Any?>>) {
        try {
            logger.info("Handling file match: handle=$handle, session=$session, matches=${data.size}")

            // Convert URI components to URI
            val uris = data.mapNotNull { uriComponents ->
                try {
                    val scheme = uriComponents["scheme"] as? String ?: return@mapNotNull null
                    val authority = uriComponents["authority"] as? String ?: ""
                    val path = uriComponents["path"] as? String ?: return@mapNotNull null
                    val query = uriComponents["query"] as? String ?: ""
                    val fragment = uriComponents["fragment"] as? String ?: ""

                    URI(scheme, authority, path, query, fragment)
                } catch (e: Exception) {
                    logger.warn("Failed to convert URI components: $uriComponents", e)
                    null
                }
            }

            // Store match results
            fileSessions.getOrPut(session) { mutableListOf() }.addAll(uris)

            // TODO: Actual implementation should display these results in IDEA's search results panel
        } catch (e: Exception) {
            logger.error("Failed to handle file match", e)
        }
    }

    override fun handleTextMatch(handle: Int, session: Int, data: List<Map<String, Any?>>) {
        try {
            logger.info("Handling text match: handle=$handle, session=$session, matches=${data.size}")

            // Store match results
            textSessions.getOrPut(session) { mutableListOf() }.addAll(data)

            // TODO: Actual implementation should display these results in IDEA's search results panel, including highlighting matched text
        } catch (e: Exception) {
            logger.error("Failed to handle text match", e)
        }
    }

    override fun handleTelemetry(eventName: String, data: Any?) {
        try {
            logger.info("Handling telemetry: event=$eventName, data=$data")
        } catch (e: Exception) {
            logger.error("Failed to handle telemetry data", e)
        }
    }

    override fun dispose() {
        logger.info("Disposing MainThreadSearch")
        searchProviders.clear()
        fileSessions.clear()
        textSessions.clear()
    }
}
