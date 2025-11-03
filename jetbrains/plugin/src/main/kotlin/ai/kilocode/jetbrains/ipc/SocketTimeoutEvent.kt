// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc

/**
 * Socket timeout event
 * Corresponds to SocketTimeoutEvent in VSCode
 */
data class SocketTimeoutEvent(
    /**
     * Unacknowledged message count
     */
    val unacknowledgedMsgCount: Int,

    /**
     * Time since oldest unacknowledged message (milliseconds)
     */
    val timeSinceOldestUnacknowledgedMsg: Long,

    /**
     * Time since last received some data (milliseconds)
     */
    val timeSinceLastReceivedSomeData: Long,
)
