// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger

/**
 * Main thread error handling interface.
 * Corresponds to the MainThreadErrorsShape interface in VSCode.
 */
interface MainThreadErrorsShape : Disposable {
    /**
     * Handles unexpected errors.
     * @param err Error information
     */
    fun onUnexpectedError(err: Any?)

    /**
     * Releases resources.
     */
    override fun dispose()
}

class MainThreadErrors : MainThreadErrorsShape {
    private val logger = Logger.getInstance(MainThreadErrors::class.java)

    /**
     * Handles unexpected errors.
     * @param err Error information
     */
    override fun onUnexpectedError(err: Any?) {
        logger.warn("Unexpected error occurred in plugin: $err")
    }

    /**
     * Releases resources.
     */
    override fun dispose() {
        logger.info("Dispose MainThreadErrors")
    }
}
