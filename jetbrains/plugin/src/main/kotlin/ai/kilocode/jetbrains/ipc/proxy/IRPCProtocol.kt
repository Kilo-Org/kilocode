// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy

import com.intellij.openapi.Disposable

/**
 * RPC protocol interface
 * Corresponds to IRPCProtocol in VSCode
 */
interface IRPCProtocol : Disposable {
    /**
     * Current responsive state
     */
    val responsiveState: ResponsiveState

    /**
     * Get proxy object
     * @param identifier Proxy identifier
     * @return Proxy object
     */
    fun <T> getProxy(identifier: ProxyIdentifier<T>): T

    /**
     * Set local object instance
     * @param identifier Proxy identifier
     * @param instance Instance object
     * @return Instance object
     */
    fun <T, R : T> set(identifier: ProxyIdentifier<T>, instance: R): R

    /**
     * Assert identifiers are registered
     * @param identifiers List of proxy identifiers
     */
    fun assertRegistered(identifiers: List<ProxyIdentifier<*>>)

    /**
     * Wait for the write buffer (if any) to become empty
     */
    suspend fun drain()
}
