// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc

/**
 * Protocol message
 * Corresponds to ProtocolMessage in VSCode
 */
class ProtocolMessage(
    /**
     * Message type
     */
    val type: ProtocolMessageType,

    /**
     * Message ID
     */
    val id: Int,

    /**
     * Acknowledgment ID
     */
    val ack: Int,

    /**
     * Message data
     */
    val data: ByteArray = ByteArray(0),
) {
    /**
     * Message write time (millisecond timestamp)
     */
    var writtenTime: Long = 0

    /**
     * Get message size (bytes)
     * @return Message size
     */
    val size: Int
        get() = data.size

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as ProtocolMessage

        if (type != other.type) return false
        if (id != other.id) return false
        if (ack != other.ack) return false
        if (!data.contentEquals(other.data)) return false

        return true
    }

    override fun hashCode(): Int {
        var result = type.hashCode()
        result = 31 * result + id
        result = 31 * result + ack
        result = 31 * result + data.contentHashCode()
        return result
    }
}
