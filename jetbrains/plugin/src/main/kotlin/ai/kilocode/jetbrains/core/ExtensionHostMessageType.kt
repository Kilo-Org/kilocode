// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.core

/**
 * Extension host message type
 * Corresponds to extensionHostProtocol.MessageType in VSCode
 */
enum class ExtensionHostMessageType {
    /**
     * Initialized
     */
    Initialized,

    /**
     * Ready
     */
    Ready,

    /**
     * Terminated
     */
    Terminate,

    ;

    companion object {
        /**
         * Get message type from numeric value
         * @param value Numeric value
         * @return Corresponding message type, or null if not matched
         */
        fun fromValue(value: Int): ExtensionHostMessageType? {
            return when (value) {
                0 -> Initialized
                1 -> Ready
                2 -> Terminate
                else -> null
            }
        }

        /**
         * Get message type from protocol message data
         * @param data Message data
         * @return Corresponding message type, or null if not matched
         */
        fun fromData(data: ByteArray): ExtensionHostMessageType? {
            if (data.size != 1) {
                return null
            }

            return when (data[0].toInt()) {
                1 -> Initialized
                2 -> Ready
                3 -> Terminate
                else -> null
            }
        }
    }
}
