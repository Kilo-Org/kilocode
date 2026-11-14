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

    override fun getState(): State = State(LinkedHashMap(state.entries.mapValues { it.value.copy() }))

    override fun loadState(state: State) {
        this.state = State(LinkedHashMap(state.entries.mapValues { it.value.copy() }))
        claims.clear()
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
        val entry = prior?.takeIf { it.prompt == body && it.base == base && it.fetchBase == fetchBase }
            ?: entry(body).copy(directory = dir, branch = branch, base = base, fetchBase = fetchBase)
        update {
            put(entry.id, entry)
        }
        return entry.id
    }

    @RequiresEdt
    fun draft(directory: String): Entry? = state.entries.values.lastOrNull {
        it.directory == normalizeWorktreePath(directory) && it.path == null
    }?.copy()

    /** Bind only to the backend's actual checkout path, never a guessed path or placeholder id. */
    @RequiresEdt
    fun bind(id: String, path: String) {
        val entry = state.entries[id] ?: return
        if (entry.path != null) return
        update { put(entry.id, entry.copy(path = normalizeWorktreePath(path))) }
    }

    @RequiresEdt
    fun put(path: String, prompt: PendingPrompt) {
        if (prompt.text.isBlank()) return
        val key = normalizeWorktreePath(path)
        val entry = entry(prompt.copy(text = prompt.text.trim())).copy(path = key)
        update {
            entries.removeIf { it.value.path == key }
            put(entry.id, entry)
        }
    }

    @RequiresEdt
    fun peek(path: String): Entry? = state.entries.values.lastOrNull { it.path == normalizeWorktreePath(path) }?.copy()

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

    private fun entry(prompt: PendingPrompt) = Entry(
        id = hostedMessageID(), text = prompt.text, agent = prompt.agent, provider = prompt.provider,
        model = prompt.model, variant = prompt.variant, injectedTitle = prompt.injectedTitle,
    )

    private fun update(block: MutableMap<String, Entry>.() -> Unit) {
        state = State(LinkedHashMap(state.entries).apply(block))
    }
}
