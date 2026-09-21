package ai.kilocode.rpc

import ai.kilocode.rpc.dto.RunConfigListDto
import ai.kilocode.rpc.dto.RunResultDto
import ai.kilocode.rpc.dto.RunStateDto
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor
import kotlinx.coroutines.flow.Flow

/**
 * Run-configuration RPC API exposed from backend to frontend.
 *
 * Lets Agent Manager surfaces run the open project's IDE run configurations inside a git
 * worktree directory. Operations are scoped to the main repository [directory], which must be
 * the backend-resolved project root and resolves the owning open project on the backend. Execution
 * goes through the platform's real run pipeline ([com.intellij.execution.runners.ExecutionUtil]),
 * so output lands in the Run tool window like a regular Run action.
 */
@Rpc
interface KiloRunRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloRunRpcApi =
            RemoteApiProviderService.resolve(remoteApiDescriptor<KiloRunRpcApi>())
    }

    /** Run configurations of the project that can be transplanted into a worktree. */
    suspend fun configs(directory: String): RunConfigListDto

    /**
     * Dispatches config [id] into the platform run pipeline with its working directory switched to
     * [worktree]; re-running restarts. `ok` means the run was dispatched, not that a process is
     * confirmed live — the platform surfaces execution errors itself and [states] reflects the
     * real processes. Returns an error only for reasons we can detect up front (unknown or
     * unsupported configuration, unresolved project).
     */
    suspend fun run(directory: String, id: String, worktree: String): RunResultDto

    /**
     * Builds [worktree] by running the project's external-system build tasks against the worktree's
     * own copy of each linked root. [clean] prepends `clean`, approximating Rebuild Project.
     */
    suspend fun build(directory: String, worktree: String, clean: Boolean): RunResultDto

    /** Stops the process started for ([id], [worktree]). A second call while stopping force-kills. */
    suspend fun stop(directory: String, id: String, worktree: String): Boolean

    /** Brings the Run tool window tab of ([id], [worktree]) to the front. */
    suspend fun focus(directory: String, id: String, worktree: String): Boolean

    /**
     * Stops every process started in [worktree] and drops its cached clones. Called before a
     * worktree is removed so a running process is not orphaned with a deleted working directory.
     */
    suspend fun release(directory: String, worktree: String): Boolean

    /** Observes live per-worktree run process states for the project at [directory]. */
    suspend fun states(directory: String): Flow<List<RunStateDto>>
}
