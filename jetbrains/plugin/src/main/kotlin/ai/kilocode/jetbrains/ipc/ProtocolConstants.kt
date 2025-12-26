// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc

/**
 * Protocol constants
 * Corresponds to ProtocolConstants in VSCode
 */
object ProtocolConstants {
    /**
     * Message header length (bytes)
     */
    const val HEADER_LENGTH = 13

    /**
     * Maximum delay time for sending acknowledgment messages (milliseconds)
     * Increased from 2s to 5s to accommodate slower machines
     */
    const val ACKNOWLEDGE_TIME = 5000 // 5 seconds

    /**
     * If a sent message has not been acknowledged beyond this time, and no server data has been received during this period,
     * the connection is considered timed out
     * Increased from 20s to 60s to accommodate slower machines and initialization delays
     */
    const val TIMEOUT_TIME = 60000 // 60 seconds

    /**
     * If no reconnection occurs within this time range, the connection is considered permanently closed
     */
    const val RECONNECTION_GRACE_TIME = 3 * 60 * 60 * 1000 // 3 hours

    /**
     * Maximum grace time between first and last reconnection
     */
    const val RECONNECTION_SHORT_GRACE_TIME = 5 * 60 * 1000 // 5 minutes

    /**
     * Send a message at regular intervals to prevent the connection from being closed by the operating system
     */
    const val KEEP_ALIVE_SEND_TIME = 5000 // 5 seconds
}
