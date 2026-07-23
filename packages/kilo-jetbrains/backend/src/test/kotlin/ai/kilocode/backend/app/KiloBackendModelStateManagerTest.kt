package ai.kilocode.backend.app

import ai.kilocode.backend.cli.KiloBackendHttpClients
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.ModelFavoriteUpdateDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.ModelSelectionUpdateDto
import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import kotlin.io.path.createTempDirectory
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class KiloBackendModelStateManagerTest {
    private val mock = MockCliServer()
    private val log = TestLog()
    private val dir = createTempDirectory("kilo-model-state-test")
    private val http = KiloBackendHttpClients.api(mock.password)

    @AfterTest
    fun tearDown() {
        KiloBackendHttpClients.shutdown(http)
        mock.close()
        Files.walk(dir).sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
    }

    @Test
    fun `state loads favorites from cli model json`() = runBlocking {
        val port = start()
        dir.resolve("model.json").writeText("""{"favorite":[{"providerID":"kilo","modelID":"auto"}],"recent":[{"providerID":"anthropic","modelID":"claude"}],"model":{"code":{"providerID":"openai","modelID":"gpt"}},"variant":{"openai/gpt":"high"}}""")
        val mgr = KiloBackendModelStateManager(log)
        mgr.start(http, port)

        val state = mgr.state()

        assertEquals(1, state.favorite.size)
        assertEquals("kilo", state.favorite[0].providerID)
        assertEquals("auto", state.favorite[0].modelID)
        assertEquals("gpt", state.model["code"]?.modelID)
        assertEquals(listOf("anthropic/claude"), state.recent.map { "${it.providerID}/${it.modelID}" })
        assertEquals(1, mock.requestCount("/path"))
    }

    @Test
    fun `favorite update writes parser built model json`() = runBlocking {
        val port = start()
        dir.resolve("model.json").writeText(
            """{"model":{"code":{"providerID":"kilo","modelID":"auto"}},"recent":[{"providerID":"openai","modelID":"gpt"}],"variant":{"kilo/auto":false},"favorite":[]}""",
        )
        val mgr = KiloBackendModelStateManager(log)
        mgr.start(http, port)

        val state = mgr.favorite(ModelFavoriteUpdateDto("add", "anthropic", "claude"))
        val raw = dir.resolve("model.json").readText()

        assertEquals(listOf("anthropic/claude"), state.favorite.map { "${it.providerID}/${it.modelID}" })
        assertTrue(raw.contains("\"model\""), raw)
        assertTrue(raw.contains("\"recent\""), raw)
        assertTrue(raw.contains("\"kilo/auto\": false"), raw)
        assertTrue(raw.contains("claude"), raw)
    }

    @Test
    fun `selection update writes model json`() = runBlocking {
        val port = start()
        dir.resolve("model.json").writeText("""{"favorite":[],"recent":[]}""")
        val mgr = KiloBackendModelStateManager(log)
        mgr.start(http, port)

        val state = mgr.selection(ModelSelectionUpdateDto("code", "kilo", "auto"))
        val raw = dir.resolve("model.json").readText()

        assertEquals("auto", state.model["code"]?.modelID)
        assertEquals(emptyList<ModelSelectionDto>(), state.recent)
        assertTrue(raw.contains("\"model\""), raw)
        assertTrue(raw.contains("\"recent\""), raw)
    }

    @Test
    fun `clear selection removes agent model`() = runBlocking {
        val port = start()
        dir.resolve("model.json").writeText("""{"model":{"code":{"providerID":"kilo","modelID":"auto"},"plan":{"providerID":"openai","modelID":"gpt"}}}""")
        val mgr = KiloBackendModelStateManager(log)
        mgr.start(http, port)

        val state = mgr.clear("code")

        assertTrue("code" !in state.model)
        assertEquals("gpt", state.model["plan"]?.modelID)
    }

    @Test
    fun `malformed model json returns empty favorites`() = runBlocking {
        val port = start()
        dir.resolve("model.json").writeText("not-json")
        val mgr = KiloBackendModelStateManager(log)
        mgr.start(http, port)

        assertTrue(mgr.state().favorite.isEmpty())
    }

    private fun start(): Int {
        val path = dir.toString().replace("\\", "/")
        mock.path = """{"home":"$path","state":"$path","config":"$path","worktree":"$path","directory":"$path"}"""
        return mock.start()
    }
}
