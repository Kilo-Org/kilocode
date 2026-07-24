package ai.kilocode.client.settings.base

internal class SettingsDraftState<D>(
    initial: D,
    private val saved: (D, D) -> Boolean = { base, draft -> base == draft },
) {
    var draft = initial
    val baseline get() = base
    val saving get() = save
    val error get() = err

    private var base = initial
    private var pending: D? = null
    private var stale: List<D> = emptyList()
    private var applied: D? = null
    private var save = false
    private var err: String? = null

    fun modified(): Boolean = !saved(pending ?: base, draft)

    fun update(fn: D.() -> D) {
        draft = draft.fn()
        err = null
    }

    fun reset() {
        draft = pending ?: base
        err = null
    }

    fun accept(next: D) {
        val target = pending
        if (target == null) {
            val done = applied
            if (done != null && saved(base, done) && stale.any { saved(next, it) }) return
            stale = emptyList()
            applied = null
            val prev = base
            val edit = draft
            base = next
            if (saved(prev, edit)) draft = next
            return
        }
        if (!saved(next, target)) return
        base = next
    }

    fun start(force: Boolean = false): SettingsDraftSave<D>? {
        val next = draft
        if (!force && saved(base, next)) return null
        val token = SettingsDraftSave(base, next)
        pending = next
        save = true
        err = null
        return token
    }

    fun complete(token: SettingsDraftSave<D>, returned: D) {
        val edit = draft
        val fresh = saved(returned, token.target)
        val next = if (fresh) returned else token.target
        base = next
        draft = if (saved(edit, token.target)) next else edit
        pending = null
        save = false
        err = null
        stale += token.previous
        applied = token.target
    }

    fun fail(token: SettingsDraftSave<D>, message: String) {
        val edit = draft
        base = token.previous
        draft = if (saved(edit, token.target)) token.target else edit
        pending = null
        save = false
        err = message
        stale = emptyList()
        applied = null
    }
}

internal data class SettingsDraftSave<D>(
    val previous: D,
    val target: D,
)
