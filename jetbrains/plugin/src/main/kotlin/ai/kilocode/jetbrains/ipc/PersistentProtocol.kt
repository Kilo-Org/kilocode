// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import java.util.*
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Persistent protocol implementation
 * Corresponds to PersistentProtocol in VSCode
 */
class PersistentProtocol(opts: PersistentProtocolOptions, msgListener: ((data: ByteArray) -> Unit)? = null) : IMessagePassingProtocol {
    companion object {
        private val LOG = Logger.getInstance(PersistentProtocol::class.java)
    }

    /**
     * Persistent protocol configuration
     */
    class PersistentProtocolOptions(
        val socket: ISocket,
        val initialChunk: ByteArray? = null,
        val loadEstimator: ILoadEstimator? = null,
        val sendKeepAlive: Boolean = true,
    )

    private val _isReconnecting = AtomicBoolean(false)
    private val _didSendDisconnect = AtomicBoolean(false)

    private val _outgoingUnackMsg = LinkedBlockingQueue<ProtocolMessage>()
    private val _outgoingMsgId = AtomicInteger(0)
    private val _outgoingAckId = AtomicInteger(0)
    private var _outgoingAckTimeout: Timer? = null

    private val _incomingMsgId = AtomicInteger(0)
    private val _incomingAckId = AtomicInteger(0)
    private val _incomingMsgLastTime = AtomicLong(0L)
    private var _incomingAckTimeout: Timer? = null

    private var _keepAliveInterval: Timer? = null

    private val _lastReplayRequestTime = AtomicLong(0L)
    private val _lastSocketTimeoutTime = AtomicLong(System.currentTimeMillis())

    private var _socket: ISocket
    private var _socketWriter: ProtocolWriter
    private var _socketReader: ProtocolReader
    private val _socketDisposables = mutableListOf<Disposable>()

    private val _loadEstimator: ILoadEstimator
    private val _shouldSendKeepAlive: Boolean

    // Buffered event emitters
    private val _onControlMessage = BufferedEmitter<ByteArray>()
    private val _onMessage = BufferedEmitter<ByteArray>()
    private val _onDidDispose = BufferedEmitter<Unit>()
    private val _onSocketClose = BufferedEmitter<SocketCloseEvent>()
    private val _onSocketTimeout = BufferedEmitter<SocketTimeoutEvent>()

    private var _isDisposed = false

    /**
     * Get unacknowledged message count
     */
    val unacknowledgedCount: Int
        get() = _outgoingMsgId.get() - _outgoingAckId.get()

    /**
     * Check if protocol has been disposed
     */
    fun isDisposed(): Boolean {
        return _isDisposed
    }

    init {
        _loadEstimator = opts.loadEstimator ?: LoadEstimator.getInstance()
        _shouldSendKeepAlive = opts.sendKeepAlive
        _socket = opts.socket

        _socketWriter = ProtocolWriter(_socket)
        _socketReader = ProtocolReader(_socket)
        _socketDisposables.add(_socketReader.onMessage(this::_receiveMessage))
        _socketDisposables.add(_socket.onClose { event -> _onSocketClose.fire(event) })

        if (opts.initialChunk != null) {
            _socketReader.acceptChunk(opts.initialChunk)
        }

        if (msgListener != null) {
            this._onMessage.event { data ->
                msgListener(data)
            }
        }

        _socket.startReceiving()

        if (_shouldSendKeepAlive) {
            _keepAliveInterval = Timer().apply {
                scheduleAtFixedRate(
                    object : TimerTask() {
                        override fun run() {
                            _sendKeepAlive()
                        }
                    },
                    ProtocolConstants.KEEP_ALIVE_SEND_TIME.toLong(), ProtocolConstants.KEEP_ALIVE_SEND_TIME.toLong(),
                )
            }
        }
    }

