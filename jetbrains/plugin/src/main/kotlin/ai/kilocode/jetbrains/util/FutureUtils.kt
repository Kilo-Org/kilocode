// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.util

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.future.future
import java.util.concurrent.CompletableFuture

/**
 * Convert coroutine to CompletableFuture
 * This is a helper function to simplify converting coroutine operations to CompletableFuture
 *
 * @param scope Coroutine scope
 * @param block Coroutine code block
 * @return CompletableFuture containing the coroutine result
 */
fun <T> toCompletableFuture(scope: CoroutineScope, block: suspend () -> T): CompletableFuture<T> {
    return scope.future { block() }
} 