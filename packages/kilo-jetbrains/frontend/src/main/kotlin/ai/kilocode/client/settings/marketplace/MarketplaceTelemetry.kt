package ai.kilocode.client.settings.marketplace

import ai.kilocode.rpc.dto.MarketplaceItemDto

/**
 * Properties for the marketplace click events. `itemId`, `itemType`, and `itemName` match the
 * keys the CLI sends on `Marketplace Item Installed`/`Removed`; `id` and `type` stay for earlier reports.
 * `hasParameters` is left out: telemetry here is string-only, and the CLI sends it as a boolean, so a
 * shared key would split one report column across two types.
 */
internal fun marketplaceProps(item: MarketplaceItemDto, request: MarketplaceInstallRequest): Map<String, String> {
    val method = request.parameters["__method"]?.takeIf { it.isNotBlank() }
    return buildMap {
        put("itemId", item.id)
        put("itemType", item.type)
        put("itemName", item.name)
        put("id", item.id)
        put("type", item.type)
        put("target", request.target)
        if (!request.remove && method != null) put("installationMethodName", method)
    }
}
