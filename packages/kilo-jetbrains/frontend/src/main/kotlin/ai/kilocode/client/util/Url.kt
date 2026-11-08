package ai.kilocode.client.util

import java.net.URI
import java.net.URISyntaxException

/**
 * Whether [value] is an absolute `http`/`https` URL with a host.
 *
 * MCP authorization URLs and OAuth redirect URIs are supplied by the remote server, so they must be
 * checked before they reach a browser or the config file. Handing an arbitrary scheme to
 * `BrowserUtil.browse` lets a server open `file:///…`, `smb://…`, or `javascript:…` on the user's
 * machine, so only the two schemes an OAuth endpoint can legitimately use are accepted.
 *
 * Parsed rather than prefix-matched so that case, embedded credentials, and a missing host are all
 * handled by the URI parser instead of by hand.
 */
internal fun webUrl(value: String): Boolean {
    val uri = try {
        URI(value.trim())
    } catch (_: URISyntaxException) {
        return false
    }
    val scheme = uri.scheme?.lowercase() ?: return false
    if (scheme != "http" && scheme != "https") return false
    return !uri.host.isNullOrBlank()
}
