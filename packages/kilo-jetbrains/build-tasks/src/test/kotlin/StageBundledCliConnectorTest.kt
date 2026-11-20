import com.sun.net.httpserver.HttpServer
import java.io.File
import org.gradle.api.GradleException
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class StageBundledCliConnectorTest {
    @Test
    fun assetConnectorNeverSendsAuthorization() {
        withServer { url, received ->
            val conn = StageBundledCliTask.assetConnector("$url/asset")
            assertConnectorDefaults(conn)
            send(conn, received)
            assertNull(received.authorization, "release asset download must not send Authorization")
            assertEquals(listOf(GitHubHttp.ASSET_ACCEPT), received.values("Accept"))
            assertEquals(listOf(GitHubHttp.USER_AGENT), received.values("User-Agent"))
        }
    }

    @Test
    fun assetConnectorDoesNotReadTheConfiguredToken() {
        // The regression that matters: a token IS configured and metadata stays authenticated, while the asset
        // download must still leave without the header.
        withServer { url, received ->
            val token = "ghp_asset_connector_must_ignore_me"
            send(StageBundledCliTask.metadataConnector(token, "$url/metadata"), received)
            assertEquals("Bearer $token", received.authorization)

            send(StageBundledCliTask.assetConnector("$url/asset"), received)
            assertNull(received.authorization, "asset connector sent Authorization even though it takes no token")
        }
    }

    @Test
    fun metadataConnectorSendsBearerToken() {
        withServer { url, received ->
            val conn = StageBundledCliTask.metadataConnector("  ghp_metadata_token  ", "$url/metadata")
            assertConnectorDefaults(conn)
            send(conn, received)
            assertEquals("Bearer ghp_metadata_token", received.authorization)
            assertEquals(listOf(GitHubHttp.METADATA_ACCEPT), received.values("Accept"))
        }
    }

    @Test
    fun metadataConnectorOmitsAuthorizationWithoutToken() {
        withServer { url, received ->
            val cases = mapOf("null token" to null, "blank token" to "", "whitespace token" to " \t\n ")
            for ((label, token) in cases) {
                send(StageBundledCliTask.metadataConnector(token, "$url/metadata"), received)
                assertNull(received.authorization, "metadata connector sent Authorization for $label")
                assertEquals(listOf(GitHubHttp.METADATA_ACCEPT), received.values("Accept"), "Accept for $label")
            }
        }
    }

    @Test
    fun fetchReusesAMatchingFileWithoutRequesting() {
        withServer { url, received ->
            val file = File.createTempFile("kilo-fetch", ".bin")
            try {
                file.writeText("ok")
                val digest = StageBundledCliTask.sum(file)
                StageBundledCliTask.fetchAsset(StageBundledCliTask::assetConnector, "$url/asset", "download failed", digest, file)
                assertEquals(0, received.calls, "a matching file is reused without a request")
            } finally {
                file.delete()
            }
        }
    }

    @Test
    fun fetchAssetDownloadsThroughTheAssetConnectorAndVerifiesTheDigest() {
        // Drives the same function fetch() calls, so skipping the download or sending it through a connector that
        // adds a request header fails here. Digest verification is covered by the mismatch test below, and which
        // connector fetch() binds is covered by the task's captured run in the PR body.
        withServer { url, received ->
            val file = File.createTempFile("kilo-fetch", ".bin")
            try {
                file.delete()
                val source = File.createTempFile("kilo-src", ".bin")
                val digest = try {
                    source.writeText("ok")
                    StageBundledCliTask.sum(source)
                } finally {
                    source.delete()
                }
                StageBundledCliTask.fetchAsset(StageBundledCliTask::assetConnector, "$url/asset", "download failed", digest, file)
                assertNull(received.authorization, "the download must not send Authorization")
                assertEquals(listOf(GitHubHttp.ASSET_ACCEPT), received.values("Accept"))
                assertEquals("ok", file.readText())
                assertEquals(digest, StageBundledCliTask.sum(file))
            } finally {
                file.delete()
            }
        }
    }

    @Test
    fun fetchAssetRejectsAFileThatDoesNotMatchItsDigest() {
        withServer { url, _ ->
            val file = File.createTempFile("kilo-fetch", ".bin")
            try {
                file.delete()
                val wrong = "sha256:" + "0".repeat(64)
                val failure = runCatching {
                    StageBundledCliTask.fetchAsset(StageBundledCliTask::assetConnector, "$url/asset", "download failed", wrong, file)
                }.exceptionOrNull()
                assertTrue(failure is GradleException, "a digest mismatch must fail the task")
                assertTrue(failure.message.orEmpty().contains("digest mismatch"), failure.message.orEmpty())
            } finally {
                file.delete()
            }
        }
    }

    private fun assertConnectorDefaults(conn: HttpURLConnection) {
        assertTrue(conn.instanceFollowRedirects, "release downloads follow redirects")
        assertEquals(GitHubHttp.CONNECT_TIMEOUT_MS, conn.connectTimeout)
        assertEquals(GitHubHttp.READ_TIMEOUT_MS, conn.readTimeout)
    }

    /**
     * Headers one request delivered to the loopback server. Names match case-insensitively; the authorization value
     * is null only when the peer received no such header, which is the property under test.
     */
    private class Received {
        var headers: Map<String, List<String>> = emptyMap()
        var calls = 0

        fun values(name: String): List<String>? =
            headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value

        val authorization: String? get() = values("Authorization")?.single()
    }

    /**
     * Sends the connector's request to a real loopback HTTP server and asserts on the headers the server received.
     *
     * The client side cannot answer this: urlconnection.getRequestProperty and getRequestProperties strip
     * java.net.URLConnection's EXCLUDE_HEADERS ("Authorization", "Proxy-Authorization") whether or not the header was
     * set, so both report null/absent either way. What the peer receives is the only observable proving absence.
     */
    private fun send(conn: HttpURLConnection, received: Received) {
        received.calls = 0
        received.headers = emptyMap()
        try {
            assertEquals(200, conn.responseCode)
            conn.inputStream.use { it.readBytes() }
        } finally {
            conn.disconnect()
        }
        assertEquals(1, received.calls, "expected exactly one request")
    }

    private fun <T> withServer(block: (String, Received) -> T): T {
        val received = Received()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange ->
            received.calls++
            received.headers = exchange.requestHeaders.entries.associate { (name, values) -> name to values }
            val body = "ok".toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.start()
        try {
            return block("http://127.0.0.1:${server.address.port}", received)
        } finally {
            server.stop(0)
        }
    }
}
