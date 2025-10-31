// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy

/**
 * RPC message type
 * Corresponds to MessageType enum in VSCode
 */
enum class MessageType(val value: Int) {
    /**
     * Request with JSON arguments
     */
    RequestJSONArgs(1),

    /**
     * Request with JSON arguments and cancellation token
     */
    RequestJSONArgsWithCancellation(2),

    /**
     * Request with mixed arguments
     */
    RequestMixedArgs(3),

    /**
     * Request with mixed arguments and cancellation token
     */
    RequestMixedArgsWithCancellation(4),

    /**
     * Acknowledged message
     */
    Acknowledged(5),

    /**
     * Cancel message
     */
    Cancel(6),

    /**
     * Empty OK reply
     */
    ReplyOKEmpty(7),

    /**
     * OK reply with binary buffer
     */
    ReplyOKVSBuffer(8),

    /**
     * OK reply in JSON format
     */
    ReplyOKJSON(9),

    /**
     * OK reply in JSON format with buffers
     */
    ReplyOKJSONWithBuffers(10),

    /**
     * Error reply
     */
    ReplyErrError(11),

    /**
     * Empty error reply
     */
    ReplyErrEmpty(12),
    ;

    companion object {
        /**
         * Get type by value
         */
        fun fromValue(value: Int): MessageType? = values().find { it.value == value }
    }
}
