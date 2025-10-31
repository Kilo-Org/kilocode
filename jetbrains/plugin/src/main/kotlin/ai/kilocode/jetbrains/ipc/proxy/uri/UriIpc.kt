// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy.uri

import java.net.URI

/**
 * URI parts
 * Corresponds to UriParts in VSCode
 */
data class UriParts(
    val scheme: String,
    val authority: String? = null,
    val path: String,
    val query: String? = null,
    val fragment: String? = null,
)

/**
 * Raw URI transformer interface
 * Corresponds to IRawURITransformer in VSCode
 */
interface IRawURITransformer {
    /**
     * Transform incoming URI
     */
    fun transformIncoming(uri: UriParts): UriParts

    /**
     * Transform outgoing URI
     */
    fun transformOutgoing(uri: UriParts): UriParts

    /**
     * Transform outgoing scheme
     */
    fun transformOutgoingScheme(scheme: String): String
}

/**
 * URI transformer interface
 * Corresponds to IURITransformer in VSCode
 */
interface IURITransformer {
    /**
     * Transform incoming URI
     */
    fun transformIncoming(uri: URI): URI

    /**
     * Transform outgoing URI
     */
    fun transformOutgoing(uri: URI): URI

    /**
     * Transform outgoing URI string
     */
    fun transformOutgoingURI(uri: String): String
}

/**
 * URI transformer
 * Corresponds to URITransformer in VSCode
 */
class URITransformer(private val transformer: IRawURITransformer) : IURITransformer {

    override fun transformIncoming(uri: URI): URI {
        val uriParts = UriParts(
            scheme = uri.scheme,
            authority = uri.authority,
            path = uri.path,
            query = uri.query,
            fragment = uri.fragment,
        )

        val transformedParts = transformer.transformIncoming(uriParts)

        return buildURI(transformedParts)
    }

    override fun transformOutgoing(uri: URI): URI {
        val uriParts = UriParts(
            scheme = uri.scheme,
            authority = uri.authority,
            path = uri.path,
            query = uri.query,
            fragment = uri.fragment,
        )

        val transformedParts = transformer.transformOutgoing(uriParts)

        return buildURI(transformedParts)
    }

    override fun transformOutgoingURI(uri: String): String {
        try {
            return transformOutgoing(URI(uri)).toString()
        } catch (e: Exception) {
            // If the URI is invalid, try to convert only the scheme part
            val schemeEndIndex = uri.indexOf(':')
            if (schemeEndIndex > 0) {
                val scheme = uri.substring(0, schemeEndIndex)
                val transformedScheme = transformer.transformOutgoingScheme(scheme)
                if (transformedScheme !== scheme) {
                    return transformedScheme + uri.substring(schemeEndIndex)
                }
            }
            return uri
        }
    }

    /**
     * Build URI from UriParts
     */
    private fun buildURI(parts: UriParts): URI {
        val builder = StringBuilder()

        // Add scheme
        builder.append(parts.scheme).append(":")

        // Add authority (if present)
        if (!parts.authority.isNullOrEmpty()) {
            builder.append("//").append(parts.authority)
        }

        // Add path
        builder.append(parts.path)

        // Add query (if present)
        if (!parts.query.isNullOrEmpty()) {
            builder.append("?").append(parts.query)
        }

        // Add fragment (if present)
        if (!parts.fragment.isNullOrEmpty()) {
            builder.append("#").append(parts.fragment)
        }

        return URI(builder.toString())
    }
}
