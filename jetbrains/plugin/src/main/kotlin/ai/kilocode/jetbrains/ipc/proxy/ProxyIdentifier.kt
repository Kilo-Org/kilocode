// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy

/**
 * Proxy identifier class
 * Corresponds to ProxyIdentifier in VSCode
 */
class ProxyIdentifier<T> private constructor(
    /**
     * String identifier
     */
    val sid: String,

    /**
     * Numeric identifier
     */
    val nid: Int,
) {
    companion object {
        /**
         * Identifier counter
         */
        var count = 0
            private set

        /**
         * Create new ProxyIdentifier instance
         */
        internal fun <T> create(sid: String): ProxyIdentifier<T> {
            return ProxyIdentifier<T>(sid, ++count)
        }

        /**
         * Create placeholder ProxyIdentifier, does not increment counter
         */
        internal fun <T> createPlaceholder(sid: String, nid: Int): ProxyIdentifier<T> {
            return ProxyIdentifier<T>(sid, nid)
        }
    }

    override fun toString(): String {
        return this.sid
    }
}

/**
 * Stores created proxy identifiers
 */
private val identifiers = mutableListOf<ProxyIdentifier<*>>()

/**
 * Create proxy identifier
 * @param identifier String identifier
 * @return Proxy identifier instance
 */
fun <T> createProxyIdentifier(identifier: String): ProxyIdentifier<T> {
    val result = ProxyIdentifier.create<T>(identifier)
    while (identifiers.size <= result.nid) {
        identifiers.add(ProxyIdentifier.createPlaceholder<Any>("placeholder", identifiers.size))
    }
    identifiers[result.nid] = result
    return result
}

/**
 * Get string identifier by proxy ID
 * @param nid Proxy ID
 * @return String identifier
 */
fun getStringIdentifierForProxy(nid: Int): String {
    return identifiers[nid].sid
}

/**
 * Serializable object with buffers
 * Corresponds to SerializableObjectWithBuffers in VSCode
 * @param value Value to serialize
 */
class SerializableObjectWithBuffers<T>(val value: T)
