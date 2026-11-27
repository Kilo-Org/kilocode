package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.marketplace.MarketplaceConfigurable
import com.intellij.openapi.actionSystem.AnActionEvent

class OpenMarketplaceSettingsAction : OpenSettingsPageAction(
    KiloBundle.message("action.Kilo.OpenMarketplaceSettings.text"),
    KiloBundle.message("action.Kilo.OpenMarketplaceSettings.description"),
    surface = "tool_window_marketplace",
) {
    internal override fun page(e: AnActionEvent): String = MarketplaceConfigurable.ID
}
