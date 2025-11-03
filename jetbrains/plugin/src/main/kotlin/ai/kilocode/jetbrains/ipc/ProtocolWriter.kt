// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc

import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.nio.ByteBuffer
import java.util.TreeMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Protocol writer
 * Corresponds to ProtocolWriter in VSCode, but enhanced with message ordering functionality
 */
class ProtocolWriter(
    private val socket: ISocket,
    private val enableLogging: Boolean = false, // Add logging control variable
) {
    private val logger = Logger.getInstance(ProtocolWriter::class.java)

    // Core state variables
    private val isDisposed = AtomicBoolean(false)
    private val isPaused = AtomicBoolean(false)
    private val lastWriteTime = AtomicLong(0)

    // Lock to protect message queue
    private val queueLock = ReentrantLock()

    // Use TreeMap to sort by message ID
    private val messageQueue = TreeMap<Int, MessagePackage>()

    // Special message queue (messages that don't need ordering, like ACK and priority messages)
    private val specialMessageQueue = mutableListOf<MessagePackage>()

    // Next expected message ID
    private var nextExpectedId = 1

    // Write scheduling state
    private var isWriteScheduled = AtomicBoolean(false)
    private var writeJob: Job? = null

    // Message blocking detection task
    private var blockingDetectionJob: Job? = null

    // Coroutine scope
    private val coroutineScope = CoroutineScope(Dispatchers.IO)

    init {
        // Start message blocking detection task
        startBlockingDetection()
    }

    /**
     * Start message blocking detection task
     */
    private fun startBlockingDetection() {
        blockingDetectionJob = coroutineScope.launch {
            while (!isDisposed.get()) {
                try {
                    delay(5000) // Check every 5 seconds
                    checkMessageBlocking()
                } catch (e: Exception) {
                    if (!isDisposed.get()) {
                        logWarn("Error in blocking detection: ${e.message}", e)
                    }
                    break
                }
            }
        }
    }

    /**
     * Check message blocking situation
     */
    private fun checkMessageBlocking() {
        if (isDisposed.get()) {
            return
        }

        queueLock.withLock {
            // If message queue is not empty but doesn't contain the expected next ID, it indicates messages are blocked
            if (messageQueue.isNotEmpty() && !messageQueue.containsKey(nextExpectedId)) {
                val minId = messageQueue.firstKey()
                val queueSize = messageQueue.size
                val queueIds = messageQueue.keys.take(10).joinToString(", ") // Display first 10 IDs

                logWarn(
                    "Message blocking detected! " +
                        "Expected next ID: $nextExpectedId, " +
                        "Minimum ID in queue: $minId, " +
                        "Queue size: $queueSize, " +
                        "Queue IDs: [$queueIds${if (queueSize > 10) "..." else ""}]",
                )

                // Check if there are consecutive ID segments that can be sent
                val consecutiveIds = mutableListOf<Int>()
                var currentId = minId
                while (messageQueue.containsKey(currentId)) {
                    consecutiveIds.add(currentId)
                    currentId++
                }

                if (consecutiveIds.isNotEmpty()) {
                    logWarn("Consecutive IDs available from $minId: ${consecutiveIds.joinToString(", ")}")
                }

                // Check missing ID ranges
                if (minId > nextExpectedId) {
                    logWarn("Missing message IDs: $nextExpectedId to ${minId - 1} (${minId - nextExpectedId} messages)")
                }
            }
        }
    }

    /**
     * Log messages, output based on enableLogging
     */
    private fun logInfo(message: String) {
        if (enableLogging) {
            logger.info(message)
        }
    }

    private fun logDebug(message: String) {
        if (enableLogging) {
            logger.debug(message)
        }
    }

    private fun logWarn(message: String, throwable: Throwable? = null) {
        if (enableLogging) {
            logger.warn(message, throwable)
        }
    }

    private fun logError(message: String, throwable: Throwable? = null) {
        if (enableLogging) {
            logger.error(message, throwable)
        }
    }

    /**
     * Message package structure
     */
    private data class MessagePackage(
        val id: Int,
        val data: ByteArray,
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is MessagePackage) return false
            if (id != other.id) return false
            return data.contentEquals(other.data)
        }

        override fun hashCode(): Int {
            var result = id
            result = 31 * result + data.contentHashCode()
            return result
        }
    }

    companion object {
        // Special message ID constants
        private const val ACK_MESSAGE_ID = 0
        private const val PRIORITY_MESSAGE_ID = -1
    }

    /**
     * Release resources
     */
    fun dispose() {
        if (isDisposed.getAndSet(true)) {
            return
        }

        // Stop blocking detection task
        blockingDetectionJob?.cancel()
        blockingDetectionJob = null

        try {
            flush()
        } catch (e: Exception) {
            logWarn("Error flushing protocol writer: ${e.message}", e)
        }

        writeJob?.cancel()
        logInfo("ProtocolWriter disposed")
    }

    /**
     * Wait for all data to be sent
     */
    suspend fun drain() {
        flush()
        return socket.drain()
    }

    /**
     * Flush and immediately send all sendable messages
     */
    fun flush() {
        writeNow()
    }

    /**
     * Pause writing
     */
    fun pause() {
        isPaused.set(true)
    }

    /**
     * Resume writing
     */
    fun resume() {
        if (!isPaused.getAndSet(false)) {
            return
        }

        scheduleWriting()
    }

    /**
     * Write message
     * @param msg Message to write
     */
    fun write(msg: ProtocolMessage) {
        if (isDisposed.get()) {
            // Resources released, ignore write request
            logDebug("Ignoring write request, writer is disposed")
            return
        }

        if (msg.type != ProtocolMessageType.KEEP_ALIVE) {
            logInfo("Writing message: id=${msg.id}, ack=${msg.ack}, type=${msg.type}, data size=${msg.data.size}")
        }
        // Record write time
        msg.writtenTime = System.currentTimeMillis()
        lastWriteTime.set(System.currentTimeMillis())

        // Create message header
        val headerBuffer = ByteBuffer.allocate(ProtocolConstants.HEADER_LENGTH)
        headerBuffer.put(0, msg.type.value.toByte())
        headerBuffer.putInt(1, msg.id)
        headerBuffer.putInt(5, msg.ack)
        headerBuffer.putInt(9, msg.data.size)

        val header = headerBuffer.array()

        // Trace event
        socket.traceSocketEvent(
            SocketDiagnosticsEventType.PROTOCOL_HEADER_WRITE,
            mapOf(
                "messageType" to msg.type.toTypeString(),
                "id" to msg.id,
                "ack" to msg.ack,
                "messageSize" to msg.data.size,
            ),
        )
        socket.traceSocketEvent(SocketDiagnosticsEventType.PROTOCOL_MESSAGE_WRITE, msg.data)

        // Merge header and data
        val combined = ByteArray(header.size + msg.data.size)
        System.arraycopy(header, 0, combined, 0, header.size)
        System.arraycopy(msg.data, 0, combined, header.size, msg.data.size)

        // Add to queue and schedule writing
        addMessageToQueue(msg.id, combined)
    }

    /**
     * Add message to queue
     * @param id Message ID
     * @param data Complete message data (header + content)
     */
    private fun addMessageToQueue(id: Int, data: ByteArray) {
        val pkg = MessagePackage(id, data)

        queueLock.withLock {
            // Special messages (ACK or priority messages) are directly added to special queue
            if (id == ACK_MESSAGE_ID || id == PRIORITY_MESSAGE_ID) {
                specialMessageQueue.add(pkg)
                logDebug("Added special message to queue: id=$id")
            } else {
                // Regular messages are sorted by ID
                messageQueue[id] = pkg
                logDebug("Added message to sorted queue: id=$id, queue size=${messageQueue.size}")
            }
        }

        // Schedule writing
        scheduleWriting()
    }

    /**
     * Schedule write task
     */
    private fun scheduleWriting() {
        if (isPaused.get() || isDisposed.get()) {
            return
        }

        // If there's already a scheduled task, don't reschedule
        if (!isWriteScheduled.compareAndSet(false, true)) {
            return
        }

        writeJob = coroutineScope.launch {
            try {
                // Write once immediately
                writeNow()

                // Reset scheduling state, allow subsequent scheduling
                isWriteScheduled.set(false)

                // Check if there is still data to write
                if (hasDataToWrite()) {
                    scheduleWriting()
                }
            } catch (e: Exception) {
                logError("Error in write job: ${e.message}", e)
                // Reset scheduling state, allow subsequent scheduling
                isWriteScheduled.set(false)
                // If the error is not because the socket is closed, try to reschedule
                if (!isDisposed.get() && hasDataToWrite()) {
                    delay(100) // Retry after a short delay
                    scheduleWriting()
                }
            }
        }
    }

    /**
     * Check if there is data to write
     */
    private fun hasDataToWrite(): Boolean {
        return queueLock.withLock {
            specialMessageQueue.isNotEmpty() || messageQueue.isNotEmpty()
        }
    }

    /**
     * Immediately write all sendable messages
     */
    private fun writeNow() {
        if (isPaused.get() || isDisposed.get()) {
            return
        }

        val dataToWrite = queueLock.withLock {
            // If no messages, return directly
            if (specialMessageQueue.isEmpty() && messageQueue.isEmpty()) {
                return@withLock null
            }

            // First check if there are special messages
            var specialData: ByteArray? = null
            if (specialMessageQueue.isNotEmpty()) {
                specialData = specialMessageQueue.flatMap { it.data.toList() }.toByteArray()
                specialMessageQueue.clear()
            }

            // Check regular message queue
            if (messageQueue.isEmpty()) {
                return@withLock specialData
            }

            // Find consecutive messages starting from nextExpectedId
            val messagesToSend = mutableListOf<MessagePackage>()
            var currentId = nextExpectedId

            // Strictly check if there's the expected next ID
            // If the smallest ID in queue is greater than expected ID, don't send any messages, wait for missing messages
            if (!messageQueue.containsKey(nextExpectedId)) {
                // No expected next ID in queue, don't send any messages
                logInfo("Waiting for message with ID=$nextExpectedId before sending later messages, messageQueue: ${messageQueue.size}")
                return@withLock specialData
            }

            // Collect consecutive messages
            while (messageQueue.containsKey(currentId)) {
                val message = messageQueue[currentId]!!
                messagesToSend.add(message)
                messageQueue.remove(currentId)
                currentId++
            }

            // Update next expected ID
            if (messagesToSend.isNotEmpty()) {
                nextExpectedId = currentId
                logDebug("Next expected ID updated to $nextExpectedId")

                // Merge all message data
                if (specialData != null) {
                    return@withLock specialData + messagesToSend.flatMap { it.data.toList() }.toByteArray()
                } else {
                    return@withLock messagesToSend.flatMap { it.data.toList() }.toByteArray()
                }
            }

            // No consecutive messages to send
            specialData
        }

        // Write data (perform I/O outside the lock)
        if (dataToWrite != null && dataToWrite.isNotEmpty()) {
            try {
                logInfo("Writing ${dataToWrite.size} bytes to socket")
                socket.traceSocketEvent(
                    SocketDiagnosticsEventType.PROTOCOL_WRITE,
                    mapOf("byteLength" to dataToWrite.size),
                )
                socket.write(dataToWrite)
            } catch (e: Exception) {
                logError("Error writing to socket: ${e.message}", e)
                if (!isDisposed.get()) {
                    isDisposed.set(true)
                }
                throw e
            }
        }
    }

    /**
     * Get last write time
     */
    fun getLastWriteTime(): Long {
        return lastWriteTime.get()
    }
}
