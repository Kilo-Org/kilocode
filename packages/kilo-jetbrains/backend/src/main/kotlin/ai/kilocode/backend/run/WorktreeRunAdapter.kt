package ai.kilocode.backend.run

import com.intellij.execution.CommonProgramRunConfigurationParameters
import com.intellij.execution.RunManager
import com.intellij.execution.RunnerAndConfigurationSettings
import com.intellij.execution.configurations.ModuleBasedConfiguration
import com.intellij.execution.configurations.RunConfiguration
import com.intellij.openapi.externalSystem.service.execution.ExternalSystemRunConfiguration

/**
 * Decides which run configurations can be transplanted into a git worktree and builds the
 * transient per-worktree clone that the platform execution pipeline runs.
 *
 * Supported:
 * - External-system (Gradle) configurations: the clone's external project path points at the
 *   worktree, so the worktree's own wrapper builds and runs the worktree's code (the Gradle
 *   plugin explicitly handles unlinked project paths by falling back to the path's wrapper).
 * - Command-line style configurations implementing [CommonProgramRunConfigurationParameters]:
 *   the clone's working directory becomes the worktree and WORKTREE_PATH/REPO_PATH env vars
 *   are injected (same contract as the VS Code Agent Manager run scripts).
 *
 * Module-classpath configurations (plain JVM Application, JUnit, ...) are excluded: even with
 * a worktree working directory they would execute the main checkout's compiled classes.
 */
internal object WorktreeRunAdapter {
    const val WORKTREE_ENV = "WORKTREE_PATH"
    const val REPO_ENV = "REPO_PATH"

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
        val clone = source.clone()
        clone.name = "${source.name} [$label]"
        // A "Build project" pre-step would build the main checkout, not the worktree.
        clone.beforeRunTasks = emptyList()
        // Restart on re-run: the platform stops the previous process of the same settings first.
        clone.isAllowRunningInParallel = false
        when (clone) {
            is ExternalSystemRunConfiguration -> {
                clone.settings.externalProjectPath = worktree
                clone.settings.env = clone.settings.env + env(worktree, repo)
            }
            is CommonProgramRunConfigurationParameters -> {
                clone.workingDirectory = worktree
                clone.envs = clone.envs + env(worktree, repo)
            }
        }
        val result = manager.createConfiguration(clone, settings.factory)
        result.isActivateToolWindowBeforeRun = true
        return result
    }

    private fun env(worktree: String, repo: String) = mapOf(WORKTREE_ENV to worktree, REPO_ENV to repo)
}
