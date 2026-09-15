package ai.kilocode.backend.run

import ai.kilocode.log.KiloLog
import com.intellij.execution.CommonProgramRunConfigurationParameters
import com.intellij.execution.RunManager
import com.intellij.execution.RunnerAndConfigurationSettings
import com.intellij.execution.configurations.ModuleBasedConfiguration
import com.intellij.execution.configurations.RunConfiguration
import com.intellij.openapi.externalSystem.model.ProjectSystemId
import com.intellij.openapi.externalSystem.model.execution.ExternalSystemTaskExecutionSettings
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
 *
 * The adapter also synthesizes the worktree build ([buildSettings]). A real IDE Build Project is
 * impossible here: `ProjectTaskManager` describes work as [com.intellij.openapi.module.Module]
 * instances, which only exist for an open project, so a worktree directory can never be its target.
 * Running the external system's own build tasks against the worktree copy of a linked root is the
 * reachable equivalent, and relies on the same unlinked-path support as the transplanted configs.
 */
internal object WorktreeRunAdapter {
    const val WORKTREE_ENV = "WORKTREE_PATH"
    const val REPO_ENV = "REPO_PATH"

    /** Gradle's own debug switch, read by its always-injected `JvmDebugInit` script. */
    const val DEBUGGER_ENV = "DEBUGGER_ENABLED"

    /**
     * Build tasks per external system id, mirroring what the IDE's delegated build runs.
     *
     * `classes`/`testClasses` compile main and test sources without packaging or running tests,
     * which is what Build Project does; unqualified names run in the root project and every
     * subproject. `build` is deliberately not used — it also runs tests and checks.
     *
     * Rebuild prepends `clean`. The IDE instead injects `outputs.upToDateWhen { false }` on
     * `AbstractCompile`, but that init script is generated from imported per-module Gradle paths,
     * which an unlinked worktree path does not have.
     */
    private val TASKS = mapOf("GRADLE" to listOf("classes", "testClasses"))

    private const val CLEAN_TASK = "clean"

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

    /** Whether [system] has a known build task mapping, i.e. whether its roots can be built. */
    fun buildable(system: ProjectSystemId): Boolean = TASKS.containsKey(system.id)

    /** Build tasks for [system]; empty when unknown. [clean] prepends `clean` for Rebuild. */
    fun buildTasks(system: ProjectSystemId, clean: Boolean): List<String> {
        val tasks = TASKS[system.id] ?: return emptyList()
        return if (clean) listOf(CLEAN_TASK) + tasks else tasks
    }

    /**
     * Task settings that build [root] — a linked external project root of the main checkout — inside
     * [worktree]. The path is rebased exactly like a transplanted configuration's, so a root nested
     * at `<repo>/packages/kilo-jetbrains` builds `<worktree>/packages/kilo-jetbrains`, and a root
     * that is the repository itself builds the worktree root.
     */
    fun buildSettings(
        system: ProjectSystemId,
        root: String,
        worktree: String,
        repo: String,
        clean: Boolean,
    ): ExternalSystemTaskExecutionSettings {
        val settings = ExternalSystemTaskExecutionSettings()
        settings.externalSystemIdString = system.id
        settings.externalProjectPath = rebase(root, repo, worktree)
        settings.taskNames = buildTasks(system, clean)
        settings.env = env(worktree, repo)
        return settings
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

    /** Shared with [WorktreeRunDelegate] for delegated (Gradle-executed) configs. */
    internal fun env(worktree: String, repo: String) = mapOf(
        WORKTREE_ENV to worktree,
        REPO_ENV to repo,
        // Neutralize an inherited Gradle debug session. When the IDE itself was launched by
        // "Debug" on a Gradle task, its own environment carries DEBUGGER_ENABLED/DEBUGGER_ID, and
        // ExternalSystemTaskExecutionSettings.isPassParentEnvs is true by default, so a worktree
        // execution inherits them. Gradle always injects the JvmDebugInit script, which then
        // instruments every forked start task and reads the idea.debugger.dispatch.port system
        // property that only a real debug session sets — failing the task outright. Worktree
        // executions always use the Run executor, so debugging is never wanted here. An explicit
        // "false" is required: omitting the key cannot unset an inherited value.
        DEBUGGER_ENV to "false",
    )
}
