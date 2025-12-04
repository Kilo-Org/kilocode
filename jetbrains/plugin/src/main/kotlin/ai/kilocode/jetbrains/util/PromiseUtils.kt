// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.util

import ai.kilocode.jetbrains.ipc.proxy.LazyPromise
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.concurrent.CompletableFuture
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * LazyPromise extension function, convert LazyPromise to CompletableFuture
 *
 * @param T Result type
 * @return CompletableFuture containing the Promise result
 */
@OptIn(ExperimentalCoroutinesApi::class)
fun <T> LazyPromise.toCompletableFuture(): CompletableFuture<T> {
    val future = CompletableFuture<T>()

    this.invokeOnCompletion { throwable ->
        if (throwable != null) {
            future.completeExceptionally(throwable)
        } else {
            try {
                @Suppress("UNCHECKED_CAST")
                val result = this.getCompleted() as T
                future.complete(result)
            } catch (e: Exception) {
                future.completeExceptionally(e)
            }
        }
    }

    return future
}

/**
 * LazyPromise extension function, wait for Promise to complete and return result
 *
 * Usage:
 * ```
 * val result = lazyPromise.await()
 * ```
 *
 * @param T Result type
 * @return Result value of the Promise
 */
@OptIn(ExperimentalCoroutinesApi::class)
suspend fun <T> LazyPromise.await(): T {
    return suspendCancellableCoroutine { continuation ->
        this.invokeOnCompletion { throwable ->
            if (throwable != null) {
                continuation.resumeWithException(throwable)
            } else {
                try {
                    @Suppress("UNCHECKED_CAST")
                    val result = this.getCompleted() as T
                    continuation.resume(result)
                } catch (e: Exception) {
                    continuation.resumeWithException(e)
                }
            }
        }

        continuation.invokeOnCancellation {
            // You can add logic to cancel the Promise here if LazyPromise supports it
        }
    }
}

/**
 * LazyPromise extension function, handle Promise result
 *
 * Usage:
 * ```
 * lazyPromise.handle { result ->
 *    // handle result
 * }
 * ```
 *
 * @param T Result type
 * @param onSuccess Success callback function
 * @param onError Error callback function, default is empty
 */
@OptIn(ExperimentalCoroutinesApi::class)
fun <T> LazyPromise.handle(
    onSuccess: (T) -> Unit,
    onError: (Throwable) -> Unit = { throw it },
) {
    this.invokeOnCompletion { throwable ->
        if (throwable != null) {
            onError(throwable)
        } else {
            try {
                @Suppress("UNCHECKED_CAST")
                val result = this.getCompleted() as T
                onSuccess(result)
            } catch (e: Exception) {
                onError(e)
            }
        }
    }
}

/**
 * LazyPromise extension function, convert result to another type
 *
 * Usage:
 * ```
 * val boolPromise = lazyPromise.thenMap { result ->
 *    // convert result
 *    result is Boolean && result
 * }
 * ```
 *
 * @param T Original result type
 * @param R Converted result type
 * @param mapper Conversion function
 * @return New LazyPromise containing the converted result
 */
@OptIn(ExperimentalCoroutinesApi::class)
fun <T, R> LazyPromise.thenMap(mapper: (T) -> R): LazyPromise {
    val result = LazyPromise()

    this.invokeOnCompletion { throwable ->
        if (throwable != null) {
            result.resolveErr(throwable)
        } else {
            try {
                @Suppress("UNCHECKED_CAST")
                val value = this.getCompleted() as T
                val mapped = mapper(value)
                result.resolveOk(mapped)
            } catch (e: Exception) {
                result.resolveErr(e)
            }
        }
    }

    return result
}
