package ai.kilocode.backend.rpc

import ai.kilocode.backend.workspace.ModelInfo
import ai.kilocode.backend.workspace.ProviderData
import ai.kilocode.backend.workspace.ProviderInfo
import kotlin.test.Test
import kotlin.test.assertTrue

class KiloWorkspaceDtoMapperTest {

    @Test
    fun `providers preserve prompt training disclosure`() {
        val model = ModelInfo(
            id = "paid",
            name = "Paid",
            attachment = false,
            reasoning = false,
            temperature = false,
            toolCall = true,
            free = false,
            status = null,
            recommendedIndex = null,
            variants = emptyList(),
            limit = null,
            mayTrainOnYourPrompts = true,
        )
        val data = ProviderData(
            providers = listOf(
                ProviderInfo(
                    id = "kilo",
                    name = "Kilo",
                    source = "api",
                    models = mapOf(model.id to model),
                ),
            ),
            connected = listOf("kilo"),
            defaults = emptyMap(),
        )

        val result = KiloWorkspaceDtoMapper.providers(data)

        assertTrue(result.providers.single().models.getValue("paid").mayTrainOnYourPrompts)
    }
}
