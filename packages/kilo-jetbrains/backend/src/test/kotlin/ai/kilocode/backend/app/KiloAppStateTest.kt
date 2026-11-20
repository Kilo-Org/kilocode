package ai.kilocode.backend.app

import ai.kilocode.backend.v2.V2Client
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.LoadProgressDto
import ai.kilocode.rpc.dto.ProfileStatusDto
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class KiloAppStateTest {
    @Test
    fun `cold location becomes ready with global settings and without a gateway account`() = runBlocking {
        val reads = AtomicInteger()
        val state = load { path -> when (path) {
            "/api/plugin" -> 200 to if (reads.incrementAndGet() == 1) """{"data":[]}""" else inventory
            "/api/rpc/kilocode.settings/read" -> 200 to """{"output":{"document":{"default_agent":"architect"}}}"""
            "/api/rpc/kilocode.gateway/authStatus" -> 200 to """{"output":{"authenticated":false}}"""
            "/api/rpc/kilocode.gateway/notifications" -> 200 to """{"output":[]}"""
            else -> 404 to "{}"
        } }
        assertEquals(KiloAppStatusDto.READY, state.status)
        assertEquals("architect", state.config?.defaultAgent)
        assertEquals(LoadProgressDto(true, true, ProfileStatusDto.NOT_LOGGED_IN), state.progress)
        assertTrue(state.backgroundSubagents)
        assertEquals(2, reads.get())
    }

    @Test
    fun `failed settings read is retried and puts the resource in the split error state`() = runBlocking {
        val reads = AtomicInteger()
        val state = load { path -> when (path) {
            "/api/plugin" -> 200 to inventory
            "/api/rpc/kilocode.settings/read" -> { reads.incrementAndGet(); 503 to "{}" }
            "/api/rpc/kilocode.gateway/authStatus" -> 401 to "{}"
            "/api/rpc/kilocode.gateway/notifications" -> 200 to """{"output":[]}"""
            else -> 404 to "{}"
        } }
        assertEquals(KiloAppStatusDto.ERROR, state.status)
        assertEquals("config", state.errors.single().resource)
        assertEquals(503, state.errors.single().status)
        assertEquals(3, reads.get())
    }

    private suspend fun load(response: (String) -> Pair<Int, String>): KiloAppStateDto {
        val http = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        http.createContext("/") { exchange ->
            val (status, json) = response(exchange.requestURI.path)
            val bytes = json.toByteArray()
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        http.start()
        try {
            val state = KiloAppState(MutableStateFlow(KiloAppStateDto(KiloAppStatusDto.CONNECTING)))
            V2Client("http://127.0.0.1:${http.address.port}", "Basic fixture").use { state.load(it) }
            return state.flow.value
        } finally {
            http.stop(0)
        }
    }

    private val inventory = listOf("kilocode.settings", "kilocode.gateway", "kilocode.background-jobs")
        .joinToString(prefix = "{\"data\":[", postfix = "]}") { """{"id":"$it","state":{"status":"active"}}""" }
}
