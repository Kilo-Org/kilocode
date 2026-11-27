package ai.kilocode.backend.app

import ai.kilocode.backend.v2.V2Client
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException
import java.net.InetSocketAddress
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class KiloConnectionServiceTest {
    @Test
    fun `EOF forwards the native stream in order and releases connection owned work`() = runBlocking {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/api/event") { exchange ->
            exchange.responseHeaders.set("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.writer().use { out ->
                out.write("data: {\"type\":\"server.connected\",\"data\":{}}\n\n")
                out.write("data: {\"type\":\"config.updated\",\"data\":{}}\n\n")
            }
        }
        server.start()
        try {
            withTimeout(10_000) {
                val connection = KiloBackendConnectionService()
                val events = async(start = CoroutineStart.UNDISPATCHED) { connection.events.take(2).toList() }
                val released = CompletableDeferred<Unit>()
                assertFailsWith<IOException> {
                    V2Client("http://127.0.0.1:${server.address.port}", "Basic fixture").use { client ->
                        connection.listen(client) {
                            try { awaitCancellation() } finally { released.complete(Unit) }
                        }
                    }
                }
                assertTrue(released.isCompleted)
                assertEquals(listOf("server.connected", "config.updated"), events.await().map { it.getValue("type").jsonPrimitive.content })
            }
        } finally {
            server.stop(0)
        }
    }
}
