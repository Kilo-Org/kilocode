// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package com.sina.weibo.agent.ipc.proxy

import com.intellij.openapi.Disposable

/**
 * Pending RPC reply
 * Corresponds to PendingRPCReply in VSCode
 */
class PendingRPCReply(
    private val promise: LazyPromise,
    private val disposable: Disposable
) {
    /**
     * Resolve reply successfully
     * @param value Result value
     */
    fun resolveOk(value: Any?) {
        promise.resolveOk(value)
        disposable.dispose()
    }

    /**
     * Resolve reply with error
     * @param err Error object
     */
    fun resolveErr(err: Throwable) {
        promise.resolveErr(err)
        disposable.dispose()
    }
} 