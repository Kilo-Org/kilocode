// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy

import kotlinx.coroutines.CompletableDeferred

/**
 * Lazy Promise implementation
 * Corresponds to LazyPromise in VSCode
 */
open class LazyPromise : CompletableDeferred<Any?> by CompletableDeferred() {
    /**
     * Resolve Promise successfully
     * @param value Result value
     */
    fun resolveOk(value: Any?) {
        complete(value)
    }

    /**
     * Reject Promise
     * @param err Error object
     */
    fun resolveErr(err: Throwable) {
        completeExceptionally(err)
    }
}

/**
 * Canceled Lazy Promise implementation
 * Corresponds to CanceledLazyPromise in VSCode
 */
class CanceledLazyPromise : LazyPromise() {
    init {
        // Immediately complete with cancellation exception
        completeExceptionally(CanceledException())
    }
}

/**
 * Cancellation exception
 */
class CanceledException : Exception("Operation cancelled")