    override fun dispose() {
        // Cancel and purge all timers to prevent memory leaks
        _outgoingAckTimeout?.let { timer ->
            timer.cancel()
            timer.purge()
        }
        _outgoingAckTimeout = null

        _incomingAckTimeout?.let { timer ->
            timer.cancel()
            timer.purge()
        }
        _incomingAckTimeout = null

        _keepAliveInterval?.let { timer ->
            timer.cancel()
            timer.purge()
        }
        _keepAliveInterval = null

        // Dispose socket-related resources
        _socketDisposables.forEach { it.dispose() }
        _socketDisposables.clear()

        // Clear message queues to free memory
        val unackMsgCount = _outgoingUnackMsg.size
        _outgoingUnackMsg.clear()

        _isDisposed = true
        
        LOG.info("PersistentProtocol disposed, cleared $unackMsgCount unacknowledged messages")
    }

    override suspend fun drain() {
        _socketWriter.drain()
    }

    override fun send(buffer: ByteArray) {
        val myId = _outgoingMsgId.incrementAndGet()
        val currentIncomingAckId = _incomingMsgId.get()
        _incomingAckId.set(currentIncomingAckId)
        val msg = ProtocolMessage(ProtocolMessageType.REGULAR, myId, currentIncomingAckId, buffer)
        _outgoingUnackMsg.add(msg)
        if (!_isReconnecting.get()) {
            _socketWriter.write(msg)
            _recvAckCheck()
        }
    }

    override fun onMessage(listener: MessageListener): Disposable {
        return _onMessage.event { data ->
            listener.onMessage(data)
        }
    }

    override fun onDidDispose(listener: () -> Unit): Disposable {
        return _onDidDispose.event { listener() }
    }

    // Other public methods
    fun onControlMessage(listener: (ByteArray) -> Unit): Disposable {
        return _onControlMessage.event(listener)
    }

    fun onSocketClose(listener: (SocketCloseEvent) -> Unit): Disposable {
        return _onSocketClose.event(listener)
    }

    fun onSocketTimeout(listener: (SocketTimeoutEvent) -> Unit): Disposable {
        return _onSocketTimeout.event(listener)
    }

    fun sendDisconnect() {
        if (_didSendDisconnect.compareAndSet(false, true)) {
            val msg = ProtocolMessage(ProtocolMessageType.DISCONNECT, 0, 0, ByteArray(0))
            _socketWriter.write(msg)
            _socketWriter.flush()
        }
    }

    fun sendPause() {
        val msg = ProtocolMessage(ProtocolMessageType.PAUSE, 0, 0, ByteArray(0))
        _socketWriter.write(msg)
    }

    fun sendResume() {
        val msg = ProtocolMessage(ProtocolMessageType.RESUME, 0, 0, ByteArray(0))
        _socketWriter.write(msg)
    }

    fun pauseSocketWriting() {
        _socketWriter.pause()
    }

    fun getSocket(): ISocket {
        return _socket
    }

    fun getMillisSinceLastIncomingData(): Long {
        return System.currentTimeMillis() - _socketReader.getLastReadTime()
    }

    fun beginAcceptReconnection(socket: ISocket, initialDataChunk: ByteArray?) {
        _isReconnecting.set(true)

        _socketDisposables.forEach { it.dispose() }
        _socketDisposables.clear()
        _onControlMessage.flushBuffer()
        _onSocketClose.flushBuffer()
        _onSocketTimeout.flushBuffer()
        _socket.dispose()

        _lastReplayRequestTime.set(0)
        _lastSocketTimeoutTime.set(System.currentTimeMillis())

        _socket = socket
        _socketWriter = ProtocolWriter(_socket)
        _socketReader = ProtocolReader(_socket)
        _socketDisposables.add(_socketReader.onMessage(this::_receiveMessage))
        _socketDisposables.add(_socket.onClose { event -> _onSocketClose.fire(event) })

        if (initialDataChunk != null) {
            _socketReader.acceptChunk(initialDataChunk)
        }
    }

