@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.agentManager.worktree

import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloRunRpcApi
import ai.kilocode.rpc.dto.RunConfigListDto
import ai.kilocode.rpc.dto.RunResultDto
import ai.kilocode.rpc.dto.RunStateDto
import com.intellij.openapi.components.Service
import fleet.rpc.client.durable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch

/**
 * App-level service wrapping [ai.kilocode.rpc.KiloRunRpcApi]. Mirrors [KiloWorktreeService]:
 * a light `@Service` with a `call {}` helper that routes through `durable {}` in split mode
 * and to an injected RPC directly in tests.
 */
@Service(Service.Level.APP)
class KiloRunService internal constructor(
    private val cs: CoroutineScope,
    private val rpc: KiloRunRpcApi?,
) {
    /** Platform constructor — resolves RPC from the service container. */
    constructor(cs: CoroutineScope) : this(cs, null)

    companion object {
        private val LOG = KiloLog.create(KiloRunService::class.java)
    }

    private suspend fun <T> call(block: suspend KiloRunRpcApi.() -> T): T {
        val api = rpc
        return if (api != null) block(api) else durable { block(KiloRunRpcApi.getInstance()) }
    }

    suspend fun configs(directory: String): RunConfigListDto = try {
        call { configs(directory) }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        LOG.warn("run configs failed for $directory", e)
        RunConfigListDto(error = e.message ?: "run configs failed")
    }

    suspend fun run(directory: String, id: String, worktree: String): RunResultDto = try {
        call { run(directory, id, worktree) }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        LOG.warn("run start failed for $id in $worktree", e)
        RunResultDto(error = e.message ?: "run start failed")
    }

    suspend fun build(directory: String, worktree: String, clean: Boolean): RunResultDto = try {
        call { build(directory, worktree, clean) }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        LOG.warn("worktree build failed for $worktree clean=$clean", e)
        RunResultDto(error = e.message ?: "worktree build failed")
    }

    suspend fun stop(directory: String, id: String, worktree: String): Boolean = try {
        call { stop(directory, id, worktree) }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        LOG.warn("run stop failed for $id in $worktree", e)
        false
    }

    suspend fun focus(directory: String, id: String, worktree: String): Boolean = try {
        call { focus(directory, id, worktree) }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        LOG.warn("run focus failed for $id in $worktree", e)
        false
    }

    suspend fun release(directory: String, worktree: String): Boolean = try {
        call { release(directory, worktree) }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        LOG.warn("run release failed for $worktree", e)
        false
    }

    /** Live per-worktree run process states for the project at [directory]; survives reconnects. */
    fun states(directory: String): Flow<List<RunStateDto>> = flow {
        val api = rpc
        if (api != null) api.states(directory).collect { emit(it) }
        else durable { KiloRunRpcApi.getInstance().states(directory).collect { emit(it) } }
    }

    /**
     * Fire-and-forget helpers for EDT click handlers, which have no thread-bound coroutine
     * scope (mirrors [KiloWorktreeService.openInBackground]).
     */
    fun runInBackground(directory: String, id: String, worktree: String, done: (RunResultDto) -> Unit = {}) {
        cs.launch { done(run(directory, id, worktree)) }
    }

    fun buildInBackground(directory: String, worktree: String, clean: Boolean, done: (RunResultDto) -> Unit = {}) {
        cs.launch { done(build(directory, worktree, clean)) }
    }

    fun stopInBackground(directory: String, id: String, worktree: String) {
        cs.launch { stop(directory, id, worktree) }
    }

    fun focusInBackground(directory: String, id: String, worktree: String) {
        cs.launch { focus(directory, id, worktree) }
    }
}
