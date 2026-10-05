package ai.kilocode.client.testing

import ai.kilocode.rpc.KiloMarketplaceRpcApi
import ai.kilocode.rpc.dto.MarketplaceItemDto
import ai.kilocode.rpc.dto.MarketplaceListDto
import ai.kilocode.rpc.dto.MarketplaceResultDto
import kotlinx.coroutines.CompletableDeferred

class FakeMarketplaceRpcApi : KiloMarketplaceRpcApi {
    var list = MarketplaceListDto()
    var listError: Exception? = null
    var installResult = MarketplaceResultDto(success = true, slug = "test")
    var removeResult = MarketplaceResultDto(success = true, slug = "test")

    /** Holds [install] open until completed, so a test can observe the in-flight state. */
    var installGate: CompletableDeferred<Unit>? = null
    val listCalls = mutableListOf<String>()
    val installCalls = mutableListOf<InstallCall>()
    val removeCalls = mutableListOf<RemoveCall>()

    data class InstallCall(val directory: String, val item: MarketplaceItemDto, val target: String, val parameters: Map<String, String>)
    data class RemoveCall(val directory: String, val id: String, val type: String, val scope: String)

    override suspend fun list(directory: String): MarketplaceListDto {
        assertNotEdt("marketplace.list")
        listError?.let { throw it }
        listCalls.add(directory)
        return list
    }

    override suspend fun install(
        directory: String,
        item: MarketplaceItemDto,
        target: String,
        parameters: Map<String, String>,
    ): MarketplaceResultDto {
        assertNotEdt("marketplace.install")
        installCalls.add(InstallCall(directory, item, target, parameters))
        installGate?.await()
        return installResult
    }

    override suspend fun remove(directory: String, id: String, type: String, scope: String): MarketplaceResultDto {
        assertNotEdt("marketplace.remove")
        removeCalls.add(RemoveCall(directory, id, type, scope))
        return removeResult
    }
}
