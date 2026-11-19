package ai.kilocode.backend.app

import ai.kilocode.backend.v2.V2Client
import ai.kilocode.backend.v2.V2HttpException
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import org.junit.Test

class KiloBackendRetentionTest {
    @Test
    fun `missing alpha RPC is unsupported and a forced run never falls back to session removal`() = runBlocking {
        for (reason in listOf("rpc.unavailable", "rpc.method_not_found")) {
            Server { _, _ -> 400 to """{"_tag":"RpcError","type":"$reason","message":"missing"}""" }.use {
                val endpoint = RetentionEndpoint(it.client, "fixture-release")
                assertFalse(endpoint.status().supported)
                assertFailsWith<IllegalStateException> { endpoint.run(true) }
                assertEquals(listOf(status, status), it.calls)
            }
        }
    }

    @Test
    fun `readable status and enabled policy alone never authorize cleanup`() = runBlocking {
        for (pin in listOf(null, "other-release")) {
            Server { path, _ -> 200 to if (path == status) enabled else identity }.use {
                val endpoint = RetentionEndpoint(it.client, pin)
                assertFailsWith<IllegalStateException> { endpoint.run(true) }
                assertFalse(it.calls.contains(run))
            }
        }
    }

    @Test
    fun `forced run cannot override disabled policy or write settings`() = runBlocking {
        Server { path, _ -> 200 to if (path == status) disabled else identity }.use {
            val result = RetentionEndpoint(it.client, "fixture-release").run(true)
            assertTrue(result.supported)
            assertFalse(result.policy.enabled)
            assertEquals(listOf(status, handshake), it.calls)
        }
    }

    @Test
    fun `vetted server receives a single confirmed native run and supplies its result`() = runBlocking {
        Server { path, body -> when (path) {
            handshake -> 200 to identity
            status -> 200 to enabled
            run -> if (body == """{"input":{"force":true}}""") 200 to completed else 422 to "{}"
            else -> 404 to "{}"
        } }.use {
            val endpoint = RetentionEndpoint(it.client, "fixture-release")
            val result = endpoint.run(true)
            assertEquals(2, result.last?.deleted)
            assertEquals(1, result.last?.skippedActive)
            assertEquals(listOf(status, handshake, run), it.calls)
        }
    }

    @Test
    fun `authentication and malformed consent fail closed instead of appearing unsupported`() = runBlocking {
        Server { _, _ -> 401 to "{}" }.use {
            assertFailsWith<V2HttpException> { RetentionEndpoint(it.client, "fixture-release").run(true) }
            assertEquals(listOf(status), it.calls)
        }
        Server { path, _ -> 200 to if (path == status) enabled.replace("true", "\"true\"") else identity }.use {
            assertFailsWith<IllegalArgumentException> { RetentionEndpoint(it.client, "fixture-release").run(true) }
            assertFalse(it.calls.contains(run))
        }
    }

    private class Server(reply: (String, String) -> Pair<Int, String>) : AutoCloseable {
        val calls = CopyOnWriteArrayList<String>()
        private val http = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
            createContext("/") { exchange ->
                val path = exchange.requestURI.toString()
                calls.add(path)
                val (code, response) = reply(path, exchange.requestBody.reader().use { it.readText() })
                val bytes = response.toByteArray()
                exchange.sendResponseHeaders(code, bytes.size.toLong())
                exchange.responseBody.use { it.write(bytes) }
            }
            start()
        }
        val client = V2Client("http://127.0.0.1:${http.address.port}", "Basic fixture")
        override fun close() { client.close(); http.stop(0) }
    }

    private companion object {
        const val status = "/api/rpc/kilocode.retention/status"
        const val run = "/api/rpc/kilocode.retention/run"
        const val handshake = "/api/rpc/kilocode.handshake/get"
        const val identity = """{"output":{"product":"kilo","version":"fixture-release","channel":"fixture"}}"""
        const val enabled = """{"output":{"policy":{"enabled":true,"maxAgeDays":30}}}"""
        const val disabled = """{"output":{"policy":{"enabled":false,"maxAgeDays":30}}}"""
        const val completed = """{"output":{"policy":{"enabled":true,"maxAgeDays":30},"last":{"at":1800000000000,"scanned":5,"deleted":2,"skippedActive":1,"failed":0,"durationMs":20}}}"""
    }
}
