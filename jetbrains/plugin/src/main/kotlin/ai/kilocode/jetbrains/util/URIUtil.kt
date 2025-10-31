// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.util

import java.nio.file.Path
import java.nio.file.Paths

/**
 * URI component interface
 * Defines the basic components of a URI
 */
interface URIComponents {
    val scheme: String
    val authority: String?
    val path: String
    val query: String?
    val fragment: String?
}

/**
 * Uniform Resource Identifier (URI)
 * Based on VSCode's URI implementation
 */
class URI private constructor(
    override val scheme: String,
    override val authority: String?,
    override val path: String,
    override val query: String?,
    override val fragment: String?,
) : URIComponents {

    companion object {
        private val isWindows = System.getProperty("os.name").lowercase().contains("windows")
        private const val SLASH = "/"
        private val EMPTY = ""

        private val schemePattern = Regex("^\\w[\\w\\d+.-]*$")
        private val singleSlashStart = Regex("^/")
        private val doubleSlashStart = Regex("^//")

        // URI regular expression, used to parse URI strings
        // Corresponds to _regexp in VSCode
        private val uriRegex = Regex("^(([^:/?#]+?):)?(//([^/?#]*))?([^?#]*)(\\?([^#]*))?(#(.*))?")

        /**
         * Parse URI from string
         * Corresponds to URI.parse in VSCode
         *
         * @param value URI string
         * @param strict Strict mode
         * @return URI object
         */
        fun parse(value: String, strict: Boolean = false): URI {
            val match = uriRegex.find(value) ?: return URI(EMPTY, EMPTY, EMPTY, EMPTY, EMPTY)

            return URI(
                scheme = match.groups[2]?.value ?: EMPTY,
                authority = percentDecode(match.groups[4]?.value ?: EMPTY),
                path = percentDecode(match.groups[5]?.value ?: EMPTY),
                query = percentDecode(match.groups[7]?.value ?: EMPTY),
                fragment = percentDecode(match.groups[9]?.value ?: EMPTY),
                strict = strict,
            )
        }

        /**
         * Create URI from file path
         * Corresponds to URI.file in VSCode
         *
         * @param path File system path
         * @return URI object
         */
        fun file(path: String): URI {
            var normalizedPath = path
            var authority = EMPTY

            // On Windows, convert backslashes to forward slashes
            if (isWindows) {
                normalizedPath = normalizedPath.replace('\\', '/')
            }

            // Check UNC shared path
            if (normalizedPath.startsWith("//")) {
                val idx = normalizedPath.indexOf('/', 2)
                if (idx == -1) {
                    authority = normalizedPath.substring(2)
                    normalizedPath = SLASH
                } else {
                    authority = normalizedPath.substring(2, idx)
                    normalizedPath = normalizedPath.substring(idx) ?: SLASH
                }
            }

            return URI("file", authority, normalizedPath, EMPTY, EMPTY)
        }

        /**
         * Create URI from Path object
         *
         * @param path Path object
         * @return URI object
         */
        fun file(path: Path): URI {
            return file(path.toString())
        }

        /**
         * Create URI from URI components
         * Corresponds to URI.from in VSCode
         *
         * @param components URI components
         * @param strict Strict mode
         * @return URI object
         */
        fun from(components: URIComponents, strict: Boolean = false): URI {
            return URI(
                components.scheme,
                components.authority,
                components.path,
                components.query,
                components.fragment,
                strict,
            )
        }

        /**
         * Join URI path and path fragments
         * Corresponds to URI.joinPath in VSCode
         *
         * @param uri Input URI
         * @param pathFragments Path fragment array
         * @return Result URI
         */
        fun joinPath(uri: URI, vararg pathFragments: String): URI {
            if (uri.path.isEmpty()) {
                throw IllegalArgumentException("[UriError]: cannot call joinPath on URI without path")
            }

            val newPath: String = if (isWindows && uri.scheme == "file") {
                val fsPath = uriToFsPath(uri, true)
                val joinedPath = Paths.get(fsPath, *pathFragments).toString()
                file(joinedPath).path
            } else {
                // Use posix style path join
                val fragments = listOf(uri.path) + pathFragments
                fragments.joinToString("/").replace(Regex("/+"), "/")
            }

            return uri.with(path = newPath)
        }

        /**
         * Percent decode
         * Corresponds to percentDecode in VSCode
         *
         * @param str String to decode
         * @return Decoded string
         */
        private fun percentDecode(str: String): String {
            val encodedAsHex = Regex("(%[0-9A-Za-z][0-9A-Za-z])+")

            if (!encodedAsHex.containsMatchIn(str)) {
                return str
            }

            return encodedAsHex.replace(str) { match ->
                try {
                    java.net.URLDecoder.decode(match.value, "UTF-8")
                } catch (e: Exception) {
                    // If decoding fails, keep the original string
                    match.value
                }
            }
        }
    }

    /**
     * Constructor
     */
    private constructor(
        scheme: String,
        authority: String?,
        path: String,
        query: String?,
        fragment: String?,
        strict: Boolean,
    ) : this(
        scheme = schemeFix(scheme, strict),
        authority = authority,
        path = referenceResolution(schemeFix(scheme, strict), path),
        query = query,
        fragment = fragment,
    ) {
        if (strict) {
            validate()
        }
    }

    /**
     * Validate if URI is valid
     * Corresponds to _validateUri in VSCode
     */
    private fun validate() {
        // Check scheme
        if (scheme.isEmpty()) {
            throw IllegalArgumentException(
                "[UriError]: Scheme is missing: {scheme: \"\", authority: \"$authority\", path: \"$path\", query: \"$query\", fragment: \"$fragment\"}",
            )
        }

        // Check scheme format
        if (!schemePattern.matches(scheme)) {
            throw IllegalArgumentException("[UriError]: Scheme contains illegal characters.")
        }

        // Check path format
        if (path.isNotEmpty()) {
            if (authority?.isNotEmpty() == true) {
                if (!singleSlashStart.containsMatchIn(path)) {
                    throw IllegalArgumentException(
                        "[UriError]: If a URI contains an authority component, then the path component must either be empty or begin with a slash (\"/\") character",
                    )
                }
            } else {
                if (doubleSlashStart.containsMatchIn(path)) {
                    throw IllegalArgumentException(
                        "[UriError]: If a URI does not contain an authority component, then the path cannot begin with two slash characters (\"//\")",
                    )
                }
            }
        }
    }

    /**
     * Get file system path
     * Corresponds to URI.fsPath in VSCode
     *
     * @return File system path
     */
    val fsPath: String
        get() = uriToFsPath(this, false)

    /**
     * Create new URI with modified components
     * Corresponds to URI.with in VSCode
     *
     * @param scheme New scheme or null
     * @param authority New authority or null
     * @param path New path or null
     * @param query New query or null
     * @param fragment New fragment or null
     * @return New URI object
     */
    fun with(
        scheme: String? = null,
        authority: String? = null,
        path: String? = null,
        query: String? = null,
        fragment: String? = null,
    ): URI {
        val newScheme = scheme ?: this.scheme
        val newAuthority = authority ?: this.authority
        val newPath = path ?: this.path
        val newQuery = query ?: this.query
        val newFragment = fragment ?: this.fragment

        if (newScheme == this.scheme &&
            newAuthority == this.authority &&
            newPath == this.path &&
            newQuery == this.query &&
            newFragment == this.fragment
        ) {
            return this
        }

        return URI(newScheme, newAuthority, newPath, newQuery, newFragment)
    }

    /**
     * Convert to string
     * Corresponds to URI.toString in VSCode
     *
     * @param skipEncoding Whether to skip encoding
     * @return String representation
     */
    override fun toString(): String {
        return asFormatted(false)
    }

    /**
     * Convert to formatted string
     *
     * @param skipEncoding Whether to skip encoding
     * @return Formatted string
     */
    fun toString(skipEncoding: Boolean): String {
        return asFormatted(skipEncoding)
    }

    /**
     * Format URI as string
     * Corresponds to _asFormatted in VSCode
     *
     * @param skipEncoding Whether to skip encoding
     * @return Formatted string
     */
    private fun asFormatted(skipEncoding: Boolean): String {
        // Define encoder function type
        val encoderFn: (String, Boolean, Boolean) -> String =
            if (!skipEncoding) ::encodeURIComponentFast else ::encodeURIComponentMinimal

        var res = ""

        if (scheme.isNotEmpty()) {
            res += scheme
            res += ":"
        }

        if (authority?.isNotEmpty() == true || scheme == "file") {
            res += SLASH
            res += SLASH
        }

        if (authority?.isNotEmpty() == true) {
            val idx = authority.indexOf('@')
            if (idx != -1) {
                // <user>@<auth>
                val userinfo = authority.substring(0, idx)
                val auth = authority.substring(idx + 1)
                val userinfoIdx = userinfo.lastIndexOf(':')

                if (userinfoIdx == -1) {
                    res += encoderFn(userinfo, false, false)
                } else {
                    // <user>:<pass>@<auth>
                    res += encoderFn(userinfo.substring(0, userinfoIdx), false, false)
                    res += ":"
                    res += encoderFn(userinfo.substring(userinfoIdx + 1), false, true)
                }

                res += "@"

                val authorityLower = auth.lowercase()
                val authorityIdx = authorityLower.lastIndexOf(':')

                if (authorityIdx == -1) {
                    res += encoderFn(authorityLower, false, true)
                } else {
                    // <auth>:<port>
                    res += encoderFn(authorityLower.substring(0, authorityIdx), false, true)
                    res += authorityLower.substring(authorityIdx)
                }
            } else {
                val authorityLower = authority.lowercase()
                val idx2 = authorityLower.lastIndexOf(':')

                if (idx2 == -1) {
                    res += encoderFn(authorityLower, false, true)
                } else {
                    // <auth>:<port>
                    res += encoderFn(authorityLower.substring(0, idx2), false, true)
                    res += authorityLower.substring(idx2)
                }
            }
        }

        if (path.isNotEmpty()) {
            // Handle Windows drive path
            var normalizedPath = path
            if (normalizedPath.length >= 3 && normalizedPath[0] == '/' && normalizedPath[2] == ':') {
                val code = normalizedPath[1].code
                if (code in 65..90) { // A-Z
                    normalizedPath = "/${normalizedPath[1].lowercaseChar()}:${normalizedPath.substring(3)}"
                }
            } else if (normalizedPath.length >= 2 && normalizedPath[1] == ':') {
                val code = normalizedPath[0].code
                if (code in 65..90) { // A-Z
                    normalizedPath = "${normalizedPath[0].lowercaseChar()}:${normalizedPath.substring(2)}"
                }
            }

            res += encoderFn(normalizedPath, true, false)
        }

        if (query?.isNotEmpty() == true) {
            res += "?"
            res += encoderFn(query, false, false)
        }

        if (fragment?.isNotEmpty() == true) {
            res += "#"
            res += encoderFn(fragment, false, false)
        }

        return res
    }

    /**
     * Override equals method
     */
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is URI) return false

        if (scheme != other.scheme) return false
        if (path != other.path) return false

        // Treat authority: null and empty string as the same
        if ((authority == null || authority.isEmpty()) &&
            (other.authority == null || other.authority.isEmpty())
        ) {
            // Both are null or empty string, considered equal
        } else if (authority != other.authority) {
            return false
        }

        // Treat query: null and empty string as the same
        if ((query == null || query.isEmpty()) &&
            (other.query == null || other.query.isEmpty())
        ) {
            // Both are null or empty string, considered equal
        } else if (query != other.query) {
            return false
        }

        // Treat fragment: null and empty string as the same
        if ((fragment == null || fragment.isEmpty()) &&
            (other.fragment == null || other.fragment.isEmpty())
        ) {
            // Both are null or empty string, considered equal
        } else if (fragment != other.fragment) {
            return false
        }

        return true
    }

    /**
     * Override hashCode method
     */
    override fun hashCode(): Int {
        var result = scheme.hashCode()
        if (authority != null && authority != "") {
            result = 31 * result + authority.hashCode()
        }
        result = 31 * result + path.hashCode()
        if (query != null && query != "") {
            result = 31 * result + query.hashCode()
        }
        if (fragment != null && fragment != "") {
            result = 31 * result + fragment.hashCode()
        }
        return result
    }
}

