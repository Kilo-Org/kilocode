package ai.kilocode.client.agentManager.hosted

import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.ProviderDto
import ai.kilocode.rpc.dto.ProvidersDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class HostedAgentSelectionTest {
    private val providers = ProvidersDto(
        providers = listOf(
            ProviderDto(
                id = "kilo",
                name = "Kilo",
                models = mapOf("kilo-auto/free" to ModelDto("kilo-auto/free", "Auto", variants = listOf("low", "high"))),
            ),
        ),
        connected = listOf("kilo"),
        defaults = emptyMap(),
    )

    @Test
    fun `saved variant is kept while the model still offers it`() {
        assertEquals("high", savedVariant("high", "kilo/kilo-auto/free", providers))
    }

    @Test
    fun `stale or unknown variants are cleared`() {
        assertNull(savedVariant("medium", "kilo/kilo-auto/free", providers))
        assertNull(savedVariant("high", "kilo/missing", providers))
        assertNull(savedVariant("high", "kilo/kilo-auto/free", null))
        assertNull(savedVariant(null, "kilo/kilo-auto/free", providers))
    }
}
