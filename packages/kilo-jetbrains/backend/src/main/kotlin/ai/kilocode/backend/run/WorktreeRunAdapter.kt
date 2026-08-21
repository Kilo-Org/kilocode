package ai.kilocode.backend.run

import ai.kilocode.log.KiloLog
import com.intellij.execution.CommonProgramRunConfigurationParameters
import com.intellij.execution.RunManager
import com.intellij.execution.RunnerAndConfigurationSettings
import com.intellij.execution.configurations.ModuleBasedConfiguration
import com.intellij.execution.configurations.RunConfiguration
import com.intellij.openapi.externalSystem.service.execution.ExternalSystemRunConfiguration
import java.nio.file.Path

/**
 * Decides which run configurations can be transplanted into a git worktree and builds the
 * transient per-worktree clone that the platform execution pipeline runs.
 *
 * Supported:
 * - External-system (Gradle) configurations: the clone's external project path is mapped onto
 *   the worktree, so the worktree's own wrapper builds and runs the worktree's code (the Gradle
 *   plugin explicitly handles unlinked project paths by falling back to the path's wrapper).
 * - Command-line style configurations implementing [CommonProgramRunConfigurationParameters]:
 *   the clone's working directory is mapped onto the worktree and WORKTREE_PATH/REPO_PATH env
 *   vars are injected (same contract as the VS Code Agent Manager run scripts).
 *
 * Paths are rebased rather than replaced, because both fields commonly point at a subproject
 * (`<repo>/packages/kilo-jetbrains`) rather than the repository root; see [rebase].
 *
 * Module-classpath configurations (plain JVM Application, JUnit, ...) are excluded: even with
 * a worktree working directory they would execute the main checkout's compiled classes.
 */
internal object WorktreeRunAdapter {
    const val WORKTREE_ENV = "WORKTREE_PATH"
    const val REPO_ENV = "REPO_PATH"

    private val LOG = KiloLog.create(WorktreeRunAdapter::class.java)

    /**
     * Serialized project-root macro. Values loaded from disk are already expanded by
     * `RunnerAndConfigurationSettingsImpl.readExternal`, but a field edited in the current
     * session can still hold the raw macro, which would expand against the main checkout.
     */
    private const val PROJECT_MACRO = "\$PROJECT_DIR\$"

    fun supports(config: RunConfiguration): Boolean {
        if (config is ExternalSystemRunConfiguration) return true
        if (config !is CommonProgramRunConfigurationParameters) return false
        return config !is ModuleBasedConfiguration<*, *>
    }

    /**
     * Builds a transient per-worktree clone of [settings] named `"<name> [label]"`. The clone is
     * never registered in [RunManager]; reusing the same instance per (config, worktree) key gives
     * natural restart semantics via the platform's `restartRunProfile`. Returns null when the
     * configuration type is not supported.
     */
    fun transplant(
        manager: RunManager,
        settings: RunnerAndConfigurationSettings,
        worktree: String,
        repo: String,
        label: String,
    ): RunnerAndConfigurationSettings? {
        val source = settings.configuration
        if (!supports(source)) return null
        // ExternalSystemRunConfiguration.clone() returns null when its factory is missing or the
        // serialization round trip fails; treat that as unsupported instead of crashing the run.
        val clone = source.clone() ?: run {
            LOG.warn("worktree run: clone failed for ${source.name}")
            return null
        }
        clone.name = "${source.name} [$label]"
        // A "Build project" pre-step would build the main checkout, not the worktree.
        clone.beforeRunTasks = emptyList()
        // Restart on re-run: the platform stops the previous process of the same settings first.
        clone.isAllowRunningInParallel = false
        when (clone) {
            is ExternalSystemRunConfiguration -> {
                clone.settings.externalProjectPath = rebase(clone.settings.externalProjectPath, repo, worktree)
                clone.settings.env = clone.settings.env + env(worktree, repo)
            }
            is CommonProgramRunConfigurationParameters -> {
                clone.workingDirectory = rebase(clone.workingDirectory, repo, worktree)
                clone.envs = clone.envs + env(worktree, repo)
            }
        }
        val result = manager.createConfiguration(clone, settings.factory)
        result.isActivateToolWindowBeforeRun = true
        return result
    }

    /**
     * Maps a configured path onto the worktree so nested projects keep working:
     * `<repo>/packages/kilo-jetbrains` becomes `<worktree>/packages/kilo-jetbrains`, which keeps
     * subproject task names such as `:runIdeSplitMode` resolvable.
     *
     * - blank, the repo root, or the bare project macro resolve to the worktree root
     * - relative paths resolve against the worktree
     * - absolute paths already inside [worktree] are kept, so managed worktrees living under
     *   `<repo>/.kilo/worktrees/<name>` are never nested a second time
     * - absolute paths under [repo] are rebased onto [worktree]
     * - absolute paths outside [repo] are kept as configured, since they are not part of the
     *   transplanted tree (an external tool or data directory)
     */
    fun rebase(path: String?, repo: String, worktree: String): String {
        val raw = path?.trim().orEmpty()
        val root = Path.of(worktree).normalize()
        if (raw.isEmpty() || raw == PROJECT_MACRO) return worktree
        if (raw.startsWith(PROJECT_MACRO)) {
            val rest = raw.substring(PROJECT_MACRO.length).trimStart('/', '\\')
            return if (rest.isEmpty()) root.toString() else root.resolve(Path.of(rest)).normalize().toString()
        }
        val target = runCatching { Path.of(raw) }.getOrNull() ?: return raw
        if (!target.isAbsolute) return root.resolve(target).normalize().toString()
        val normalized = target.normalize()
        if (normalized.startsWith(root)) return normalized.toString()
        val main = Path.of(repo).normalize()
        if (!normalized.startsWith(main)) return raw
        val rel = main.relativize(normalized)
        return if (rel.toString().isEmpty()) root.toString() else root.resolve(rel).normalize().toString()
    }

    private fun env(worktree: String, repo: String) = mapOf(WORKTREE_ENV to worktree, REPO_ENV to repo)
}
