package ai.kilocode.rpc

import ai.kilocode.rpc.dto.AgentManagerStartProgressDto
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor
import kotlinx.coroutines.flow.Flow

/**
 * Frontend-facing progress feed for `agent_manager` tool requests the backend host is executing.
 *
 * The protocol itself (`kilocode.agent_manager.*` SSE events, `GET/POST /kilocode/agent-manager*`)
 * is handled entirely inside `backend` — the host answers the CLI directly over HTTP and never needs
 * the frontend. This API exists only so the Agent Manager panel can show "preparing"/"failed" rows
 * for sessions a chat asked for, across any open project, the same way it already shows rows for
 * worktrees the user created by hand.
 */
@Rpc
interface KiloAgentManagerRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloAgentManagerRpcApi =
            RemoteApiProviderService.resolve(remoteApiDescriptor<KiloAgentManagerRpcApi>())
    }

    /**
     * Progress for every `agent_manager` `start` request since the backend last connected, one event
     * per stage transition. App-scoped: a request's `requestId` is unique regardless of which project
     * directory it targeted, so callers filter by the IDs they are tracking rather than by directory.
     */
    suspend fun startProgress(): Flow<AgentManagerStartProgressDto>
}
