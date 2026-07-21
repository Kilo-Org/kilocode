@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.agentManager.worktree

import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeBranchesDto
import ai.kilocode.rpc.dto.WorktreeListDto
import com.intellij.openapi.components.Service
import fleet.rpc.client.durable
import kotlinx.coroutines.CoroutineScope

/**
 * App-level service wrapping [ai.kilocode.rpc.KiloWorktreeRpcApi]. Mirrors [ai.kilocode.client.app.KiloWorkspaceService]:
 * a light `@Service` with a `call {}` helper that routes through `durable {}` in split mode and
 * to an injected RPC directly in tests.
 */
@Service(Service.Level.APP)
class KiloWorktreeService internal constructor(
    private val cs: CoroutineScope,
    private val rpc: KiloWorktreeRpcApi?,
) {
    /** Platform constructor — resolves RPC from the service container. */
    constructor(cs: CoroutineScope) : this(cs, null)

    companion object {
        private val LOG = KiloLog.create(KiloWorktreeService::class.java)
    }

    private suspend fun <T> call(block: suspend KiloWorktreeRpcApi.() -> T): T {
        val api = rpc
        return if (api != null) block(api) else durable { block(KiloWorktreeRpcApi.getInstance()) }
    }

    suspend fun list(directory: String): WorktreeListDto = try {
        call { list(directory) }
    } catch (e: Exception) {
        LOG.warn("worktree list failed for $directory", e)
        WorktreeListDto()
    }

    suspend fun listBranches(directory: String): WorktreeBranchesDto = try {
        call { listBranches(directory) }
    } catch (e: Exception) {
        LOG.warn("branch list failed for $directory", e)
        WorktreeBranchesDto()
    }

    suspend fun create(directory: String, req: CreateWorktreeRequestDto): CreateWorktreeResultDto =
        call { create(directory, req) }

    suspend fun remove(directory: String, path: String, branch: String?) {
        call { remove(directory, path, branch) }
    }
}
