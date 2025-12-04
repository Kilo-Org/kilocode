// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.logging

import ai.kilocode.jetbrains.plugin.DebugMode
import ai.kilocode.jetbrains.plugin.WecoderPluginService

/**
 * Log level enumeration matching console log severity levels
 */
enum class LogLevel(val value: Int) {
    DEBUG(0),
    LOG(1),
    INFO(2),
    WARN(3),
    ERROR(4),
    ;

    companion object {
        fun fromString(level: String): LogLevel {
            return when (level.lowercase()) {
                "debug" -> DEBUG
                "log" -> LOG
                "info" -> INFO
                "warn" -> WARN
                "error" -> ERROR
                else -> INFO
            }
        }
    }
}

/**
 * Configuration for dynamic log level filtering based on debug mode
 */
object LogLevelConfig {

    /**
     * Get the minimum log level that should be logged based on current debug mode
     * - DEBUG/ALL mode: Show all logs (DEBUG and above)
     * - Production mode: Show only warnings and errors (WARN and above)
     */
    fun getMinimumLogLevel(): LogLevel {
        return when (WecoderPluginService.getDebugMode()) {
            // Debug mode: show all log levels including debug, log, info
            DebugMode.ALL, DebugMode.IDEA -> {
                LogLevel.DEBUG
            }
            // Production mode: only show warnings and errors
            DebugMode.NONE -> {
                LogLevel.WARN
            }
        }
    }

    /**
     * Check if a log level should be logged based on current configuration
     * @param level The log level to check
     * @return true if the level should be logged, false otherwise
     */
    fun shouldLog(level: LogLevel): Boolean {
        return level.value >= getMinimumLogLevel().value
    }

    /**
     * Check if a log level should be logged based on current configuration
     * @param levelString The log level string to check
     * @return true if the level should be logged, false otherwise
     */
    fun shouldLog(levelString: String): Boolean {
        return shouldLog(LogLevel.fromString(levelString))
    }
}
