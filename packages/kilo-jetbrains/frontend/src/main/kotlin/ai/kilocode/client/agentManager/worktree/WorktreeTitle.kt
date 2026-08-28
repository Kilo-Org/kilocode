package ai.kilocode.client.agentManager.worktree

import ai.kilocode.rpc.dto.WorktreePrDto

internal object WorktreeTitle {
    fun text(name: String?, path: String, pull: WorktreePrDto? = null): String {
        return pull?.title?.trim()?.takeIf { it.isNotBlank() }
            ?: name?.takeIf { it.isNotBlank() }
            ?: fallback(path)
    }

    fun custom(name: String?, path: String): String? {
        return name?.takeIf { it != fallback(path) }
    }

    fun fallback(path: String): String {
        val value = path.trimEnd('/', '\\')
        return value.substringAfterLast('/').substringAfterLast('\\').takeIf { it.isNotBlank() } ?: value
    }
}
