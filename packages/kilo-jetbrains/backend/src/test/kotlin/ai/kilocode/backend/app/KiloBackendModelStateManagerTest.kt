package ai.kilocode.backend.app

import ai.kilocode.rpc.dto.ModelFavoriteUpdateDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.ModelSelectionUpdateDto
import ai.kilocode.rpc.dto.ModelVariantUpdateDto
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
    private val dir = createTempDirectory("kilo-model-state-test")

    @AfterTest
    fun tearDown() {
        Files.walk(dir).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
    }

    @Test
    fun `state loads favorites and preferences across backend instances`() = runBlocking {
        dir.resolve("model.json").writeText("""{"favorite":[{"providerID":"kilo","modelID":"auto"}],"recent":[{"providerID":"anthropic","modelID":"claude"}],"model":{"code":{"providerID":"openai","modelID":"gpt"}},"variant":{"openai/gpt":"high"}}""")
        val mgr = KiloBackendModelStateManager(dir.resolve("model.json"))

        val state = mgr.state()

        assertEquals(1, state.favorite.size)
        assertEquals("kilo", state.favorite[0].providerID)
        assertEquals("auto", state.favorite[0].modelID)
        assertEquals("gpt", state.model["code"]?.modelID)
        assertEquals("high", state.variant["openai/gpt"])
        assertEquals(listOf("anthropic/claude"), state.recent.map { "${it.providerID}/${it.modelID}" })
    }

    @Test
    fun `favorite update writes parser built model json`() = runBlocking {
        dir.resolve("model.json").writeText(
            """{"model":{"code":{"providerID":"kilo","modelID":"auto"}},"recent":[{"providerID":"openai","modelID":"gpt"}],"variant":{"kilo/auto":"fast"},"favorite":[]}""",
        )
        val mgr = KiloBackendModelStateManager(dir.resolve("model.json"))

        val state = mgr.favorite(ModelFavoriteUpdateDto("add", "anthropic", "claude"))
        val raw = dir.resolve("model.json").readText()

        assertEquals(listOf("anthropic/claude"), state.favorite.map { "${it.providerID}/${it.modelID}" })
        assertTrue(raw.contains("\"model\""), raw)
        assertTrue(raw.contains("\"recent\""), raw)
        assertTrue(raw.contains("\"variant\""), raw)
        assertTrue(raw.contains("claude"), raw)
    }

    @Test
    fun `selection update writes model json`() = runBlocking {
        dir.resolve("model.json").writeText("""{"favorite":[],"recent":[]}""")
        val mgr = KiloBackendModelStateManager(dir.resolve("model.json"))

        val state = mgr.selection(ModelSelectionUpdateDto("code", "kilo", "auto"))
        val raw = dir.resolve("model.json").readText()

        assertEquals("auto", state.model["code"]?.modelID)
        assertEquals(emptyList<ModelSelectionDto>(), state.recent)
        assertTrue(raw.contains("\"model\""), raw)
        assertTrue(raw.contains("\"recent\""), raw)
    }

    @Test
    fun `variant update writes model json`() = runBlocking {
        dir.resolve("model.json").writeText("{}")
        val mgr = KiloBackendModelStateManager(dir.resolve("model.json"))

        val state = mgr.variant(ModelVariantUpdateDto("kilo/auto", "medium"))

        assertEquals("medium", state.variant["kilo/auto"])
        assertTrue(dir.resolve("model.json").readText().contains("medium"))
    }

    @Test
    fun `malformed model json returns empty favorites`() = runBlocking {
        dir.resolve("model.json").writeText("not-json")
        val mgr = KiloBackendModelStateManager(dir.resolve("model.json"))

        assertTrue(mgr.state().favorite.isEmpty())
    }

}
