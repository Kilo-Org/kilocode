package ai.kilocode.rpc

import ai.kilocode.rpc.dto.SandboxStatusDto
import ai.kilocode.rpc.dto.SandboxSupportDto
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor
import kotlinx.coroutines.flow.Flow

/**
 * Sandbox confinement RPC API exposed from backend to frontend.
 *
 * Backend-host capability and per-session policy state. Every call is scoped by directory (and,
 * for session-level calls, session id), matching the CLI server's directory-based routing.
 * Capability is always evaluated on the connected backend host — in Remote Development split mode
 * the frontend and backend can run on different OSes, and support must never be inferred from the
 * frontend's OS.
 */
@Rpc
interface KiloSandboxRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloSandboxRpcApi {
            return RemoteApiProviderService.resolve(remoteApiDescriptor<KiloSandboxRpcApi>())
        }
    }

    /** Backend host sandbox capability for [directory], without creating a session. */
    suspend fun support(directory: String): SandboxSupportDto

    /** Effective sandbox state for session [sessionID]. */
    suspend fun status(sessionID: String, directory: String): SandboxStatusDto

    /**
     * Reconcile session [sessionID]'s sandbox state to [enabled].
     *
     * The CLI's toggle endpoint only flips state (it takes no target), so this reads current
     * status first and only POSTs when the effective state actually needs to change, then re-reads
     * status once to confirm. A POST is never sent while the backend reports unavailable, since an
     * effective `enabled=false` can mask a stored desired-on policy the backend simply cannot
     * enforce right now — toggling from that ambiguous state would turn the desired policy off.
     */
    suspend fun setEnabled(sessionID: String, directory: String, enabled: Boolean): SandboxStatusDto

    /** Observe `sandbox.status.changed` across every directory this CLI serves. */
    suspend fun statusChanges(): Flow<SandboxStatusDto>
}
