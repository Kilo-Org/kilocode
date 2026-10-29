package ai.kilocode.backend.repo

import com.intellij.ide.util.PropertiesComponent

/**
 * Whether inferred **nested** repositories (submodules inside a listed repo, vendored checkouts) are
 * shown and auto-added. Default `false`: nested roots are discovered but withheld, so a monorepo with
 * many submodules does not silently register all of them.
 *
 * Mirrors [ai.kilocode.backend.workspace.KiloWorktreeIndexSettings]: a `PropertiesComponent` key with a
 * `@Volatile` fallback so a plain unit test with no Application still works.
 */
object RepoSettings {
    private const val KEY = "kilo.multiRepo.includeNested"

    @Volatile
    private var fallback = false

    fun includeNested(): Boolean = props()?.getBoolean(KEY, false) ?: fallback

    fun setIncludeNested(value: Boolean) {
        fallback = value
        props()?.setValue(KEY, value.toString())
    }

    private fun props(): PropertiesComponent? = runCatching { PropertiesComponent.getInstance() }.getOrNull()
}
