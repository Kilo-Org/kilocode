package ai.kilocode.client.settings.marketplace

import ai.kilocode.rpc.dto.MarketplaceItemDto
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class MarketplaceTelemetryTest {

    private val item = MarketplaceItemDto(
        id = "airbyte-agent-mcp",
        type = "mcp",
        name = "Airbyte Agent MCP",
        description = "",
        category = "data",
        content = "",
    )

    @Test
    fun `install events carry the keys VS Code sends plus the legacy ones`() {
        val props = marketplaceProps(
            item,
            MarketplaceInstallRequest(target = "global", parameters = mapOf("__method" to "Hosted", "TOKEN" to "secret")),
        )

        assertEquals(
            mapOf(
                "itemId" to "airbyte-agent-mcp",
                "itemType" to "mcp",
                "itemName" to "Airbyte Agent MCP",
                "id" to "airbyte-agent-mcp",
                "type" to "mcp",
                "target" to "global",
                "installationMethodName" to "Hosted",
            ),
            props,
        )
        assertFalse(props.values.contains("secret"), "parameter values must never be reported")
    }

    @Test
    fun `removal events omit install-only details`() {
        val props = marketplaceProps(
            item,
            MarketplaceInstallRequest(target = "project", parameters = mapOf("__method" to "Hosted"), remove = true),
        )

        assertEquals(
            mapOf(
                "itemId" to "airbyte-agent-mcp",
                "itemType" to "mcp",
                "itemName" to "Airbyte Agent MCP",
                "id" to "airbyte-agent-mcp",
                "type" to "mcp",
                "target" to "project",
            ),
            props,
        )
    }
}
