package ai.kilocode.client.settings.agents

import ai.kilocode.client.app.KiloMarketplaceService
import ai.kilocode.log.KiloLog
import com.intellij.openapi.components.service
import kotlinx.coroutines.CancellationException

private val LOG = KiloLog.create(KiloMarketplaceService::class.java)

/**
 * Marketplace bundles owning MCP servers or skills in [dir], or an empty list when the Marketplace
 * cannot be reached.
 *
 * Bundle ownership only decides whether deleting one half of a Marketplace install should offer to
 * remove the whole bundle. It is an enrichment, so a Marketplace outage or timeout must not take the
 * MCP and Skills pages down with it — without it those pages still list and manage everything, they
 * just fall back to the plain single-item delete confirmation.
 */
internal suspend fun ownedBundles(dir: String) = if (dir.isBlank()) {
    emptyList()
} else {
    try {
        service<KiloMarketplaceService>().bundles(dir)
    } catch (err: CancellationException) {
        throw err
    } catch (err: Exception) {
        LOG.warn("marketplace bundles unavailable dir=$dir; continuing without bundle ownership", err)
        emptyList()
    }
}
