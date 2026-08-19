package ai.kilocode.client.agentManager.worktree

import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreePrDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt

/**
 * App-level map of worktree path to display name, shared by the tool-window worktree list and the
 * worktree session editor tabs. EDT-only. Single-path changes notify listeners so a name adopted or
 * renamed in one surface (e.g. an editor tab) can update the other (the worktree list) live.
 */
@Service(Service.Level.APP)
class WorktreeNameCache {
    private val names = linkedMapOf<String, String>()
    private val pulls = linkedMapOf<String, WorktreePrDto>()
    private val listeners = mutableListOf<(String, String?) -> Unit>()

    @RequiresEdt
    fun get(path: String): String? = names[path]

    @RequiresEdt
    fun title(path: String): String = WorktreeTitle.text(names[path], path, pulls[path])

    @RequiresEdt
    fun put(path: String, name: String) {
        if (names[path] == name) return
        names[path] = name
        fire(path, name)
    }

    @RequiresEdt
    fun put(item: WorktreeDto) = put(item.path, item.name)

    @RequiresEdt
    fun putPr(path: String, pull: WorktreePrDto?) {
        val prev = pulls[path]
        if (pull == null) {
            if (prev == null) return
            pulls.remove(path)
            fire(path, names[path])
            return
        }
        if (prev == pull) return
        pulls[path] = pull
        fire(path, names[path])
    }

    @RequiresEdt
    fun remove(path: String) {
        val changed = names.remove(path) != null || pulls.remove(path) != null
        if (changed) fire(path, null)
    }

    @RequiresEdt
    fun clear() {
        names.clear()
        pulls.clear()
    }

    /**
     * Bulk sync from a worktree list reload. Does not notify: it mirrors the list model that
     * triggered it, so notifying would only echo back into that same list.
     */
    @RequiresEdt
    fun putAll(items: List<WorktreeDto>) {
        items.forEach { names[it.path] = it.name }
    }

    @RequiresEdt
    fun addListener(parent: Disposable, listener: (path: String, name: String?) -> Unit) {
        listeners.add(listener)
        Disposer.register(parent) { listeners.remove(listener) }
    }

    private fun fire(path: String, name: String?) {
        listeners.toList().forEach { it(path, name) }
    }
}
