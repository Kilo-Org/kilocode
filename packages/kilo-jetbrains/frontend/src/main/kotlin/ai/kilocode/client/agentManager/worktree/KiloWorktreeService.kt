@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.agentManager.worktree

import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.dto.BranchStatusDto
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.MoveProgressDto
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.RenameWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeBranchesDto
import ai.kilocode.rpc.dto.WorktreeListDto
import ai.kilocode.rpc.dto.WorktreePrListDto
import ai.kilocode.rpc.dto.WorktreeStatsListDto
import com.intellij.openapi.components.Service
import fleet.rpc.client.durable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

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

    suspend fun open(directory: String): Boolean = try {
        call { open(directory) }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        LOG.warn("worktree open failed for $directory", e)
        false
    }

    /**
     * Fire-and-forget open on the service scope. EDT click handlers have no thread-bound coroutine
     * scope, so they route through here instead of `currentThreadCoroutineScope()`, which throws
     * outside progress/blocking contexts.
     */
    fun openInBackground(directory: String) {
        cs.launch {
            val ok = open(directory)
            LOG.info("worktree open: backend returned=$ok dir=$directory")
        }
    }

    suspend fun stats(directory: String): WorktreeStatsListDto = try {
        call { stats(directory) }
    } catch (e: Exception) {
        LOG.warn("worktree stats failed for $directory", e)
        WorktreeStatsListDto()
    }

    /**
     * Reports gh availability, or rethrows on RPC/backend failure. Callers ([GhStatusCoordinator])
     * distinguish a healthy gh from an unhealthy backend via their own `runCatching` + backoff;
     * swallowing errors here would publish a false "gh is fine" and reset that backoff.
     */
    suspend fun ghStatus(directory: String): GhAvailability = call { ghStatus(directory) }

    suspend fun prStatus(directory: String): WorktreePrListDto = try {
        call { prStatus(directory) }
    } catch (e: Exception) {
        LOG.warn("worktree PR status failed for $directory", e)
        WorktreePrListDto()
    }

    /**
     * Branch/PR status for one directory, or a thrown failure. Deliberately not swallowed: an empty
     * [BranchStatusDto] defaults to [GhAvailability.OK], which the chat dock reads as healthy git and
     * would offer worktree actions against a directory whose real state is unknown. Callers decide
     * what an unknown status means.
     */
    suspend fun branchStatus(directory: String): BranchStatusDto = call { branchStatus(directory) }

    /**
     * Long-lived move flow. Routed through [durable] (via [call]) so it survives reconnects and
     * backend restarts while the move runs.
     */
    suspend fun moveToWorktree(directory: String, sessionId: String?, branch: String): Flow<MoveProgressDto> =
        call { moveToWorktree(directory, sessionId, branch) }

    suspend fun create(directory: String, req: CreateWorktreeRequestDto): CreateWorktreeResultDto =
        call { create(directory, req) }

    suspend fun importPr(directory: String, url: String): CreateWorktreeResultDto = try {
        call { importPr(directory, url) }
    } catch (e: Exception) {
        LOG.warn("worktree PR import failed for $url", e)
        CreateWorktreeResultDto(error = e.message ?: "worktree PR import failed")
    }

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

    suspend fun reorder(directory: String, paths: List<String>): Boolean = try {
        call { reorder(directory, paths) }
    } catch (e: Exception) {
        LOG.warn("worktree reorder failed for $directory", e)
        false
    }

    suspend fun sessionList(directory: String): Boolean? = try {
        call { sessionList(directory) }
    } catch (e: Exception) {
        LOG.warn("worktree session list state failed for $directory", e)
        null
    }

    suspend fun setSessionList(directory: String, visible: Boolean): Boolean = try {
        call { setSessionList(directory, visible) }
    } catch (e: Exception) {
        LOG.warn("worktree session list state write failed for $directory", e)
        false
    }
}
