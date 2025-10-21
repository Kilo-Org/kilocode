// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger

/**
 * File system event service interface.
 * Provides functionality for watching file system changes.
 * Corresponds to the MainThreadFileSystemEventServiceShape interface in VSCode.
 */
interface MainThreadFileSystemEventServiceShape : Disposable {
    /**
     * Watches for file system changes.
     *
     * @param extensionId The extension identifier
     * @param session The session identifier
     * @param resource The resource URI as a map
     * @param opts Watch options
     * @param correlate Whether to correlate events
     */
    fun watch(
        extensionId: String,
        session: Int,
        resource: Map<String, Any?>,
        opts: Map<String, Any?>,
        correlate: Boolean,
    )

    /**
     * Stops watching for file system changes.
     *
     * @param session The session identifier to stop watching
     */
    fun unwatch(session: Int)
}

/**
 * Implementation of the file system event service interface.
 * Handles watching and unwatching file system changes.
 */
class MainThreadFileSystemEventService : MainThreadFileSystemEventServiceShape {
    private val logger = Logger.getInstance(MainThreadFileSystemEventService::class.java)

    /**
     * Starts watching for file system changes.
     *
     * @param extensionId The extension identifier
     * @param session The session identifier
     * @param resource The resource URI as a map
     * @param opts Watch options
     * @param correlate Whether to correlate events
     */
    override fun watch(
        extensionId: String,
        session: Int,
        resource: Map<String, Any?>,
        opts: Map<String, Any?>,
        correlate: Boolean,
    ) {
        logger.info("Starting to watch file system changes: extensionId=$extensionId, session=$session, resource=$resource, opts=$opts, correlate=$correlate")
    }

    /**
     * Stops watching for file system changes.
     *
     * @param session The session identifier to stop watching
     */
    override fun unwatch(session: Int) {
        logger.info("Stopping file system watch: session=$session")
    }

    /**
     * Releases resources used by this service.
     */
    override fun dispose() {
        logger.info("Releasing MainThreadFileSystemEventService resources")
    }
}