/**
 * Calculate URI's fsPath
 * Corresponds to uriToFsPath in VSCode
 *
 * @param uri URI object
 * @param keepDriveLetterCasing Whether to keep drive letter casing
 * @return File system path
 */
private fun uriToFsPath(uri: URI, keepDriveLetterCasing: Boolean): String {
    val value: String
    val isWindows = System.getProperty("os.name").lowercase().contains("windows")

    if (uri.authority?.isNotEmpty() == true && uri.path.length > 1 && uri.scheme == "file") {
        // UNC path: file://shares/c$/far/boo
        value = "//${uri.authority}${uri.path}"
    } else if (
        uri.path.isNotEmpty() &&
        uri.path[0] == '/' &&
        uri.path.length >= 3 &&
        ((uri.path[1] in 'A'..'Z') || (uri.path[1] in 'a'..'z')) &&
        uri.path[2] == ':'
    ) {
        if (!keepDriveLetterCasing) {
            // Windows drive path: file:///c:/far/boo
            value = uri.path[1].lowercaseChar() + uri.path.substring(2)
        } else {
            value = uri.path.substring(1)
        }
    } else {
        // Other paths
        value = uri.path
    }

    return if (isWindows) {
        value.replace('/', '\\')
    } else {
        value
    }
}

/**
 * Handle missing scheme
 * Corresponds to _schemeFix in VSCode
 *
 * @param scheme Original scheme
 * @param strict Strict mode
 * @return Fixed scheme
 */
