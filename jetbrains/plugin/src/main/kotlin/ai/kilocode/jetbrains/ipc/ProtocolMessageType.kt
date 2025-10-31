// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc

/**
 * Protocol message type
 * Corresponds to ProtocolMessageType in VSCode
 */
enum class ProtocolMessageType(val value: Int) {
    /**
     * Undefined
     */
    NONE(0),

    /**
     * Regular message
     */
    REGULAR(1),

    /**
     * Control message
     */
    CONTROL(2),

    /**
     * Acknowledgment message
     */
    ACK(3),

    /**
     * Disconnect message
     */
    DISCONNECT(5),

    /**
     * Replay request message
     */
    REPLAY_REQUEST(6),

    /**
     * Pause message
     */
    PAUSE(7),

    /**
     * Resume message
     */
    RESUME(8),

    /**
     * Keep alive message
     */
    KEEP_ALIVE(9),
    ;

    /**
     * Get string description of enum type
     * @return String description
     */
    fun toTypeString(): String = when (this) {
        NONE -> "None"
        REGULAR -> "Regular"
        CONTROL -> "Control"
        ACK -> "Ack"
        DISCONNECT -> "Disconnect"
        REPLAY_REQUEST -> "ReplayRequest"
        PAUSE -> "PauseWriting"
        RESUME -> "ResumeWriting"
        KEEP_ALIVE -> "KeepAlive"
    }

    companion object {
        /**
         * Get corresponding enum by integer value
         * @param value Integer value
         * @return Corresponding enum, returns NONE if not found
         */
        fun fromValue(value: Int): ProtocolMessageType {
            return values().find { it.value == value } ?: NONE
        }
    }
}
