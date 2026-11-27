package ai.kilocode.backend.v2

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URLDecoder
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class V2ClientTest {
    @Test
    fun `calls a generated operation with encoded path, location and raw envelope`() = runBlocking {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val request = mutableListOf<String>()
        server.createContext("/") { exchange ->
            request.addAll(listOf(exchange.requestMethod, exchange.requestURI.rawPath,
                URLDecoder.decode(exchange.requestURI.rawQuery, Charsets.UTF_8),
                exchange.requestHeaders.getFirst("Authorization"), exchange.requestBody.reader().readText()))
            val response = """{"data":{"ok":true}}""".toByteArray()
            exchange.sendResponseHeaders(200, response.size.toLong())
            exchange.responseBody.use { it.write(response) }
        }
        server.start()
        val client = V2Client("http://127.0.0.1:${server.address.port}", "Basic fixture")
        try {
            val response = client.call("rpc.call", mapOf("rpcID" to "kilocode.test", "method" to "one/two"),
                mapOf("location[directory]" to "/a + b"), JsonPrimitive("input"))
            assertEquals(Json.parseToJsonElement("""{"data":{"ok":true}}"""), response)
            assertEquals(listOf("POST", "/api/rpc/kilocode.test/one%2Ftwo", "location[directory]=/a + b",
                "Basic fixture", "\"input\""), request)
        } finally {
            client.close()
            server.stop(0)
        }
    }

    @Test
    fun `propagates errors and drains native SSE through EOF`() = runBlocking {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/api/info") { exchange ->
            exchange.sendResponseHeaders(503, 0)
            exchange.responseBody.use { it.write("unavailable".toByteArray()) }
        }
        server.createContext("/api/session") { exchange ->
            exchange.sendResponseHeaders(204, -1)
            exchange.close()
        }
        server.createContext("/api/event") { exchange ->
            exchange.responseHeaders.add("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.writer().use { it.write("data: {\"type\":\"server.connected\"}\n\n") }
        }
        server.start()
        val client = V2Client("http://127.0.0.1:${server.address.port}", "Basic fixture")
        try {
            val failure = assertFailsWith<V2HttpException> { client.call("server.info") }
            assertEquals(503, failure.status)
            assertEquals("unavailable", failure.body)
            assertEquals(JsonNull, client.call("session.update", mapOf("sessionID" to "fixture")))
            assertEquals(JsonPrimitive("server.connected"), client.events().toList().single()["type"])
        } finally {
            client.close()
            server.stop(0)
        }
    }
}