    fun endAcceptReconnection() {
        _isReconnecting.set(false)

        // After reconnection, let the other side know which messages have been received
        val currentIncomingMsgId = _incomingMsgId.get()
        _incomingAckId.set(currentIncomingMsgId)
        val msg = ProtocolMessage(ProtocolMessageType.ACK, 0, currentIncomingMsgId, ByteArray(0))
        _socketWriter.write(msg)

        // Resend all unacknowledged messages
        val toSend = _outgoingUnackMsg.toTypedArray()
        for (message in toSend) {
            _socketWriter.write(message)
        }
        _recvAckCheck()
    }

    fun acceptDisconnect() {
        _onDidDispose.fire(Unit)
    }

    private fun _receiveMessage(msg: ProtocolMessage) {
        val currentOutgoingAckId = _outgoingAckId.get()
        if (msg.ack > currentOutgoingAckId) {
            _outgoingAckId.set(msg.ack)
            while (_outgoingUnackMsg.isNotEmpty()) {
                val first = _outgoingUnackMsg.peek()
                if (first != null && first.id <= msg.ack) {
                    _outgoingUnackMsg.poll()
                } else {
                    break
                }
            }
        }

        when (msg.type) {
            ProtocolMessageType.NONE -> {
                // N/A
            }
            ProtocolMessageType.REGULAR -> {
                val currentIncomingMsgId = _incomingMsgId.get()
                if (msg.id > currentIncomingMsgId) {
                    if (msg.id != currentIncomingMsgId + 1) {
                        // Some messages are lost, request the other side to resend
                        val now = System.currentTimeMillis()
                        val lastReplayTime = _lastReplayRequestTime.get()
                        if (now - lastReplayTime > 10000) {
                            // Send replay request at most once every 10 seconds
                            _lastReplayRequestTime.set(now)
                            _socketWriter.write(ProtocolMessage(ProtocolMessageType.REPLAY_REQUEST, 0, 0, ByteArray(0)))
                        }
                    } else {
                        _incomingMsgId.set(msg.id)
                        _incomingMsgLastTime.set(System.currentTimeMillis())
                        _sendAckCheck()
                        _onMessage.fire(msg.data)
                    }
                }
            }
            ProtocolMessageType.CONTROL -> {
                _onControlMessage.fire(msg.data)
            }
            ProtocolMessageType.ACK -> {
                // Already handled above
            }
            ProtocolMessageType.DISCONNECT -> {
                _onDidDispose.fire(Unit)
            }
            ProtocolMessageType.REPLAY_REQUEST -> {
                // Resend all unacknowledged messages
                val toSend = _outgoingUnackMsg.toTypedArray()
                for (message in toSend) {
                    _socketWriter.write(message)
                }
                _recvAckCheck()
            }
            ProtocolMessageType.PAUSE -> {
                _socketWriter.pause()
            }
            ProtocolMessageType.RESUME -> {
                _socketWriter.resume()
            }
            ProtocolMessageType.KEEP_ALIVE -> {
                // No need to handle
            }
        }
    }

    fun readEntireBuffer(): ByteArray {
        return _socketReader.readEntireBuffer()
    }

    fun flush() {
        _socketWriter.flush()
    }

    /**
     * Send control message that doesn't participate in regular acknowledgment flow
     */
    fun sendControl(buffer: ByteArray) {
        val msg = ProtocolMessage(ProtocolMessageType.CONTROL, 0, 0, buffer)
        _socketWriter.write(msg)
    }

