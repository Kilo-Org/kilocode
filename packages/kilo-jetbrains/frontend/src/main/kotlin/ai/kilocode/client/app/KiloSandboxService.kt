@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.app

import ai.kilocode.rpc.KiloSandboxRpcApi
import ai.kilocode.rpc.dto.SandboxStatusDto
import ai.kilocode.rpc.dto.SandboxSupportDto
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import fleet.rpc.client.durable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * Project-level frontend service for sandbox confinement: backend-host capability, per-session
 * status/toggle reconciliation, the `sandbox.status.changed` stream, and the project-scoped
 * "new session" preference shared by ordinary chat and every Worktree Run in this IDE project.
 *
 * The preference is intentionally not part of the CLI's `sandbox` config: it mirrors VS Code's
 * IDE-local default, kept separate from the global policy so switching it never disposes the CLI
 * connection or affects another project/worktree using the same backend. An untouched project
 * resolves to off, matching JetBrains' visible-but-opt-in first-run behavior. Session creation
 * always sends that explicit choice as metadata so a CLI directory preference cannot silently
 * change the policy selected in this IDE project.
 */
@Service(Service.Level.PROJECT)
class KiloSandboxService internal constructor(
    private val project: Project,
    private val cs: CoroutineScope,
    private val rpc: KiloSandboxRpcApi?,
) {
    /** Platform constructor — resolves RPC from the service container. */
    constructor(project: Project, cs: CoroutineScope) : this(project, cs, null)

    companion object {
        private const val NEW_SESSION_DEFAULT_KEY = "kilo.sandbox.newSessionDefault"
    }

    private val props: PropertiesComponent get() = PropertiesComponent.getInstance(project)

    /** Desired sandbox state for the next session created in this project (chat or Worktree Run). */
    fun newSessionDefault(): Boolean = props.getBoolean(NEW_SESSION_DEFAULT_KEY, false)

    /** Update the project-scoped default. A synchronous local write — no ordering to reconcile. */
    fun setNewSessionDefault(enabled: Boolean) {
        props.setValue(NEW_SESSION_DEFAULT_KEY, enabled)
    }

    /** Restore first-run behavior. Primarily used by settings reset and isolated tests. */
    fun unsetNewSessionDefault() {
        props.unsetValue(NEW_SESSION_DEFAULT_KEY)
    }

    // ------ RPC ------

    /** Backend host sandbox capability for [directory], without creating a session. */
    suspend fun support(directory: String): SandboxSupportDto = call { support(directory) }

    /** Effective sandbox state for session [sessionID]. */
    suspend fun status(sessionID: String, directory: String): SandboxStatusDto = call { status(sessionID, directory) }

    /** Reconcile session [sessionID]'s sandbox state to [enabled]. See [KiloSandboxRpcApi.setEnabled]. */
    suspend fun setEnabled(sessionID: String, directory: String, enabled: Boolean): SandboxStatusDto =
        call { setEnabled(sessionID, directory, enabled) }

    /** `sandbox.status.changed` across every directory this CLI serves; callers filter by session/directory. */
    val statusChanges: Flow<SandboxStatusDto> = stream { statusChanges() }

    private suspend fun <T> call(block: suspend KiloSandboxRpcApi.() -> T): T {
        val api = rpc
        return if (api != null) block(api) else durable { block(KiloSandboxRpcApi.getInstance()) }
    }

    private fun <T> stream(block: suspend KiloSandboxRpcApi.() -> Flow<T>): Flow<T> = flow {
        val api = rpc
        if (api != null) block(api).collect { emit(it) }
        else durable { block(KiloSandboxRpcApi.getInstance()).collect { emit(it) } }
    }
}
