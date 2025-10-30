// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import java.io.IOException
import java.net.Socket
import java.nio.channels.Channels
import java.nio.channels.SocketChannel
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * NodeSocket implementation, wrapping Java Socket
 * Corresponds to NodeSocket implementation in VSCode
 */
class NodeSocket : ISocket {

    private val logger = Logger.getInstance(NodeSocket::class.java)
    private val dataListeners = ConcurrentHashMap<ISocket.DataListener, Unit>()
    private val closeListeners = ConcurrentHashMap<ISocket.CloseListener, Unit>()
    private val endListeners = ConcurrentHashMap<() -> Unit, Unit>()
    private val canWrite = AtomicBoolean(true)
    private var receiveThread: Thread? = null
    private val isDisposed = AtomicBoolean(false)
    private var endTimeoutHandle: Thread? = null
    private val socketEndTimeoutMs = 30_000L // 30 second timeout
    private val debugLabel: String
    private val input: java.io.InputStream
    private val output: java.io.OutputStream
    private val closeAction: () -> Unit
    private val isSocket: Boolean
    private val socket: Socket?
    private val channel: SocketChannel?
    private val writeAction: (ByteArray) -> Unit

    // Compatible with Socket/SocketChannel
    constructor(socket: Socket, debugLabel: String = "") {
        this.input = socket.getInputStream()
        this.output = socket.getOutputStream()
        this.closeAction = { socket.close() }
        this.debugLabel = debugLabel
        this.isSocket = true
        this.socket = socket
        this.channel = null
        this.writeAction = { buffer ->
            output.write(buffer)
            output.flush()
        }
        traceSocketEvent(SocketDiagnosticsEventType.CREATED, mapOf("type" to "NodeSocket-TCP"))
    }

    constructor(channel: SocketChannel, debugLabel: String = "") {
        this.input = Channels.newInputStream(channel)
        this.output = Channels.newOutputStream(channel)
        this.closeAction = { channel.close() }
        this.debugLabel = debugLabel
        this.isSocket = false
        this.socket = null
        this.channel = channel
        this.writeAction = { buffer ->
            val byteBuffer = java.nio.ByteBuffer.wrap(buffer)
            while (byteBuffer.hasRemaining()) {
                channel.write(byteBuffer)
            }
        }
        traceSocketEvent(SocketDiagnosticsEventType.CREATED, mapOf("type" to "NodeSocket-UDS"))
    }

    override fun startReceiving() {
        if (receiveThread != null) return

        receiveThread = thread(start = true, name = "NodeSocket-Receiver-$debugLabel") {
            val buffer = ByteArray(8192) // 8KB buffer
            try {
                while (!isDisposed.get() && !Thread.currentThread().isInterrupted) {
                    try {
                        val bytesRead = input.read(buffer)
                        if (bytesRead == -1) {
                            // Stream ended
                            logger.info("Socket[$debugLabel] Read EOF, triggering onEndReceived()")
                            onEndReceived()
                            break
                        } else if (bytesRead > 0) {
                            val data = buffer.copyOfRange(0, bytesRead)
                            traceSocketEvent(SocketDiagnosticsEventType.READ, data)
                            // Notify all data listeners
                            dataListeners.keys.forEach { listener ->
                                try {
                                    listener.onData(data)
                                } catch (e: Exception) {
                                    logger.error("Socket[$debugLabel] Data listener processing exception", e)
                                }
                            }
                        }
                    } catch (e: IOException) {
                        if (!isDisposed.get()) {
                            // Check if this is a connection reset during project switching
                            val isConnectionReset = e.message?.contains("Connection reset") == true
                            if (isConnectionReset) {
                                logger.info("Socket[$debugLabel] Connection reset detected, likely due to project switching")
                            } else {
                                // Only report non-connection-reset errors when socket is not actively closed
                                logger.error("Socket[$debugLabel] IO exception occurred while reading data", e)
                            }
                            handleSocketError(e)
                        }
                        break
                    }
                }
            } catch (e: Exception) {
                if (!isDisposed.get()) {
                    logger.error("Socket[$debugLabel] Unhandled exception in receive thread", e)
                    handleSocketError(e)
                }
            } finally {
                // Ensure Socket is closed
                closeSocket(false)
            }
        }
    }

