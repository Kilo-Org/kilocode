// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc

/**
 * Message listener
 */
fun interface MessageListener {
    /**
     * Handle received message
     * @param data Received message data
     */
    fun onMessage(data: ByteArray)
}
