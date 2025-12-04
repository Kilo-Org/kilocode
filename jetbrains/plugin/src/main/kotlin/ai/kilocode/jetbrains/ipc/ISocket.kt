// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc

import com.intellij.openapi.Disposable

/**
 * Socket interface, abstracts underlying communication
 * Corresponds to ISocket in VSCode
 */
interface ISocket : Disposable {
    /**
     * Add data receive listener
     * @param listener Data receive listener
     * @return Registration identifier for removing the listener
     */
    fun onData(listener: DataListener): Disposable

    /**
     * Add close event listener
     * @param listener Close event listener
     * @return Registration identifier for removing the listener
     */
    fun onClose(listener: CloseListener): Disposable

    /**
     * Add end event listener
     * @param listener End event listener
     * @return Registration identifier for removing the listener
     */
    fun onEnd(listener: () -> Unit): Disposable

    /**
     * Send data
     * @param buffer Data to send
     */
    fun write(buffer: ByteArray)

    /**
     * End connection
     */
    fun end()

    /**
     * Wait for all data to be sent
     * @return Promise for async operation completion
     */
    suspend fun drain()

    /**
     * Trace socket event (for debugging)
     * @param type Event type
     * @param data Event data
     */
    fun traceSocketEvent(type: SocketDiagnosticsEventType, data: Any? = null)

    /**
     * Start receiving data
     */
    fun startReceiving()

    /**
     * Data receive listener
     */
    fun interface DataListener {
        fun onData(data: ByteArray)
    }

    /**
     * Close event listener
     */
    fun interface CloseListener {
        fun onClose(event: SocketCloseEvent)
    }
}
