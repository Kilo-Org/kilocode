package ai.kilocode.backend.session

import ai.kilocode.backend.v2.V2Client
import com.sun.net.httpserver.HttpServer
import java.io.IOException
import java.net.InetSocketAddress
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class KiloCloudSessionsTest {
    @Test
    fun `missing RPC disables cloud without attempting download or import`() = runBlocking {
        val calls = mutableListOf<String>()
        peer({ path, _ ->
            calls += path
            400 to """{"type":"rpc.unavailable","message":"RPC is unavailable"}"""
        }) { cloud ->
            assertFalse(cloud.capabilities().available)
            assertTrue(assertFailsWith<IOException> { cloud.importSession("ses_missing") }.message!!.contains("update"))
        }
        assertEquals(listOf("/api/rpc/kilocode.cloud-history/capabilities", "/api/rpc/kilocode.cloud-history/download"), calls)
    }

    @Test
    fun `lists a page then imports a detached transcript into the selected directory`() = runBlocking {
        val dir = "/fixture folder"
        val info = """{"id":"ses_local","title":"Imported","projectID":"fixture","location":{"directory":"$dir"},"time":{"created":1,"updated":2}}"""
        peer({ path, request ->
            val input = Json.parseToJsonElement(request).jsonObject
            200 to when (path) {
                "/api/rpc/kilocode.cloud-history/list" -> {
                    assertEquals("next", input.getValue("input").jsonObject.str("cursor"))
                    """{"output":{"items":[{"sessionID":"ses_cloud","createdAt":1}],"cursor":null}}"""
                }
                "/api/rpc/kilocode.cloud-history/download" -> {
                    assertEquals("ses_cloud", input.getValue("input").jsonObject.str("sessionID"))
                    """{"output":{"info":$info,"messages":[]}}"""
                }
                "/api/experimental/session/import" -> {
                    assertEquals(dir, input.getValue("location").jsonObject.str("directory"))
                    assertEquals("ses_local", input.getValue("info").jsonObject.str("id"))
                    """{"data":$info}"""
                }
                else -> error("Unexpected operation: $path")
            }
        }) { cloud ->
            assertEquals("ses_cloud", cloud.list("next", 10).sessions.single().id)
            assertEquals("ses_local", cloud.importSession("ses_cloud").id)
        }
    }

    private suspend fun peer(reply: (String, String) -> Pair<Int, String>, test: suspend (KiloCloudSessions) -> Unit) {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { request ->
            val (status, body) = try { reply(request.requestURI.path, request.requestBody.reader().readText()) }
            catch (e: Throwable) { 500 to "fixture assertion failed" }
            val bytes = body.toByteArray()
            request.sendResponseHeaders(status, bytes.size.toLong())
            request.responseBody.use { it.write(bytes) }
        }
        server.start()
        try {
            V2Client("http://127.0.0.1:${server.address.port}", "Basic fixture").use { test(KiloCloudSessions(it, "/fixture folder")) }
        } finally { server.stop(0) }
    }
}
