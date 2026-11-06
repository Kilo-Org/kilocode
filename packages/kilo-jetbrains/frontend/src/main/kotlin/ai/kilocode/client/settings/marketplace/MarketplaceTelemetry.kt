package ai.kilocode.client.settings.marketplace

import ai.kilocode.rpc.dto.MarketplaceItemDto

/**
 * Properties for the marketplace telemetry events. `itemId`, `itemType`, and `itemName` match the
 * VS Code extension so one report covers both IDEs; `id` and `type` stay for earlier reports.
 */
internal fun marketplaceProps(item: MarketplaceItemDto, request: MarketplaceInstallRequest): Map<String, String> {
    val method = request.parameters["__method"]?.takeIf { it.isNotBlank() }
    val params = request.parameters.keys.any { it != "__method" }
    return buildMap {
        put("itemId", item.id)
        put("itemType", item.type)
        put("itemName", item.name)
        put("id", item.id)
        put("type", item.type)
        put("target", request.target)
        if (!request.remove && params) put("hasParameters", "true")
        if (!request.remove && method != null) put("installationMethodName", method)
    }
}
