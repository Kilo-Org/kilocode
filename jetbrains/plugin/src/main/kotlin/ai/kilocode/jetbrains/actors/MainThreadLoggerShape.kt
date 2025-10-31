// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import ai.kilocode.jetbrains.util.URI
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger

/**
 * Main thread logger interface.
 */
interface MainThreadLoggerShape : Disposable {
    /**
     * Logs messages.
     * @param file Log file URI
     * @param messages List of log messages
     */
    fun log(file: URI, messages: List<String>)

    /**
     * Flushes log.
     * @param file Log file URI
     */
    fun flush(file: URI)

    /**
     * Creates logger.
     * @param file Log file URI
     * @param options Log options
     * @return Creation result
     */
    fun createLogger(file: URI, options: Map<String, Any?>): Any

    /**
     * Registers logger.
     * @param logger Logger information
     * @return Registration result
     */
    fun registerLogger(logger: Map<String, Any?>): Any

    /**
     * Deregisters logger.
     * @param resource Resource URI
     * @return Deregistration result
     */
    fun deregisterLogger(resource: String): Any

    /**
     * Sets logger visibility.
     * @param resource Resource URI
     * @param visible Whether visible
     * @return Setting result
     */
    fun setVisibility(resource: String, visible: Boolean): Any
}

class MainThreadLogger : MainThreadLoggerShape {
    private val logger = Logger.getInstance(MainThreadLogger::class.java)

    override fun log(file: URI, messages: List<String>) {
        logger.info("Logging to file: $file")
    }

    override fun flush(file: URI) {
        logger.info("Flushing log file: $file")
    }

    override fun createLogger(file: URI, options: Map<String, Any?>): Any {
        logger.info("Creating logger for file: $file with options: $options")
        return Unit // Placeholder for actual logger object
    }

    override fun registerLogger(log: Map<String, Any?>): Any {
        logger.info("Registering logger: $log")
        return Unit // Placeholder for actual registration result
    }

    override fun deregisterLogger(resource: String): Any {
        logger.info("Deregistering logger for resource: $resource")
        return Unit // Placeholder for actual deregistration result
    }

    override fun setVisibility(resource: String, visible: Boolean): Any {
        logger.info("Setting visibility for resource: $resource to $visible")
        return Unit // Placeholder for actual visibility result
    }

    override fun dispose() {
        logger.info("Disposing MainThreadLogger")
    }
}
