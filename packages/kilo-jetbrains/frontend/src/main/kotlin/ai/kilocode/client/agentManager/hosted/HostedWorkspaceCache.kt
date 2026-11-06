package ai.kilocode.client.agentManager.hosted

import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import com.intellij.openapi.components.Service
import java.util.Collections
import java.util.LinkedHashMap

/** Presentation metadata is mutable; editor identity is only the provider and workspace. */
@Service(Service.Level.APP)
internal class HostedWorkspaceCache {
    private val items = Collections.synchronizedMap(object : LinkedHashMap<String, HostedWorkspaceDto>(LIMIT, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, HostedWorkspaceDto>?): Boolean =
            size > LIMIT
    })

    fun get(ref: HostedWorkspaceRefDto): HostedWorkspaceDto? = items[ref.key]

    fun put(dto: HostedWorkspaceDto) {
        items[dto.ref.key] = dto.copy(sessions = emptyList(), sessionCursor = null)
    }

    private companion object {
        const val LIMIT = 256
    }
}
