package ai.kilocode.rpc

import ai.kilocode.rpc.dto.MarketplaceItemDto
import ai.kilocode.rpc.dto.MarketplaceListDto
import ai.kilocode.rpc.dto.MarketplaceResultDto
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor

@Rpc
interface KiloMarketplaceRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloMarketplaceRpcApi {
            return RemoteApiProviderService.resolve(remoteApiDescriptor<KiloMarketplaceRpcApi>())
        }
    }

    suspend fun list(directory: String): MarketplaceListDto

    suspend fun install(
        directory: String,
        item: MarketplaceItemDto,
        target: String,
        parameters: Map<String, String>,
    ): MarketplaceResultDto

    suspend fun remove(directory: String, id: String, type: String, scope: String): MarketplaceResultDto
}
