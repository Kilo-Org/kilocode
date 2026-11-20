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

    // The tab and status bar read this cache, so keep the title the editor resolved from the latest
    // session. Sessions themselves are intentionally not cached.
    private val titles = Collections.synchronizedMap(object : LinkedHashMap<String, String>(LIMIT, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?): Boolean =
            size > LIMIT
    })

    fun get(ref: HostedWorkspaceRefDto): HostedWorkspaceDto? = items[ref.key]

    fun title(ref: HostedWorkspaceRefDto): String? = titles[ref.key]

    /**
     * The tab title for [ref], disambiguated only when another cached workspace resolves to the same
     * name. Task and branch names are not unique, but the raw workspace key in every tab is noise; a
     * short suffix appears just when two tabs would otherwise read identically.
     */
    fun displayTitle(ref: HostedWorkspaceRefDto): String? {
        val value = title(ref) ?: return null
        val duplicate = synchronized(titles) { titles.any { (key, name) -> key != ref.key && name == value } }
        if (!duplicate) return value
        return "$value (${ref.workspaceID.takeLast(SHORT)})"
    }

    fun putTitle(ref: HostedWorkspaceRefDto, title: String?) {
        if (title.isNullOrBlank()) titles.remove(ref.key) else titles[ref.key] = title
    }

    fun put(dto: HostedWorkspaceDto, title: String? = null) {
        items[dto.ref.key] = dto.copy(sessions = emptyList(), sessionCursor = null)
        putTitle(dto.ref, title)
    }

    fun remove(ref: HostedWorkspaceRefDto) {
        items.remove(ref.key)
        titles.remove(ref.key)
    }

    fun clear() {
        items.clear()
        titles.clear()
    }

    private companion object {
        const val LIMIT = 256
        const val SHORT = 8
    }
}
