import java.net.HttpURLConnection
import java.net.URI

/**
 * HTTP settings shared by the build tasks that talk to GitHub.
 *
 * The tasks live in this one module, so the values belong here rather than inline in each task: a change to a
 * timeout or to a media type then reaches every task that sends it.
 */
internal object GitHubHttp {
    const val CONNECT_TIMEOUT_MS = 30_000
    const val READ_TIMEOUT_MS = 120_000
    const val USER_AGENT = "Kilo-JetBrains-Gradle"

    /** Media type for release metadata calls. */
    const val METADATA_ACCEPT = "application/vnd.github+json"

    /** Media type for release asset downloads. */
    const val ASSET_ACCEPT = "application/octet-stream"

    /** Starts a connection with the shared timeouts and redirect handling, before any request header is set. */
    fun open(url: String): HttpURLConnection =
        (URI(url).toURL().openConnection() as HttpURLConnection).apply {
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            // Release downloads and the API both answer with a redirect, so the tasks need this; no call adds a
            // cross-host hop of its own.
            instanceFollowRedirects = true
        }
}
