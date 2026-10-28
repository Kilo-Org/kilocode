package ai.kilocode.client.agentManager.hosted

import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import com.intellij.openapi.components.Service
import com.intellij.util.concurrency.annotations.RequiresEdt

/** Presentation metadata is mutable; editor identity is only the provider and workspace. */
@Service(Service.Level.APP)
internal class HostedWorkspaceCache {
    private val items = mutableMapOf<String, HostedWorkspaceDto>()

    @RequiresEdt
    fun get(ref: HostedWorkspaceRefDto): HostedWorkspaceDto? = items[ref.key]

    @RequiresEdt
    fun put(dto: HostedWorkspaceDto) {
        items[dto.ref.key] = dto.copy(sessions = emptyList(), sessionCursor = null)
    }
}
