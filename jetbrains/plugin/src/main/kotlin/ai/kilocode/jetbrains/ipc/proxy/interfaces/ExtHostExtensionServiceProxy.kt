// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy.interfaces

import ai.kilocode.jetbrains.ipc.proxy.LazyPromise

/**
 * Extension host extension service interface
 * Corresponds to ExtHostExtensionServiceShape in VSCode
 */
interface ExtHostExtensionServiceProxy {
    /**
     * Resolve remote authority
     * @param remoteAuthority Remote authority identifier
     * @param resolveAttempt Number of resolve attempts
     * @return Resolve result
     */
    fun resolveAuthority(remoteAuthority: String, resolveAttempt: Int): LazyPromise

    /**
     * Get canonical URI
     * Returns null if no resolver is found for remoteAuthority
     * @param remoteAuthority Remote authority identifier
     * @param uri URI components
     * @return Canonical URI components or null
     */
    fun getCanonicalURI(remoteAuthority: String, uri: Map<String, Any?>): LazyPromise

    /**
     * Start extension host
     * @param extensionsDelta Extension description delta
     */
    fun startExtensionHost(extensionsDelta: Map<String, Any?>): LazyPromise

    /**
     * Execute extension tests
     * @return Test result code
     */
    fun extensionTestsExecute(): LazyPromise

    /**
     * Activate extension by event
     * @param activationEvent Activation event
     * @param activationKind Activation kind
     */
    fun activateByEvent(activationEvent: String, activationKind: Int): LazyPromise

    /**
     * Activate extension
     * @param extensionId Extension ID
     * @param reason Activation reason
     * @return Whether activation succeeded
     */
    fun activate(extensionId: String, reason: Map<String, Any?>): LazyPromise

    /**
     * Set remote environment
     * @param env Environment variables
     */
    fun setRemoteEnvironment(env: Map<String, String?>): LazyPromise

    /**
     * Update remote connection data
     * @param connectionData Connection data
     */
    fun updateRemoteConnectionData(connectionData: Map<String, Any?>): LazyPromise

    /**
     * Delta update extensions
     * @param extensionsDelta Extension description delta
     */
    fun deltaExtensions(extensionsDelta: Map<String, Any?>): LazyPromise

    /**
     * Test latency
     * @param n Test parameter
     * @return Latency value
     */
    fun test_latency(n: Int): LazyPromise

    /**
     * Test upload
     * @param b Binary buffer
     * @return Result
     */
    fun test_up(b: ByteArray): LazyPromise

    /**
     * Test download
     * @param size Size
     * @return Binary buffer
     */
    fun test_down(size: Int): LazyPromise
}
