package ai.kilocode.backend.workspace

import com.intellij.ide.util.PropertiesComponent

/**
 * Whether Kilo-managed worktrees under `.kilo/worktrees` should be indexed by the project that
 * contains them. Defaults to `false`: worktrees are excluded from the containing project's index
 * (see [KiloWorktreeExcludePolicy]). Opening a worktree as its own project is unaffected either way.
 */
object KiloWorktreeIndexSettings {
    private const val KEY = "kilo.indexWorktrees"

    @Volatile
    private var fallback = false

    fun get(): Boolean {
        val props = props()
        return props?.getBoolean(KEY, false) ?: fallback
    }

    fun set(value: Boolean) {
        fallback = value
        val props = props()
        props?.setValue(KEY, value.toString())
    }

    private fun props(): PropertiesComponent? = runCatching { PropertiesComponent.getInstance() }.getOrNull()
}