    private fun onEndReceived() {
        traceSocketEvent(SocketDiagnosticsEventType.NODE_END_RECEIVED)
        logger.info("Socket[$debugLabel] Received END event, disabling write operations")
        canWrite.set(false)

        // Notify all end listeners
        endListeners.keys.forEach { listener ->
            try {
                listener.invoke()
            } catch (e: Exception) {
                logger.error("Socket[$debugLabel] END event listener processing exception", e)
            }
        }

        // Set delayed close timer
        logger.info("Socket[$debugLabel] Will execute delayed close after ${socketEndTimeoutMs}ms")
        endTimeoutHandle = thread(start = true, name = "NodeSocket-EndTimeout-$debugLabel") {
            try {
                Thread.sleep(socketEndTimeoutMs)
                if (!isDisposed.get()) {
                    logger.info("Socket[$debugLabel] Executing delayed close")
                    closeAction()
                }
            } catch (e: InterruptedException) {
                logger.info("Socket[$debugLabel] Delayed close thread interrupted")
            } catch (e: Exception) {
                logger.error("Socket[$debugLabel] Delayed close processing exception", e)
            }
        }
    }

    private fun handleSocketError(error: Exception) {
        // Filter out EPIPE errors, which are common connection disconnect errors
        val errorCode = when {
            error.message?.contains("Broken pipe") == true -> "EPIPE"
            error.message?.contains("Connection reset") == true -> "ECONNRESET"
            else -> null
        }

        traceSocketEvent(
            SocketDiagnosticsEventType.ERROR,
            mapOf(
                "code" to errorCode,
                "message" to error.message,
            ),
        )

        // EPIPE errors don't need additional handling, socket will close itself
        if (errorCode != "EPIPE") {
            logger.warn("Socket[$debugLabel] Error: ${error.message}", error)
        }

        // Close Socket
        closeSocket(true)
    }

    private fun closeSocket(hadError: Boolean) {
        if (isDisposed.get()) return
        logger.info("Socket[$debugLabel] Closing connection, hadError=$hadError")
        try {
            if (!isClosed()) {
                logger.info("Socket[$debugLabel] Closing connection")
                closeAction()
            }
        } catch (e: Exception) {
            logger.warn("Socket[$debugLabel] Exception occurred while closing connection", e)
        }

        // Stop end timeout thread
        endTimeoutHandle?.interrupt()
        endTimeoutHandle = null

        canWrite.set(false)
        traceSocketEvent(SocketDiagnosticsEventType.CLOSE, mapOf("hadError" to hadError))

        // Notify all close listeners
        val closeEvent = SocketCloseEvent.NodeSocketCloseEvent(hadError, null)
        closeListeners.keys.forEach { listener ->
            try {
                listener.onClose(closeEvent)
            } catch (e: Exception) {
                logger.error("Socket[$debugLabel] Close listener processing exception", e)
            }
        }
    }

    override fun onData(listener: ISocket.DataListener): Disposable {
        dataListeners[listener] = Unit
        return Disposable {
            dataListeners.remove(listener)
        }
    }

    override fun onClose(listener: ISocket.CloseListener): Disposable {
        closeListeners[listener] = Unit
        return Disposable {
            closeListeners.remove(listener)
        }
    }

    override fun onEnd(listener: () -> Unit): Disposable {
        endListeners[listener] = Unit
        return Disposable {
            endListeners.remove(listener)
        }
    }

