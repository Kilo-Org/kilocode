package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.agentManager.hosted.hostedMessageID
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.RoamingType
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.xmlb.annotations.Transient

/**
 * An initial worktree prompt plus the mode / model / reasoning the New Worktree dialog picked for
 * it. Carrying the selection alongside the text lets the first turn run with exactly what the user
 * chose, instead of relying on the freshly-opened session resolving its own defaults.
 */
data class PendingPrompt(
    val text: String,
    val agent: String? = null,
    val provider: String? = null,
    val model: String? = null,
    val variant: String? = null,
    val injectedTitle: String? = null,
)

/** Keeps the creation draft until its correlated user message is persisted in the first session. */
@Service(Service.Level.APP)
@State(
    name = "KiloPendingWorktreePrompt",
    storages = [Storage("kiloPendingWorktreePrompt.xml", roamingType = RoamingType.DISABLED)],
)
@Suppress("TooManyFunctions") // Persistence and EDT handoff operations share one journal.
class PendingWorktreePrompt : PersistentStateComponent<PendingWorktreePrompt.State> {
    data class State(var entries: MutableMap<String, Entry> = LinkedHashMap())

    data class Entry(
        var id: String = "",
        var directory: String = "",
        var branch: String = "",
        var base: String? = null,
        var fetchBase: Boolean = false,
        var path: String? = null,
        var session: String? = null,
        var attempted: Boolean = false,
        var creating: Boolean = false,
        var obsolete: List<String> = emptyList(),
        var order: Long = 0,
        var text: String = "",
        var agent: String? = null,
        var provider: String? = null,
        var model: String? = null,
        var variant: String? = null,
        var injectedTitle: String? = null,
    ) {
        @get:Transient
        val prompt: PendingPrompt get() = PendingPrompt(text, agent, provider, model, variant, injectedTitle)
    }

    @Volatile private var state = State()
    private val claims = HashMap<String, Disposable>()
    private var clock = 0L

    override fun getState(): State = State(LinkedHashMap(state.entries.mapValues { it.value.snapshot() }))

    override fun loadState(state: State) {
        claims.clear()
        clock = state.entries.values.maxOfOrNull { it.order } ?: 0
        update {
            clear()
            // XML map serialization does not preserve insertion order.
            state.entries.entries.sortedBy { it.value.order }.forEach { put(it.key, it.value.snapshot()) }
        }
    }

    /** Called before publishing creation, including by callers that bypass the dialog. */
    @RequiresEdt
    fun remember(
        directory: String,
        branch: String,
        base: String?,
        prompt: PendingPrompt,
        fetchBase: Boolean = false,
    ): String? {
        if (prompt.text.isBlank()) return null
        val dir = normalizeWorktreePath(directory)
        val prior = state.entries.values.lastOrNull { it.directory == dir && it.branch == branch && it.path == null }
        val body = prompt.copy(text = prompt.text.trim())
        val saved = prior?.takeIf { !it.creating && it.prompt == body && it.base == base && it.fetchBase == fetchBase }
            ?: entry(body).copy(directory = dir, branch = branch, base = base, fetchBase = fetchBase)
        val entry = saved.copy(obsolete = emptyList(), order = ++clock)
        update {
            remove(entry.id)
            put(entry.id, entry)
        }
        return entry.id
    }

    /** In-flight creations retain their own tokens even when another dialog supersedes its draft. */
    @RequiresEdt
    fun begin(id: String) {
        val entry = state.entries[id] ?: return
        update { put(id, entry.copy(creating = true)) }
    }

    @RequiresEdt
    fun finish(id: String) {
        val entry = state.entries[id] ?: return
        update { put(id, entry.copy(creating = false)) }
    }

    @RequiresEdt
    fun draft(directory: String): Entry? = state.entries.values.lastOrNull {
        it.directory == normalizeWorktreePath(directory) && it.path == null
    }?.snapshot()

    /** Bind only to the backend's actual checkout path, never a guessed path or placeholder id. */
    @RequiresEdt
    fun bind(id: String, path: String) {
        val entry = state.entries[id]?.takeIf { it.path == null } ?: return
        val key = normalizeWorktreePath(path)
        if (key in entry.obsolete) {
            update { remove(id) }
            return
        }
        update {
            supersede(key, id)
            entries.removeIf { it.value.path == key }
            put(entry.id, entry.copy(path = key, creating = false, obsolete = emptyList()))
        }
    }

