@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.marketplace.KiloBackendMarketplaceManager
import ai.kilocode.rpc.KiloMarketplaceRpcApi
import ai.kilocode.rpc.dto.MarketplaceItemDto
import ai.kilocode.rpc.dto.MarketplaceListDto
import ai.kilocode.rpc.dto.MarketplaceResultDto

class KiloMarketplaceRpcApiImpl(
    backend: KiloBackendAppService? = null,
    private val manager: KiloBackendMarketplaceManager = KiloBackendMarketplaceManager(backend),
) : KiloMarketplaceRpcApi {
    override suspend fun list(directory: String): MarketplaceListDto = manager.list(directory)

    override suspend fun install(
        directory: String,
        item: MarketplaceItemDto,
        target: String,
        parameters: Map<String, String>,
    ): MarketplaceResultDto = manager.install(directory, item, target, parameters)

    override suspend fun remove(directory: String, id: String, type: String, scope: String): MarketplaceResultDto =
        manager.remove(directory, id, type, scope)
}
