// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc

/**
 * Socket close event
 * Corresponds to SocketCloseEvent type in VSCode
 */
sealed interface SocketCloseEvent {
    /**
     * Get close event type
     * @return Close event type
     */
    val type: SocketCloseEventType

    /**
     * Socket close event type
     */
    enum class SocketCloseEventType {
        /**
         * Node socket close event
         */
        NODE_SOCKET_CLOSE_EVENT,

        /**
         * WebSocket close event
         */
        WEB_SOCKET_CLOSE_EVENT,
    }

    /**
     * Node Socket close event implementation
     */
    data class NodeSocketCloseEvent(
        /**
         * Whether socket had transmission error
         */
        val hadError: Boolean,

        /**
         * Underlying error
         */
        val error: Throwable?,
    ) : SocketCloseEvent {
        override val type: SocketCloseEventType = SocketCloseEventType.NODE_SOCKET_CLOSE_EVENT
    }

    /**
     * WebSocket close event implementation
     */
    data class WebSocketCloseEvent(
        /**
         * WebSocket close code
         */
        val code: Int,

        /**
         * WebSocket close reason
         */
        val reason: String,

        /**
         * Whether connection was cleanly closed
         */
        val wasClean: Boolean,

        /**
         * Underlying event
         */
        val event: Any?,
    ) : SocketCloseEvent {
        override val type: SocketCloseEventType = SocketCloseEventType.WEB_SOCKET_CLOSE_EVENT
    }
}
