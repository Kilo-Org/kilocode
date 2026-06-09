package ai.kilocode.backend.telemetry

import ai.kilocode.backend.cli.KiloBackendHttpClients
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import java.util.concurrent.TimeUnit

class KiloBackendTelemetryTest {
    @Test
    fun `capture posts to telemetry endpoint with auth`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("{}"))
        server.start()
        val http = KiloBackendHttpClients.api("secret")
        try {
            KiloBackendTelemetry().capture(http, server.port, "Test Event", mapOf("source" to "test"))

            val req = server.takeRequest()
            assertEquals("/telemetry/capture", req.path)
            assertTrue(req.getHeader("Authorization")?.startsWith("Basic ") == true)
            val body = req.body.readUtf8()
            assertTrue(body.contains("\"event\":\"Test Event\""))
            assertTrue(!body.contains("JetBrains"))
            assertTrue(body.contains("\"platform\":\"jetbrains\""))
            assertTrue(!body.contains("appName"))
            assertTrue(body.contains("source"))
        } finally {
            KiloBackendHttpClients.shutdown(http)
            server.shutdown()
        }
    }

    @Test
    fun `set enabled posts to telemetry endpoint`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("{}"))
        server.start()
        val http = KiloBackendHttpClients.api("secret")
        try {
            KiloBackendTelemetry().setEnabled(http, server.port, true)

            val req = server.takeRequest()
            assertEquals("/telemetry/setEnabled", req.path)
            assertTrue(req.body.readUtf8().contains("enabled"))
        } finally {
            KiloBackendHttpClients.shutdown(http)
            server.shutdown()
        }
    }

    @Test
    fun `capture failure does not throw`() = runBlocking {
        KiloBackendTelemetry().capture(null, 0, "Test Event", emptyMap())
    }

    @Test
    fun `dev mode does not post capture`() = runBlocking {
        System.setProperty("idea.plugin.in.sandbox.mode", "true")
        val server = MockWebServer()
        server.start()
        val http = KiloBackendHttpClients.api("secret")
        try {
            KiloBackendTelemetry().capture(http, server.port, "Test Event", emptyMap())

            assertEquals(null, server.takeRequest(100, TimeUnit.MILLISECONDS))
        } finally {
            System.clearProperty("idea.plugin.in.sandbox.mode")
            KiloBackendHttpClients.shutdown(http)
            server.shutdown()
        }
    }
}
