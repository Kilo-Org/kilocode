package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.rpc.KiloAgentManagerRpcApi
import ai.kilocode.rpc.dto.AgentManagerStartProgressDto
import com.intellij.openapi.components.service
import kotlinx.coroutines.flow.Flow

/**
 * Backend implementation of [KiloAgentManagerRpcApi]. The orchestration protocol itself is handled
 * entirely by [ai.kilocode.backend.agentmanager.KiloAgentManagerHost]; this RPC only exposes its
 * host-initiated-creation progress feed to the frontend panel.
 */
class KiloAgentManagerRpcApiImpl internal constructor(
    private val appOverride: KiloBackendAppService? = null,
) : KiloAgentManagerRpcApi {
    private val app: KiloBackendAppService
        get() = appOverride ?: service()

    override suspend fun startProgress(): Flow<AgentManagerStartProgressDto> = app.agentManager.startProgress
}
