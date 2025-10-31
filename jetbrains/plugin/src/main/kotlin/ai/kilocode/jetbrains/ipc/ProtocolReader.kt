// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import java.nio.ByteBuffer

/**
 * Protocol reader
 * Corresponds to ProtocolReader in VSCode
 */
class ProtocolReader(private val socket: ISocket) : Disposable {
    private var isDisposed = false
    private val incomingData = ChunkStream()
    private var lastReadTime = System.currentTimeMillis()

    private val messageListeners = mutableListOf<(ProtocolMessage) -> Unit>()

    // Read state
    private val state = State()

    companion object {
        private val LOG = Logger.getInstance(ProtocolReader::class.java)
    }

    init {
        socket.onData(this::acceptChunk)
    }

    /**
     * Add message listener
     * @param listener Message listener
     * @return Listener registration identifier for removing the listener
     */
    fun onMessage(listener: (ProtocolMessage) -> Unit): Disposable {
        messageListeners.add(listener)
        return Disposable { messageListeners.remove(listener) }
    }

    /**
     * Receive data chunk
     * @param data Data chunk
     */
    fun acceptChunk(data: ByteArray) {
        if (data.isEmpty()) {
            return
        }
        lastReadTime = System.currentTimeMillis()

        incomingData.acceptChunk(data)

        while (incomingData.byteLength >= state.readLen) {
            val buff = incomingData.read(state.readLen)

            if (state.readHead) {
                // buff is message header

                // Parse message header
                val buffer = ByteBuffer.wrap(buff)
                val messageTypeByte = buffer.get(0)
                val id = buffer.getInt(1)
                val ack = buffer.getInt(5)
                val messageSize = buffer.getInt(9)

                val messageType = ProtocolMessageType.fromValue(messageTypeByte.toInt())

                // Save new state => next time will read message body
                state.readHead = false
                state.readLen = messageSize
                state.messageType = messageType
                state.id = id
                state.ack = ack

                socket.traceSocketEvent(
                    SocketDiagnosticsEventType.PROTOCOL_HEADER_READ,
                    HeaderReadInfo(
                        messageType.toTypeString(),
                        id,
                        ack,
                        messageSize,
                    ),
                )
            } else {
                // buff is message body
                val messageType = state.messageType
                val id = state.id
                val ack = state.ack

                // Save new state => next time will read message header
                state.readHead = true
                state.readLen = ProtocolConstants.HEADER_LENGTH
                state.messageType = ProtocolMessageType.NONE
                state.id = 0
                state.ack = 0

                socket.traceSocketEvent(SocketDiagnosticsEventType.PROTOCOL_MESSAGE_READ, buff)

                val message = ProtocolMessage(messageType, id, ack, buff)

                // Notify listeners
                ArrayList(messageListeners).forEach { listener ->
                    try {
                        listener(message)
                    } catch (e: Exception) {
                        // Log exception but do not interrupt processing
                        LOG.warn("Error in message listener: ${e.message}", e)
                    }
                }

                if (isDisposed) {
                    // Check if event listeners caused object to be disposed
                    break
                }
            }
        }
    }

    /**
     * Read entire buffer
     * @return All data in the buffer
     */
    fun readEntireBuffer(): ByteArray {
        return incomingData.read(incomingData.byteLength)
    }

    /**
     * Get last data read time
     * @return Last read time (millisecond timestamp)
     */
    fun getLastReadTime(): Long {
        return lastReadTime
    }

    override fun dispose() {
        isDisposed = true
        messageListeners.clear()
    }

    /**
     * Read state
     */
    private class State {
        var readHead = true
        var readLen = ProtocolConstants.HEADER_LENGTH
        var messageType = ProtocolMessageType.NONE
        var id = 0
        var ack = 0
    }

    /**
     * Message header read information (for debugging)
     */
    private data class HeaderReadInfo(
        val messageType: String,
        val id: Int,
        val ack: Int,
        val messageSize: Int,
    ) {
        override fun toString(): String {
            return "HeaderReadInfo{messageType='$messageType', id=$id, ack=$ack, messageSize=$messageSize}"
        }
    }
}
