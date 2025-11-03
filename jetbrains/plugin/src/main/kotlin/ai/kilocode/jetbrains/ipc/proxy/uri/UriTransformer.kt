// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy.uri

/**
 * Create raw URI transformer
 * Corresponds to createRawURITransformer in VSCode
 */
fun createRawURITransformer(remoteAuthority: String): IRawURITransformer {
    return object : IRawURITransformer {
        override fun transformIncoming(uri: UriParts): UriParts {
            return when (uri.scheme) {
                "vscode-remote" -> UriParts(
                    scheme = "file",
                    path = uri.path,
                    query = uri.query,
                    fragment = uri.fragment,
                )
                "file" -> UriParts(
                    scheme = "vscode-local",
                    path = uri.path,
                    query = uri.query,
                    fragment = uri.fragment,
                )
                else -> uri
            }
        }

        override fun transformOutgoing(uri: UriParts): UriParts {
            return when (uri.scheme) {
                "file" -> UriParts(
                    scheme = "vscode-remote",
                    authority = remoteAuthority,
                    path = uri.path,
                    query = uri.query,
                    fragment = uri.fragment,
                )
                "vscode-local" -> UriParts(
                    scheme = "file",
                    path = uri.path,
                    query = uri.query,
                    fragment = uri.fragment,
                )
                else -> uri
            }
        }

        override fun transformOutgoingScheme(scheme: String): String {
            return when (scheme) {
                "file" -> "vscode-remote"
                "vscode-local" -> "file"
                else -> scheme
            }
        }
    }
}

/**
 * Create URI transformer
 * Corresponds to createURITransformer in VSCode
 */
fun createURITransformer(remoteAuthority: String): IURITransformer {
    return URITransformer(createRawURITransformer(remoteAuthority))
}

/**
 * JSON converter for URI transformation
 * Used for conversion between string and URI
 */
class UriReplacer(private val transformer: IURITransformer) : (String, Any?) -> Any? {

    override fun invoke(key: String, value: Any?): Any? {
        if (value is String && (
                key == "uri" ||
                    key == "documentUri" ||
                    key == "targetUri" ||
                    key == "sourceUri" ||
                    key.endsWith("Uri")
                )
        ) {
            return transformer.transformOutgoingURI(value)
        }
        return value
    }
}