    override fun write(buffer: ByteArray) {
        if (isDisposed.get()) {
            logger.debug("Socket[$debugLabel] Write ignored: Socket disposed")
            return
        }
        if (isClosed()) {
            logger.info("Socket[$debugLabel] Write ignored: Socket closed")
            return
        }
        if (!canWrite.get()) {
            logger.info("Socket[$debugLabel] Write ignored: canWrite=false")
            return
        }

        try {
            traceSocketEvent(SocketDiagnosticsEventType.WRITE, buffer)
            writeAction(buffer)
        } catch (e: java.nio.channels.ClosedChannelException) {
            logger.warn("Socket[$debugLabel] ClosedChannelException detected during write, connection closed")
            handleSocketError(e)
        } catch (e: IOException) {
            logger.error("Socket[$debugLabel] IO exception occurred during write", e)
            // Filter out EPIPE errors
            if (e.message?.contains("Broken pipe") == true) {
                logger.warn("Socket[$debugLabel] Broken pipe detected during write")
                return
            }
            handleSocketError(e)
        } catch (e: Exception) {
            logger.error("Socket[$debugLabel] Unknown exception occurred during write", e)
            handleSocketError(e)
        }
    }

    override fun end() {
        if (isDisposed.get() || isClosed()) {
            return
        }

        traceSocketEvent(SocketDiagnosticsEventType.NODE_END_SENT)
        logger.info("Socket[$debugLabel] Sending END signal")
        try {
            if (isSocket && socket != null) {
                socket.shutdownOutput()
            } else {
                channel?.shutdownOutput()
            }
        } catch (e: Exception) {
            logger.error("Socket[$debugLabel] Exception occurred while sending END signal", e)
            handleSocketError(e)
        }
    }

    override suspend fun drain() {
        traceSocketEvent(SocketDiagnosticsEventType.NODE_DRAIN_BEGIN)

        try {
            // Send an empty packet to trigger flush (TCP will flush, UDS writes directly)
            writeAction(ByteArray(0))
        } catch (e: Exception) {
            logger.error("Socket[$debugLabel] Exception occurred while executing drain", e)
            handleSocketError(e)
        }

        traceSocketEvent(SocketDiagnosticsEventType.NODE_DRAIN_END)
    }

    override fun traceSocketEvent(type: SocketDiagnosticsEventType, data: Any?) {
        // Actual debug log logic
        if (logger.isDebugEnabled) {
            logger.debug("Socket[$debugLabel] Event: $type, Data: $data")
        }
    }

    override fun dispose() {
        if (isDisposed.getAndSet(true)) {
            return
        }

        traceSocketEvent(SocketDiagnosticsEventType.CLOSE)
        logger.info("Socket[$debugLabel] Releasing resources")

        // Clean up listeners first to prevent new events
        dataListeners.clear()
        closeListeners.clear()
        endListeners.clear()

        // Interrupt threads before closing socket to prevent race conditions
        receiveThread?.interrupt()
        endTimeoutHandle?.interrupt()

        // Wait for threads to finish
        try {
            receiveThread?.join(2000) // Wait up to 2 seconds for receive thread
        } catch (e: InterruptedException) {
            logger.warn("Socket[$debugLabel] Interrupted while waiting for receive thread")
            Thread.currentThread().interrupt()
        }

        try {
            endTimeoutHandle?.join(1000) // Wait up to 1 second for timeout thread
        } catch (e: InterruptedException) {
            logger.warn("Socket[$debugLabel] Interrupted while waiting for timeout thread")
            Thread.currentThread().interrupt()
        }

        // Close Socket after threads are stopped
        try {
            if (!isClosed()) {
                closeAction()
            }
        } catch (e: Exception) {
            logger.warn("Socket[$debugLabel] Exception occurred while closing Socket during resource release", e)
        }

        // Clean up thread references
        receiveThread = null
        endTimeoutHandle = null

        logger.info("Socket[$debugLabel] Resource release completed")
    }

    // State exposure method
    fun isClosed(): Boolean {
        return when {
            socket != null -> socket.isClosed
            channel != null -> !channel.isOpen
            else -> true
        }
    }

    fun isInputClosed(): Boolean {
        return when {
            socket != null -> socket.isClosed || socket.isInputShutdown
            channel != null -> !channel.isOpen // NIO doesn't have direct input shutdown flag, can only use isOpen
            else -> true
        }
    }

    fun isOutputClosed(): Boolean {
        return when {
            socket != null -> socket.isClosed || socket.isOutputShutdown
            channel != null -> !channel.isOpen // NIO doesn't have direct output shutdown flag, can only use isOpen
            else -> true
        }
    }

    fun isDisposed(): Boolean = isDisposed.get()
}
