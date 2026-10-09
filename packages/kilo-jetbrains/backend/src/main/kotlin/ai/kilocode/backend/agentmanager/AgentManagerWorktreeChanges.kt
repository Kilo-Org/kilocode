package ai.kilocode.backend.agentmanager

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map

/**
 * Process-wide signal that a worktree list changed for some directory, for mutations the owning
 * [KiloWorktreeRpcApiImpl][ai.kilocode.backend.rpc.KiloWorktreeRpcApiImpl] call did not itself make —
 * today, exclusively [AgentManagerStarter]'s host-initiated worktree creation.
 *
 * A singleton object rather than a field on `KiloWorktreeRpcApiImpl`: [AgentManagerStarter] and
 * `KiloAgentManagerRpcApiImpl`'s RPC-exposed [ai.kilocode.rpc.KiloWorktreeRpcApi.changes] run against
 * independent `KiloWorktreeRpcApiImpl` instances (the host's private worktree client vs. whatever the
 * RPC framework resolves per frontend call) — an instance field would never connect the two.
 */
internal object AgentManagerWorktreeChanges {
    private data class Change(val directory: String)

    private val changes = MutableSharedFlow<Change>(extraBufferCapacity = 64)

    fun emit(directory: String) {
        changes.tryEmit(Change(directory))
    }

    /** Ticks whenever [emit] is called for [directory] (exact string match, pre-normalization). */
    fun observe(directory: String): Flow<Unit> = changes.filter { it.directory == directory }.map { }
}
