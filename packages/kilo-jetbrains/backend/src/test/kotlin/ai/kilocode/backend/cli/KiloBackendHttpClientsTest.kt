package ai.kilocode.backend.cli

import ai.kilocode.backend.cli.KiloBackendHttpClients
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class KiloBackendHttpClientsTest {

    @Test
    fun `api client sends correct basic auth header`() {
        val pwd = "secret123"
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("ok"))
        server.start()

        val client = KiloBackendHttpClients.api(pwd)
        try {
            val request = okhttp3.Request.Builder()
                .url(server.url("/test"))
                .build()
            client.newCall(request).execute().use { response ->
                assertEquals(200, response.code)
            }

            val recorded = server.takeRequest()
            val expected = "Basic ${Base64.getEncoder().encodeToString("kilo:$pwd".toByteArray())}"
            assertEquals(expected, recorded.getHeader("Authorization"))
        } finally {
            KiloBackendHttpClients.shutdown(client)
            server.shutdown()
        }
    }

    @Test
    fun `api client has no call read or write timeout`() {
        val client = KiloBackendHttpClients.api("test")
        try {
            // All AsyncTimeout-backed timeouts must be 0 (including write, whose OkHttp default is
            // 10s) so no request ever starts the Okio watchdog that would pin the plugin classloader.
            assertEquals(0, client.callTimeoutMillis)
            assertEquals(0, client.readTimeoutMillis)
            assertEquals(0, client.writeTimeoutMillis)
        } finally {
            KiloBackendHttpClients.shutdown(client)
        }
    }

    @Test
    fun `api client has connect timeout`() {
        val client = KiloBackendHttpClients.api("test")
        try {
            assertTrue(client.connectTimeoutMillis > 0)
        } finally {
            KiloBackendHttpClients.shutdown(client)
        }
    }

    @Test
    fun `health client has only a connect timeout`() {
        val client = KiloBackendHttpClients.health("test")
        try {
            // Only connect timeout is kept (JDK socket connect, no AsyncTimeout). Read/write/call are
            // 0 so the health poll never starts Okio's watchdog; the total bound is enforced by the
            // caller via withTimeout + Call.await.
            assertEquals(0, client.callTimeoutMillis)
            assertEquals(3000, client.connectTimeoutMillis)
            assertEquals(0, client.readTimeoutMillis)
            assertEquals(0, client.writeTimeoutMillis)
        } finally {
            KiloBackendHttpClients.shutdown(client)
        }
    }

    @Test
    fun `health client sends correct basic auth header`() {
        val pwd = "healthpwd"
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("ok"))
        server.start()

        val client = KiloBackendHttpClients.health(pwd)
        try {
            val request = okhttp3.Request.Builder()
                .url(server.url("/global/health"))
                .build()
            client.newCall(request).execute().use { response ->
                assertEquals(200, response.code)
            }

            val recorded = server.takeRequest()
            val expected = "Basic ${Base64.getEncoder().encodeToString("kilo:$pwd".toByteArray())}"
            assertEquals(expected, recorded.getHeader("Authorization"))
        } finally {
            KiloBackendHttpClients.shutdown(client)
            server.shutdown()
        }
    }

    @Test
    fun `shutdown evicts connection pool`() {
        val client = KiloBackendHttpClients.api("test")
        KiloBackendHttpClients.shutdown(client)
        assertEquals(0, client.connectionPool.connectionCount())
    }

    @Test
    fun `cli download client keeps only a connect timeout`() {
        val client = KiloBackendHttpClients.cliDownload()
        try {
            // Read/write timeouts are 0 (they would start the Okio watchdog); stall/cancel handling
            // for downloads lives at the coroutine layer in KiloCliDownloader.
            assertEquals(30_000, client.connectTimeoutMillis)
            assertEquals(0, client.readTimeoutMillis)
            assertEquals(0, client.writeTimeoutMillis)
            assertEquals(0, client.callTimeoutMillis)
        } finally {
            KiloBackendHttpClients.shutdown(client)
        }
    }

    @Test
    fun `model fetch client has only a connect timeout`() {
        val client = KiloBackendHttpClients.modelFetch()
        try {
            assertEquals(15_000, client.connectTimeoutMillis)
            // Read/write/call are 0; the total bound is enforced at the call site via withTimeout.
            assertEquals(0, client.readTimeoutMillis)
            assertEquals(0, client.writeTimeoutMillis)
            assertEquals(0, client.callTimeoutMillis)
        } finally {
            KiloBackendHttpClients.shutdown(client)
        }
    }
}
