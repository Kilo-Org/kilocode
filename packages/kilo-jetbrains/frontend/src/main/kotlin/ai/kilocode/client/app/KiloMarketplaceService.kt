@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.app

import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloMarketplaceRpcApi
import ai.kilocode.rpc.dto.MarketplaceItemDto
import ai.kilocode.rpc.dto.MarketplaceListDto
import ai.kilocode.rpc.dto.MarketplaceResultDto
import com.intellij.openapi.components.Service
import fleet.rpc.client.durable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.withTimeout

@Service(Service.Level.APP)
class KiloMarketplaceService internal constructor(
    private val cs: CoroutineScope,
    private val rpc: KiloMarketplaceRpcApi?,
) {
    constructor(cs: CoroutineScope) : this(cs, null)

    companion object {
        private val LOG = KiloLog.create(KiloMarketplaceService::class.java)

        // The CLI fetches three remote catalog endpoints with retry/backoff, so list()
        // needs a longer budget than a local config read.
        private const val LIST_TIMEOUT_MS = 45_000L

        // Skill installs download and extract a tarball; mutations get the longest budget.
        private const val MUTATE_TIMEOUT_MS = 120_000L
    }

    private suspend fun <T> call(name: String, timeoutMs: Long, block: suspend KiloMarketplaceRpcApi.() -> T): T {
        val start = System.currentTimeMillis()
        LOG.info("marketplace rpc $name: start")
        val api = rpc
        return try {
            val result = withTimeout(timeoutMs) {
                if (api != null) block(api) else durable { block(KiloMarketplaceRpcApi.getInstance()) }
            }
            LOG.info("marketplace rpc $name: completed durationMs=${System.currentTimeMillis() - start}")
            result
        } catch (e: Exception) {
            LOG.warn("marketplace rpc $name: failed durationMs=${System.currentTimeMillis() - start}", e)
            throw e
        }
    }

    suspend fun list(directory: String): MarketplaceListDto = call("list dir=$directory", LIST_TIMEOUT_MS) { list(directory) }

    suspend fun install(
        directory: String,
        item: MarketplaceItemDto,
        target: String,
        parameters: Map<String, String>,
    ): MarketplaceResultDto = call("install dir=$directory id=${item.id}", MUTATE_TIMEOUT_MS) {
        install(directory, item, target, parameters)
    }

    suspend fun remove(directory: String, id: String, type: String, scope: String): MarketplaceResultDto =
        call("remove dir=$directory id=$id", MUTATE_TIMEOUT_MS) { remove(directory, id, type, scope) }
}