    @RequiresEdt
    fun put(directory: String, path: String, prompt: PendingPrompt) {
        if (prompt.text.isBlank()) return
        val key = normalizeWorktreePath(path)
        val entry = entry(prompt.copy(text = prompt.text.trim())).copy(
            directory = normalizeWorktreePath(directory), path = key, order = ++clock,
        )
        update {
            supersede(key)
            entries.removeIf { it.value.path == key }
            put(entry.id, entry)
        }
    }

    @RequiresEdt
    fun peek(path: String): Entry? =
        state.entries.values.lastOrNull { it.path == normalizeWorktreePath(path) }?.snapshot()

    /** The owner holds a non-destructive lease; closing a failed editor makes the draft recoverable. */
    @RequiresEdt
    fun claim(path: String, session: String, owner: Disposable): Entry? {
        val entry = peek(path)?.takeIf {
            (it.session == null || it.session == session) && it.id !in claims
        } ?: return null
        claims[entry.id] = owner
        Disposer.register(owner) { if (claims[entry.id] === owner) claims.remove(entry.id) }
        val bound = entry.copy(session = session)
        update { put(entry.id, bound) }
        return bound
    }

    /** Persist intent before dispatch; an uncertain restart must restore, not automatically resend. */
    @RequiresEdt
    fun attempted(id: String, text: String) {
        val entry = state.entries[id] ?: return
        update { put(id, entry.copy(attempted = true, text = text)) }
    }

    @RequiresEdt
    fun acknowledge(path: String, id: String, session: String) {
        val entry = peek(path) ?: return
        if (entry.id != id || entry.session != session) return
        update { remove(id) }
        claims.remove(id)
    }

    /** A deleted/unavailable session must not strand the draft or reuse its old message identity. */
    @RequiresEdt
    fun release(path: String, session: String) {
        val entry = peek(path)?.takeIf { it.session == session } ?: return
        val recovered = entry.copy(id = hostedMessageID(), session = null, attempted = true)
        update {
            remove(entry.id)
            put(recovered.id, recovered)
        }
    }

    @RequiresEdt
    fun forget(path: String) {
        val key = normalizeWorktreePath(path)
        update {
            supersede(key)
            entries.removeIf { it.value.path == key }
        }
    }

    /** Immutable identities eligible for pruning by a subsequently started listing. */
    fun bound(directory: String): Set<String> {
        val dir = normalizeWorktreePath(directory)
        return state.entries.values.filter { it.directory == dir && it.path != null }.mapTo(HashSet()) { it.id }
    }

    /** A listing cannot remove records bound while it was in flight, including from another controller. */
    @RequiresEdt
    fun reconcile(directory: String, paths: Collection<String>, before: Set<String>) {
        val dir = normalizeWorktreePath(directory)
        val present = paths.mapTo(HashSet(), ::normalizeWorktreePath)
        update {
            entries.removeIf {
                it.key in before && it.value.directory == dir && it.value.path?.let { path -> path !in present } == true
            }
        }
    }

    private fun entry(prompt: PendingPrompt) = Entry(
        id = hostedMessageID(), text = prompt.text, agent = prompt.agent, provider = prompt.provider,
        model = prompt.model, variant = prompt.variant, injectedTitle = prompt.injectedTitle,
    )

    private fun Entry.snapshot() = copy(obsolete = obsolete.toList())

    /** Retain invalidation only on older unresolved operations, not a growing global tombstone map. */
    private fun MutableMap<String, Entry>.supersede(path: String, before: String? = null) {
        values.toList().takeWhile { it.id != before }.filter { it.creating && it.path == null }.forEach {
            put(it.id, it.copy(obsolete = (it.obsolete + path).distinct()))
        }
    }

    private fun update(block: MutableMap<String, Entry>.() -> Unit) {
        val entries = LinkedHashMap(state.entries).apply(block)
        val paths = HashSet<String>()
        val drafts = HashSet<String>()
        entries.values.toList().asReversed().forEach {
            val keep = it.path?.let(paths::add) ?: drafts.add(it.directory)
            if (!keep && !it.creating) entries.remove(it.id)
        }
        claims.keys.retainAll(entries.keys)
        state = State(entries)
    }
}
