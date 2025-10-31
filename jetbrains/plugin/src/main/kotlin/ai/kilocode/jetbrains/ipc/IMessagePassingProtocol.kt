// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc

import com.intellij.openapi.Disposable

/**
 * Message passing protocol interface
 * Corresponds to IMessagePassingProtocol in VSCode
 */
interface IMessagePassingProtocol : Disposable {
    /**
     * Send message
     * @param buffer Message data to send
     */
    fun send(buffer: ByteArray)

    /**
     * Add message receive listener
     * @param listener Message receive listener
     * @return Listener registration identifier for removing the listener
     */
    fun onMessage(listener: MessageListener): Disposable

    /**
     * Add protocol close listener
     * @param listener Close event listener
     * @return Listener registration identifier for removing the listener
     */
    fun onDidDispose(listener: () -> Unit): Disposable

    /**
     * Wait for all data to be sent
     * @return Promise for async operation completion
     */
    suspend fun drain(): Unit
}
