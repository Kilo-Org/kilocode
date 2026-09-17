package ai.kilocode.client.settings.marketplace

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.ide.DataManager
import com.intellij.openapi.options.ex.Settings
import com.intellij.ui.components.ActionLink
import javax.swing.JComponent

/**
 * Jumps to the Marketplace settings page. Used from the Agents, MCP Servers, and Skills pages, each
 * of which lets a user configure by hand what Marketplace can install directly.
 */
internal fun marketplaceLink(): JComponent = ActionLink(KiloBundle.message("settings.marketplace.displayName")) { e ->
    val src = e.source as? JComponent ?: return@ActionLink
    val settings = Settings.KEY.getData(DataManager.getInstance().getDataContext(src)) ?: return@ActionLink
    settings.find(MarketplaceConfigurable.ID)?.let { settings.select(it) }
}
