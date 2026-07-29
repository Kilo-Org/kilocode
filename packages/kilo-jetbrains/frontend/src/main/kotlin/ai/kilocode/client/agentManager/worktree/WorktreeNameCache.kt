package ai.kilocode.client.agentManager.worktree

import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.components.Service

@Service(Service.Level.APP)
class WorktreeNameCache {
    private val names = linkedMapOf<String, String>()

    fun get(path: String): String? = names[path]

    fun put(path: String, name: String) {
        names[path] = name
    }

    fun put(item: WorktreeDto) {
        names[item.path] = item.name
    }

    fun remove(path: String) {
        names.remove(path)
    }

    fun clear() {
        names.clear()
    }

    fun putAll(items: List<WorktreeDto>) {
        items.forEach(::put)
    }
}
