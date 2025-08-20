// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package com.sina.weibo.agent.actors

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger

/**
 * Remote console log.
 * Corresponds to the IRemoteConsoleLog interface in TypeScript.
 */
data class RemoteConsoleLog(
    val type: String,        // Log type: "log", "warn", "error", "info", "debug"
    val severity: Int,       // Severity level
    val args: List<Any?>,    // Log arguments
    val source: String? = null, // Log source
    val line: Int? = null,      // Source line number
    val columnNumber: Int? = null, // Column number
    val timestamp: Long = System.currentTimeMillis() // Timestamp
)

/**
 * Main thread console service interface.
 * Corresponds to the MainThreadConsoleShape interface in VSCode.
 */
interface MainThreadConsoleShape : Disposable {
    /**
     * Logs extension host message.
     * @param msg Log message object
     */
    fun logExtensionHostMessage(msg: Map<String, Any>)
    
    /**
     * Releases resources.
     */
    override fun dispose()
}

class MainThreadConsole : MainThreadConsoleShape {
    private val logger = Logger.getInstance(MainThreadConsole::class.java)

    /**
     * Logs extension host message.
     * @param msg Log message object
     */
    override fun logExtensionHostMessage(msg: Map<String, Any>) {
        val type = msg["type"]
        val severity = msg["severity"]
        val arguments = msg["arguments"]?.let { args ->
            if (args is List<*>) {
                args.joinToString(", ") { it.toString() }
            } else {
                args.toString()
            }
        } ?: return

        try {
            when (severity) {
//                "log", "info" -> logger.info("[Extension Host] $arguments")
                "warn" -> logger.warn("[Extension Host] $arguments")
                "error" -> logger.warn("[Extension Host] ERROR: $arguments")
//                "debug" -> logger.debug("[Extension Host] $arguments")
//                else -> logger.info("[Extension Host] $arguments")
            }
        } catch (e: Exception) {
            logger.error("Failed to process extension host log message", e)
        }
    }

    /**
     * Releases resources.
     */
    override fun dispose() {
        logger.info("Disposing MainThreadConsole")
    }
}