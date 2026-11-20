import com.sun.net.httpserver.HttpServer
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
            assertEquals(listOf(StageBundledCliTask.ASSET_ACCEPT), received.values("Accept"))
            assertEquals(listOf(StageBundledCliTask.USER_AGENT), received.values("User-Agent"))
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
            assertEquals(listOf(StageBundledCliTask.METADATA_ACCEPT), received.values("Accept"))
        }
    }

    @Test
    fun metadataConnectorOmitsAuthorizationWithoutToken() {
        withServer { url, received ->
            val cases = mapOf("null token" to null, "blank token" to "", "whitespace token" to " \t\n ")
            for ((label, token) in cases) {
                send(StageBundledCliTask.metadataConnector(token, "$url/metadata"), received)
                assertNull(received.authorization, "metadata connector sent Authorization for $label")
                assertEquals(listOf(StageBundledCliTask.METADATA_ACCEPT), received.values("Accept"), "Accept for $label")
            }
        }
    }

    private fun assertConnectorDefaults(conn: HttpURLConnection) {
        assertTrue(conn.instanceFollowRedirects, "release downloads follow redirects")
        assertEquals(StageBundledCliTask.CONNECT_TIMEOUT_MS, conn.connectTimeout)
        assertEquals(StageBundledCliTask.READ_TIMEOUT_MS, conn.readTimeout)
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

        val authorization: String? get() = values("Authorization")?.singleOrNull()
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
