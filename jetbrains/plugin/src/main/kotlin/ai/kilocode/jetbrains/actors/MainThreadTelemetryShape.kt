// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger

/**
 * Main thread telemetry service interface.
 */
interface MainThreadTelemetryShape : Disposable {
    /**
     * Logs public event.
     * @param eventName Event name
     * @param data Event data
     */
    fun publicLog(eventName: String, data: Any?)

    /**
     * Logs public event (supports categorized events).
     * @param eventName Event name
     * @param data Event data
     */
    fun publicLog2(eventName: String, data: Any?)
}

class MainThreadTelemetry : MainThreadTelemetryShape {
    private val logger = Logger.getInstance(MainThreadTelemetry::class.java)

    override fun publicLog(eventName: String, data: Any?) {
        logger.info("[Telemetry] $eventName: $data")
    }

    override fun publicLog2(eventName: String, data: Any?) {
        logger.info("[Telemetry] $eventName: $data")
    }

    override fun dispose() {
        logger.info("Dispose MainThreadTelemetry")
    }
}
