@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.agentManager.worktree

import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.RenameWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeBranchesDto
import ai.kilocode.rpc.dto.WorktreeListDto
import ai.kilocode.rpc.dto.WorktreePrListDto
import ai.kilocode.rpc.dto.WorktreeStatsListDto
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

    suspend fun stats(directory: String): WorktreeStatsListDto = try {
        call { stats(directory) }
    } catch (e: Exception) {
        LOG.warn("worktree stats failed for $directory", e)
        WorktreeStatsListDto()
    }

    suspend fun prStatus(directory: String): WorktreePrListDto = try {
        call { prStatus(directory) }
    } catch (e: Exception) {
        LOG.warn("worktree PR status failed for $directory", e)
        WorktreePrListDto()
    }

    suspend fun create(directory: String, req: CreateWorktreeRequestDto): CreateWorktreeResultDto =
        call { create(directory, req) }

    suspend fun remove(directory: String, path: String, branch: String?, force: Boolean = false): RemoveWorktreeResultDto = try {
        call { remove(directory, path, branch, force) }
    } catch (e: Exception) {
        LOG.warn("worktree remove failed for $path", e)
        RemoveWorktreeResultDto(error = e.message ?: "worktree remove failed")
    }

    suspend fun rename(directory: String, path: String, name: String): RenameWorktreeResultDto = try {
        call { rename(directory, path, name) }
    } catch (e: Exception) {
        LOG.warn("worktree rename failed for $path", e)
        RenameWorktreeResultDto(error = e.message ?: "worktree rename failed")
    }

    suspend fun adopt(directory: String, path: String, name: String): RenameWorktreeResultDto = try {
        call { adopt(directory, path, name) }
    } catch (e: Exception) {
        LOG.warn("worktree adopt failed for $path", e)
        RenameWorktreeResultDto(error = e.message ?: "worktree adopt failed")
    }
}
