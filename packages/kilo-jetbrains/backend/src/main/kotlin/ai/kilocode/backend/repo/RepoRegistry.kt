package ai.kilocode.backend.repo

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service

/**
 * Persisted catalog of Agent Manager repositories that the user added explicitly.
 *
 * Keyed by the **pinned workspace root** (the canonical repo of the open IDE project), so opening an
 * unrelated project does not inherit another workspace's repositories. Stored app-level, in the IDE
 * config directory — nothing is written into the user's VCS-tracked `.idea/`.
 *
 * Only [Entry] values are added repositories. The pinned project is derived from the open project at
 * runtime and is never persisted here; inferred repos are recomputed and never persisted. A [Workspace]
 * therefore only records what a user chose: repositories to keep, and inferred repos to keep hidden
 * ([Workspace.dismissed]).
 *
 * State is plain XML-serializable classes — never a kotlinx `@Serializable` DTO, which would cross the
 * frontend/backend classloader boundary and fail at runtime with a `LinkageError` that Gradle tests
 * cannot catch.
 */
@Service(Service.Level.APP)
@State(name = "KiloRepoRegistry", storages = [Storage("kilo-repos.xml")])
class RepoRegistry : PersistentStateComponent<RepoRegistry.State> {

    data class Entry(
        /** Canonical main-worktree root. */
        var root: String = "",
        var label: String? = null,
        var order: Int = 0,
        var addedAt: String = "",
    )

    data class Workspace(
        var root: String = "",
        var added: MutableList<Entry> = mutableListOf(),
        /** Canonical roots of inferred repos the user removed, so they stay hidden until re-added. */
        var dismissed: MutableList<String> = mutableListOf(),
    )

    data class State(
        var version: Int = REPO_REGISTRY_VERSION,
        var workspaces: MutableList<Workspace> = mutableListOf(),
    )

    private var state = State()
    private val lock = Any()

    override fun getState(): State = state

    override fun loadState(state: State) {
        this.state = state
    }

    /** Added repositories for [pinned], in insertion order. */
    fun added(pinned: String): List<Entry> = synchronized(lock) {
        workspace(pinned, create = false)?.added?.sortedBy { it.order } ?: emptyList()
    }

    /** Canonical roots of inferred repositories dismissed for [pinned]. */
    fun dismissed(pinned: String): Set<String> = synchronized(lock) {
        workspace(pinned, create = false)?.dismissed?.toSet() ?: emptySet()
    }

    /**
     * Register [root] as an added repo for [pinned]. Returns false when it is already present. Adding a
     * root that was dismissed clears the dismissal, which is how a user un-hides an inferred repo.
     */
    fun add(pinned: String, root: String, label: String?, addedAt: String): Boolean = synchronized(lock) {
        val ws = workspace(pinned, create = true) ?: return false
        val clean = repoPathKey(root)
        ws.dismissed.removeAll { repoPathKey(it) == clean }
        if (ws.added.any { repoPathKey(it.root) == clean }) return false
        ws.added.add(
            Entry(
                root = clean,
                label = label,
                order = (ws.added.maxOfOrNull { it.order } ?: -1) + 1,
                addedAt = addedAt,
            ),
        )
        true
    }

    /** Forget an added repo. Returns false when it was not registered. */
    fun remove(pinned: String, root: String): Boolean = synchronized(lock) {
        workspace(pinned, create = false)?.added?.removeAll { repoPathKey(it.root) == repoPathKey(root) } ?: false
    }

    /** Hide an inferred repo. Returns false when it was already dismissed. */
    fun dismiss(pinned: String, root: String): Boolean = synchronized(lock) {
        val ws = workspace(pinned, create = true) ?: return false
        val clean = repoPathKey(root)
        if (ws.dismissed.any { repoPathKey(it) == clean }) return false
        ws.dismissed.add(clean)
        true
    }

    private fun workspace(pinned: String, create: Boolean): Workspace? {
        val clean = repoPathKey(pinned)
        state.workspaces.firstOrNull { repoPathKey(it.root) == clean }?.let { return it }
        if (!create) return null
        return Workspace(root = clean).also { state.workspaces.add(it) }
    }
}

private const val REPO_REGISTRY_VERSION = 1