private fun schemeFix(scheme: String, strict: Boolean): String {
    return if (scheme.isEmpty() && !strict) {
        "file"
    } else {
        scheme
    }
}

/**
 * Parse reference path
 * Corresponds to _referenceResolution in VSCode
 *
 * @param scheme Protocol
 * @param path Path
 * @return Processed path
 */
private fun referenceResolution(scheme: String, path: String): String {
    var result = path
    when (scheme) {
        "https", "http", "file" -> {
            if (result.isEmpty()) {
                result = "/"
            } else if (result[0] != '/') {
                result = "/$result"
            }
        }
    }
    return result
}

/**
 * Fast encode URI component
 * Corresponds to encodeURIComponentFast in VSCode
 *
 * @param uriComponent URI component
 * @param isPath Whether is path
 * @param isAuthority Whether is authority
 * @return Encoded string
 */
private fun encodeURIComponentFast(uriComponent: String, isPath: Boolean, isAuthority: Boolean): String {
    var result: String? = null
    var nativeEncodePos = -1

    for (pos in uriComponent.indices) {
        val code = uriComponent[pos].code

        // Characters that do not need encoding: a-z, A-Z, 0-9, -, ., _, ~, /, [, ], :
        if ((code in 97..122) || // a-z
            (code in 65..90) || // A-Z
            (code in 48..57) || // 0-9
            code == 45 || // -
            code == 46 || // .
            code == 95 || // _
            code == 126 || // ~
            (isPath && code == 47) || // /
            (isAuthority && code == 91) || // [
            (isAuthority && code == 93) || // ]
            (isAuthority && code == 58) // :
        ) {
            // Check if delayed encoding
            if (nativeEncodePos != -1) {
                result = (result ?: uriComponent.substring(0, nativeEncodePos)) +
                    java.net.URLEncoder.encode(uriComponent.substring(nativeEncodePos, pos), "UTF-8")
                        .replace("+", "%20")
                nativeEncodePos = -1
            }

            // Check if writing new string
            if (result != null) {
                result += uriComponent[pos]
            }
        } else {
            // Need encoding
            if (result == null) {
                result = uriComponent.substring(0, pos)
            }

            // Check if using native encoding
            if (nativeEncodePos == -1) {
                nativeEncodePos = pos
            }
        }
    }

    if (nativeEncodePos != -1) {
        result = (result ?: "") +
            java.net.URLEncoder.encode(uriComponent.substring(nativeEncodePos), "UTF-8")
                .replace("+", "%20")
    }

    return result ?: uriComponent
}

/**
 * Minimal encode URI component
 * Corresponds to encodeURIComponentMinimal in VSCode
 *
 * @param path Path
 * @param isPath Whether is path (ignored)
 * @param isAuthority Whether is authority (ignored)
 * @return Encoded string
 */
private fun encodeURIComponentMinimal(path: String, isPath: Boolean = false, isAuthority: Boolean = false): String {
    var result: String? = null

    for (pos in path.indices) {
        val code = path[pos].code

        if (code == 35 || code == 63) { // # or ?
            if (result == null) {
                result = path.substring(0, pos)
            }
            result += when (code) {
                35 -> "%23" // #
                63 -> "%3F" // ?
                else -> throw IllegalStateException("Unexpected code: $code")
            }
        } else {
            if (result != null) {
                result += path[pos]
            }
        }
    }

    return result ?: path
}
