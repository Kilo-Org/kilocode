package ai.kilocode.backend.workspace

import ai.kilocode.backend.v2.V2Client
import ai.kilocode.rpc.dto.AgentConfigPatchDto
import ai.kilocode.rpc.dto.CompactionPatchDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.PermissionRuleDto
import ai.kilocode.rpc.dto.WorkspaceFileDto
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.net.InetSocketAddress
import java.net.URLDecoder
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class KiloBackendWorkspaceTest {
    @Test
    fun `file search scopes the v2 query and hides managed storage`() = fixture({ exchange ->
        assertEquals("/api/fs/find", exchange.requestURI.path)
        val query = URLDecoder.decode(exchange.requestURI.rawQuery, Charsets.UTF_8)
        assertTrue("location[directory]=/a project" in query && "query=src" in query && "limit=3" in query)
        """{"location":{"directory":"/a project"},"data":[{"path":"src/","type":"directory"},{"path":"src/F.kt","type":"file"},{"path":".kilo2/worktrees/tmp/src","type":"directory"}]}"""
    }) { data ->
        assertEquals(listOf(WorkspaceFileDto("src", "src", true), WorkspaceFileDto("src/F.kt", "F.kt")), data.files("src", 3))
    }

    @Test
    fun `writes canonical config with revision and preserves unrelated ordered rules`() {
        val original = """{"agents":{"test":{"model":{"providerID":"alpha","model":"sub/model","variant":"low"}}},"permissions":[{"action":"shell","resource":"*","effect":"ask"},{"action":"*","resource":"*.env","effect":"deny"},{"action":"read","resource":"*","effect":"allow"}]}"""
        val updated = """{"snapshots":false,"agents":{"test":{"model":"alpha/sub/model#high"}},"compaction":{"buffer":"15%"}}"""
        var document = original
        fixture({ request -> when (request.requestURI.path) {
            "/api/config" -> """[{"type":"directory","path":"/area"},{"type":"document","path":"/a project/kilo2.json","info":$original}]"""
            "/api/rpc/kilocode.settings/read" -> {
                val input = Json.parseToJsonElement(request.requestBody.reader().readText()).jsonObject.getValue("input").jsonObject
                if (input.text("scope") == "global") """{"output":{"scope":"global","target":{"path":"/global/kilo2.json","exists":false},"document":{}}}"""
                else """{"output":{"scope":"project","target":{"path":"/a project/kilo2.json","exists":true,"revision":"rev"},"document":$document}}"""
            }
            "/api/rpc/kilocode.settings/write" -> {
                val input = Json.parseToJsonElement(request.requestBody.reader().readText()).jsonObject.getValue("input").jsonObject
                assertEquals(JsonPrimitive("project"), input["scope"])
                assertEquals(JsonPrimitive("rev"), input.obj("expected")?.get("revision"))
                val set = input.getValue("set").jsonObject
                assertEquals(JsonPrimitive(false), set["snapshots"])
                assertEquals(JsonPrimitive("alpha/sub/model#high"), set.obj("agents")?.obj("test")?.get("model"))
                assertEquals(JsonPrimitive("15%"), set.obj("compaction")?.get("buffer"))
                val rules = set.getValue("permissions").jsonArray.map { it.jsonObject }
                assertEquals(listOf("shell", "*", "read"), rules.map { it.required("action") })
                assertEquals(listOf("allow", "deny", "allow"), rules.map { it.required("effect") })
                document = updated
                """{"output":{"changed":true}}"""
            }
            else -> error("Unexpected ${request.requestURI}")
        } }) { data ->
            val config = data.updateConfig(ConfigPatchDto(snapshot = false, agents = mapOf("test" to AgentConfigPatchDto(variant = "high")),
                permission = mapOf("shell" to PermissionRuleDto.Level("allow")), compaction = CompactionPatchDto(threshold_percent = 85.0)))
            assertEquals(false, config.snapshot)
            assertEquals(85.0, config.compaction?.threshold_percent)
            assertEquals("alpha/sub/model", config.agent["test"]?.model)
            assertEquals("high", config.agent["test"]?.variant)
        }
    }

    @Test
    fun `cannot evict an active worktree when checking deletion safety`() {
        val seen = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
        fixture({ request ->
            seen.add(request.requestURI.path)
            when (request.requestURI.path) {
                "/api/session" -> """{"data":[{"id":"active-child"}],"cursor":{}}"""
                "/api/session/active" -> """{"data":{"active-child":{}}}"""
                "/api/permission/request", "/api/form" -> """{"location":{"directory":"/a project"},"data":[]}"""
                else -> error("Unexpected ${request.requestURI}")
            }
        }) { data -> assertFailsWith<IllegalStateException> { data.prepareRemoval() } }
        assertTrue("/api/debug/location" !in seen)
    }

    private fun fixture(response: (HttpExchange) -> String, check: suspend (KiloWorkspaceData) -> Unit) {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val errors = java.util.concurrent.ConcurrentLinkedQueue<Throwable>()
        server.createContext("/") { request ->
            request.use {
                val result = runCatching { response(request) }.onFailure { errors.add(it) }
                val bytes = result.getOrElse { "{}" }.toByteArray()
                request.sendResponseHeaders(if (result.isSuccess) 200 else 500, bytes.size.toLong())
                request.responseBody.write(bytes)
            }
        }
        server.start()
        try { runBlocking { check(KiloWorkspaceData(V2Client("http://127.0.0.1:${server.address.port}", "Basic fixture"), "/a project")) } }
        finally { server.stop(0); errors.peek()?.let { throw it } }
    }
}
