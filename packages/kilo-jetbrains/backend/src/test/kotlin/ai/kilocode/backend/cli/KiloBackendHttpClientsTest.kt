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
    fun `api client has no call or read timeout`() {
        val client = KiloBackendHttpClients.api("test")
        try {
            assertEquals(0, client.callTimeoutMillis)
            assertEquals(0, client.readTimeoutMillis)
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
    fun `health client has short timeout`() {
        val client = KiloBackendHttpClients.health("test")
        try {
            assertEquals(3000, client.callTimeoutMillis)
            assertEquals(3000, client.connectTimeoutMillis)
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
}
