// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger

/**
 * Main thread output service interface.
 * Corresponds to the MainThreadOutputServiceShape interface in VSCode.
 */
interface MainThreadOutputServiceShape : Disposable {
    /**
     * Registers output channel.
     * @param label Label
     * @param file File URI components
     * @param languageId Language ID
     * @param extensionId Extension ID
     * @return Channel ID
     */
    suspend fun register(label: String, file: Map<String, Any>, languageId: String?, extensionId: String): String

    /**
     * Updates output channel.
     * @param channelId Channel ID
     * @param mode Update mode
     * @param till Update to specified position
     */
    suspend fun update(channelId: String, mode: Int, till: Int? = null)

    /**
     * Reveals output channel.
     * @param channelId Channel ID
     * @param preserveFocus Whether to preserve focus
     */
    suspend fun reveal(channelId: String, preserveFocus: Boolean)

    /**
     * Closes output channel.
     * @param channelId Channel ID
     */
    suspend fun close(channelId: String)

    /**
     * Disposes output channel.
     * @param channelId Channel ID
     */
    suspend fun dispose(channelId: String)
}

/**
 * Implementation of the main thread output service.
 */
class MainThreadOutputService : MainThreadOutputServiceShape {
    private val logger = Logger.getInstance(MainThreadOutputService::class.java)

    /**
     * Registers output channel.
     * @param label Label
     * @param file File URI components
     * @param languageId Language ID
     * @param extensionId Extension ID
     * @return Channel ID
     */
    override suspend fun register(label: String, file: Map<String, Any>, languageId: String?, extensionId: String): String {
        logger.info("Register output channel: label=$label, file=$file, extensionId=$extensionId")
        return label // Use label as channel ID
    }

    /**
     * Updates output channel.
     * @param channelId Channel ID
     * @param mode Update mode
     * @param till Update to specified position
     */
    override suspend fun update(channelId: String, mode: Int, till: Int?) {
        logger.info("Update output channel: channelId=$channelId, mode=$mode, till=$till")
    }

    /**
     * Reveals output channel.
     * @param channelId Channel ID
     * @param preserveFocus Whether to preserve focus
     */
    override suspend fun reveal(channelId: String, preserveFocus: Boolean) {
        logger.info("Reveal output channel: channelId=$channelId, preserveFocus=$preserveFocus")
    }

    /**
     * Closes output channel.
     * @param channelId Channel ID
     */
    override suspend fun close(channelId: String) {
        logger.info("Close output channel: channelId=$channelId")
    }

    /**
     * Disposes output channel.
     * @param channelId Channel ID
     */
    override suspend fun dispose(channelId: String) {
        logger.info("Disposing output channel: channelId=$channelId")
    }

    /**
     * Dispose all resources
     */
    override fun dispose() {
        logger.info("Disposing all output channel resources")
    }
}