    private fun _sendAckCheck() {
        val currentIncomingMsgId = _incomingMsgId.get()
        val currentIncomingAckId = _incomingAckId.get()

        if (currentIncomingMsgId <= currentIncomingAckId) {
            // No messages need acknowledgment
            return
        }

        if (_incomingAckTimeout != null) {
            // There will be a check in the near future
            return
        }

        val timeSinceLastIncomingMsg = System.currentTimeMillis() - _incomingMsgLastTime.get()
        if (timeSinceLastIncomingMsg >= ProtocolConstants.ACKNOWLEDGE_TIME) {
            // Enough time has passed since receiving this message,
            // and there are no messages that need to be sent from our side during this period,
            // so we will send a message containing only acknowledgment.
            _sendAck()
            return
        }

        _incomingAckTimeout = Timer().apply {
            schedule(
                object : TimerTask() {
                    override fun run() {
                        _incomingAckTimeout = null
                        _sendAckCheck()
                    }
                },
                ProtocolConstants.ACKNOWLEDGE_TIME - timeSinceLastIncomingMsg + 5,
            )
        }
    }

    private fun _recvAckCheck() {
        val currentOutgoingMsgId = _outgoingMsgId.get()
        val currentOutgoingAckId = _outgoingAckId.get()

        if (currentOutgoingMsgId <= currentOutgoingAckId) {
            // All messages have been acknowledged
            return
        }

        if (_outgoingAckTimeout != null) {
            // There will be a check in the near future
            return
        }

        if (_isReconnecting.get()) {
            // Don't trigger timeout during reconnection,
            // because messages won't actually be written until `endAcceptReconnection`
            return
        }

        val oldestUnacknowledgedMsg = _outgoingUnackMsg.peek()!!
        val timeSinceOldestUnacknowledgedMsg = System.currentTimeMillis() - oldestUnacknowledgedMsg.writtenTime
        val timeSinceLastReceivedSomeData = System.currentTimeMillis() - _socketReader.getLastReadTime()
        val timeSinceLastTimeout = System.currentTimeMillis() - _lastSocketTimeoutTime.get()

        if (timeSinceOldestUnacknowledgedMsg >= ProtocolConstants.TIMEOUT_TIME &&
            timeSinceLastReceivedSomeData >= ProtocolConstants.TIMEOUT_TIME &&
            timeSinceLastTimeout >= ProtocolConstants.TIMEOUT_TIME
        ) {
            // It's been a long time since messages we sent were acknowledged,
            // and it's also been a long time since we received any data

            // But this might be because the event loop is busy and can't read messages
            if (!_loadEstimator.hasHighLoad()) {
                // Drop socket
                _lastSocketTimeoutTime.set(System.currentTimeMillis())
                _onSocketTimeout.fire(
                    SocketTimeoutEvent(
                        _outgoingUnackMsg.size,
                        timeSinceOldestUnacknowledgedMsg,
                        timeSinceLastReceivedSomeData,
                    ),
                )
                return
            }
        }

        val minimumTimeUntilTimeout = maxOf(
            ProtocolConstants.TIMEOUT_TIME - timeSinceOldestUnacknowledgedMsg,
            ProtocolConstants.TIMEOUT_TIME - timeSinceLastReceivedSomeData,
            ProtocolConstants.TIMEOUT_TIME - timeSinceLastTimeout,
            500,
        )

        _outgoingAckTimeout = Timer().apply {
            schedule(
                object : TimerTask() {
                    override fun run() {
                        _outgoingAckTimeout = null
                        _recvAckCheck()
                    }
                },
                minimumTimeUntilTimeout,
            )
        }
    }

    private fun _sendAck() {
        val currentIncomingMsgId = _incomingMsgId.get()
        val currentIncomingAckId = _incomingAckId.get()

        if (currentIncomingMsgId <= currentIncomingAckId) {
            // No messages need acknowledgment
            return
        }

        _incomingAckId.set(currentIncomingMsgId)
        val msg = ProtocolMessage(ProtocolMessageType.ACK, 0, currentIncomingMsgId, ByteArray(0))
        _socketWriter.write(msg)
    }

    private fun _sendKeepAlive() {
        val currentIncomingMsgId = _incomingMsgId.get()
        _incomingAckId.set(currentIncomingMsgId)
        val msg = ProtocolMessage(ProtocolMessageType.KEEP_ALIVE, 0, currentIncomingMsgId, ByteArray(0))
        _socketWriter.write(msg)
    }
}
