package ai.kilocode.backend.run

import ai.kilocode.backend.rpc.readWorktreeState
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.RunConfigDto
import ai.kilocode.rpc.dto.RunConfigListDto
import ai.kilocode.rpc.dto.RunProcessState
import ai.kilocode.rpc.dto.RunResultDto
import ai.kilocode.rpc.dto.RunStateDto
import com.intellij.execution.ExecutionListener
import com.intellij.execution.ExecutionManager
import com.intellij.execution.KillableProcess
import com.intellij.execution.RunManager
import com.intellij.execution.RunnerAndConfigurationSettings
import com.intellij.execution.configurations.RunConfiguration
import com.intellij.execution.executors.DefaultRunExecutor
import com.intellij.execution.impl.ExecutionManagerImpl
import com.intellij.execution.process.ProcessEvent
import com.intellij.execution.process.ProcessHandler
import com.intellij.execution.process.ProcessListener
import com.intellij.execution.runners.ExecutionEnvironment
import com.intellij.execution.runners.ExecutionUtil
import com.intellij.execution.ui.RunContentManager
import com.intellij.openapi.application.EDT
import com.intellij.openapi.components.Service
import com.intellij.openapi.externalSystem.model.ProjectSystemId
import com.intellij.openapi.externalSystem.model.execution.ExternalSystemTaskExecutionSettings
import com.intellij.openapi.externalSystem.util.ExternalSystemApiUtil
import com.intellij.openapi.externalSystem.util.ExternalSystemUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.JDOMUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import org.jdom.Element
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Runs the project's run configurations inside git worktree directories via per-worktree
 * transient clones (see [WorktreeRunAdapter]) and tracks their processes.
 *
 * State tracking is fully public-API: the manager subscribes to
 * [ExecutionManager.EXECUTION_TOPIC] and matches [ExecutionEnvironment.getRunnerAndConfigurationSettings]
 * by identity against the clone cache, recording the started [ProcessHandler] per
 * (config, worktree) key. The reported state is read back from the handler's own state machine, so
 * it cannot drift from what the IDE's Stop button sees.
 *
 * Stop delegates to [ExecutionManagerImpl.stopProcess] — the entry point every platform stop action
 * uses — which records `TERMINATION_REQUESTED`, detaches or destroys per `detachIsDefault()`, and
 * escalates to [KillableProcess.killProcess] when the process is already terminating.
 */
@Service(Service.Level.PROJECT)
class WorktreeRunManager internal constructor(
    private val project: Project,
    private val cs: CoroutineScope,
    private val exec: suspend (RunnerAndConfigurationSettings) -> Unit,
) {
    /** Platform constructor — executes through the real Run pipeline on the EDT. */
    constructor(project: Project, cs: CoroutineScope) : this(project, cs, { settings ->
        withContext(Dispatchers.EDT) {
            ExecutionUtil.runConfiguration(settings, DefaultRunExecutor.getRunExecutorInstance())
        }
    })

    companion object {
        private val LOG = KiloLog.create(WorktreeRunManager::class.java)
    }

    internal data class Key(val id: String, val worktree: String)

    private data class Entry(val settings: RunnerAndConfigurationSettings, val print: String)

    private val clones = ConcurrentHashMap<Key, Entry>()

    /** Every clone ever executed, so late topic events for replaced clones still resolve their key. */
    private val tracked = ConcurrentHashMap<RunnerAndConfigurationSettings, Key>()
    private val handlers = ConcurrentHashMap<Key, ProcessHandler>()
    private val flow = MutableStateFlow<List<RunStateDto>>(emptyList())
    private val listening = AtomicBoolean()

    val states: StateFlow<List<RunStateDto>> get() = flow

    fun configs(): RunConfigListDto {
        val manager = RunManager.getInstance(project)
        val items = manager.allSettings
            .filter { WorktreeRunAdapter.supports(it.configuration) }
            .map { RunConfigDto(it.uniqueID, it.name, it.type.displayName) }
        return RunConfigListDto(items, buildable = roots().isNotEmpty())
    }

    /**
     * Linked external project roots that can be built: the system must have a known task mapping and
     * a registered run configuration type, because without one
     * [ExternalSystemUtil.createExternalSystemRunnerAndConfigurationSettings] cannot build settings.
     *
     * Discovery goes through the generic external-system API so the plugin keeps loading in IDEs that
     * ship without the Gradle plugin.
     */
    private fun roots(): List<Pair<ProjectSystemId, String>> =
        ExternalSystemApiUtil.getAllManagers()
            .filter { WorktreeRunAdapter.buildable(it.systemId) && ExternalSystemUtil.findConfigurationType(it.systemId) != null }
            .flatMap { manager ->
                manager.settingsProvider.`fun`(project).linkedProjectsSettings
                    .map { manager.systemId to it.externalProjectPath }
            }

    suspend fun run(id: String, worktree: String): RunResultDto {
        listen()
        val manager = RunManager.getInstance(project)
        val settings = manager.allSettings.firstOrNull { it.uniqueID == id }
            ?: return RunResultDto(error = "run configuration not found: $id")
        val repo = project.basePath ?: return RunResultDto(error = "project has no base path")
        val clone = clone(manager, settings, Key(id, worktree), repo)
            ?: return RunResultDto(error = "run configuration not supported: ${settings.name}")
        LOG.info("worktree run: start config=${settings.name} worktree=$worktree")
        exec(clone)
        return RunResultDto(ok = true)
    }

    /**
     * Builds [worktree] by running each linked root's build tasks against the worktree's own copy of
     * that root. One process per root, so multi-root projects stay individually stoppable.
     */
    suspend fun build(worktree: String, clean: Boolean): RunResultDto {
        listen()
        val roots = roots()
        if (roots.isEmpty()) return RunResultDto(error = "project has no buildable external project")
        val repo = project.basePath ?: return RunResultDto(error = "project has no base path")
        val label = label(repo, worktree)
        val manager = RunManager.getInstance(project)
        for (root in roots) {
            val settings = WorktreeRunAdapter.buildSettings(root.first, root.second, worktree, repo, clean)
            val name = name(clean, label, root.second, repo, roots.size > 1)
            val clone = buildClone(manager, root.first, settings, key(clean, root.second, repo, worktree), name)
                ?: return RunResultDto(error = "no run configuration type for ${root.first.readableName}")
            LOG.info("worktree build: start tasks=${settings.taskNames} path=${settings.externalProjectPath}")
            exec(clone)
        }
        return RunResultDto(ok = true)
    }

    /**
     * Same reuse contract as [clone]: while the tasks and target path are unchanged the cached
     * settings instance is re-executed, so clicking Build again restarts through the platform's
     * `restartRunProfile` instead of piling up parallel builds.
     */
    private fun buildClone(
        manager: RunManager,
        system: ProjectSystemId,
        settings: ExternalSystemTaskExecutionSettings,
        key: Key,
        name: String,
    ): RunnerAndConfigurationSettings? {
        val print = "${settings.externalProjectPath}|${settings.taskNames.joinToString(" ")}"
        val entry = clones[key]
        if (entry != null && entry.print == print) return entry.settings
        val next = ExternalSystemUtil.createExternalSystemRunnerAndConfigurationSettings(settings, project, system)
            ?: return null
        next.name = name
        // A build has no before-run tasks of its own, and must not run in parallel with itself.
        next.configuration.beforeRunTasks = emptyList()
        next.configuration.isAllowRunningInParallel = false
        next.isActivateToolWindowBeforeRun = true
        clones[key] = Entry(next, print)
        tracked[next] = key
        return next
    }

    /** Stable per-(action, root, worktree) key so Stop and Show Output resolve the right build. */
    private fun key(clean: Boolean, root: String, repo: String, worktree: String): Key {
        val action = if (clean) "kilo.rebuild" else "kilo.build"
        return Key("$action:${relative(root, repo)}", worktree)
    }

    private fun name(clean: Boolean, label: String, root: String, repo: String, qualify: Boolean): String {
        val action = if (clean) "Rebuild" else "Build"
        val base = "$action [$label]"
        if (!qualify) return base
        val rel = relative(root, repo)
        return if (rel.isEmpty()) base else "$base ($rel)"
    }

    private fun relative(root: String, repo: String): String {
        val main = Path.of(repo).normalize()
        val target = runCatching { Path.of(root).normalize() }.getOrNull() ?: return root
        if (!target.isAbsolute || !target.startsWith(main)) return target.fileName?.toString() ?: root
        return main.relativize(target).toString()
    }

    /**
     * Reuses the cached per-worktree clone while the source configuration is unchanged (same
     * serialized state), so re-running restarts the same settings instance via the platform's
     * `restartRunProfile`. When the user edits the source configuration, a fresh clone picks up
     * the changes; a still-running process of the replaced clone keeps its Run tab and stays
     * manageable there.
     */
    private fun clone(
        manager: RunManager,
        settings: RunnerAndConfigurationSettings,
        key: Key,
        repo: String,
    ): RunnerAndConfigurationSettings? {
        val print = fingerprint(settings.configuration)
        val entry = clones[key]
        if (entry != null && entry.print == print) return entry.settings
        val next = WorktreeRunAdapter.transplant(manager, settings, key.worktree, repo, label(repo, key.worktree))
            ?: return null
        clones[key] = Entry(next, print)
        tracked[next] = key
        return next
    }

    private fun fingerprint(config: RunConfiguration): String {
        val element = Element("configuration")
        return try {
            config.writeExternal(element)
            JDOMUtil.write(element)
        } catch (e: Exception) {
            LOG.warn("worktree run: fingerprint failed for ${config.name}", e)
            ""
        }
    }

    fun stop(id: String, worktree: String): Boolean {
        val handler = handlers[Key(id, worktree)] ?: return false
        LOG.info(
            "worktree run: stop config=$id worktree=$worktree" +
                " terminating=${handler.isProcessTerminating} detach=${handler.detachIsDefault()}",
        )
        // ExecutionManagerImpl lives in an impl package only because ExecutionManager exposes no stop
        // method; stopProcess itself is reviewed public API and is what every platform stop action
        // calls. Termination runs asynchronously, so the state flow updates from the handler events.
        ExecutionManagerImpl.stopProcess(handler)
        return true
    }

    suspend fun focus(id: String, worktree: String): Boolean {
        val handler = handlers[Key(id, worktree)] ?: return false
        withContext(Dispatchers.EDT) {
            RunContentManager.getInstance(project)
                .toFrontRunContent(DefaultRunExecutor.getRunExecutorInstance(), handler)
        }
        return true
    }

    private fun listen() {
        if (!listening.compareAndSet(false, true)) return
        project.messageBus.connect(cs).subscribe(ExecutionManager.EXECUTION_TOPIC, object : ExecutionListener {
            override fun processStarted(executorId: String, env: ExecutionEnvironment, handler: ProcessHandler) {
                val settings = env.runnerAndConfigurationSettings ?: return
                val key = tracked[settings] ?: return
                // Only the current clone owns the tracked slot; a late start of a replaced clone
                // stays manageable in its own Run tab but is not re-adopted here.
                if (clones[key]?.settings !== settings) return
                handlers[key] = handler
                // The handler's own state machine is the source of truth: it reports STOPPING as soon
                // as termination starts, and drops the entry once the process is gone even if no
                // topic event follows.
                handler.addProcessListener(object : ProcessListener {
                    override fun processWillTerminate(event: ProcessEvent, willBeDestroyed: Boolean) = sync()

                    override fun processTerminated(event: ProcessEvent) {
                        if (handlers.remove(key, handler)) sync()
                    }
                })
                sync()
            }

            override fun processNotStarted(executorId: String, env: ExecutionEnvironment, cause: Throwable?) {
                val settings = env.runnerAndConfigurationSettings ?: return
                val key = tracked[settings] ?: return
                if (clones[key]?.settings !== settings) return
                LOG.warn("worktree run: process not started config=${key.id} worktree=${key.worktree}", cause)
                handlers.remove(key)
                sync()
            }

            override fun processTerminated(executorId: String, env: ExecutionEnvironment, handler: ProcessHandler, exitCode: Int) {
                val settings = env.runnerAndConfigurationSettings ?: return
                val key = tracked[settings] ?: return
                LOG.info("worktree run: terminated config=${key.id} worktree=${key.worktree} exit=$exitCode")
                if (clones[key]?.settings !== settings) {
                    // A replaced clone finished; forget it without touching the current process.
                    tracked.remove(settings)
                    return
                }
                if (handlers.remove(key, handler)) sync()
            }
        })
    }

    private fun sync() {
        flow.value = handlers.entries
            .map { entry ->
                val handler = entry.value
                RunStateDto(
                    id = entry.key.id,
                    name = clones[entry.key]?.settings?.name ?: entry.key.id,
                    worktree = entry.key.worktree,
                    state = if (handler.isProcessTerminating) RunProcessState.STOPPING else RunProcessState.RUNNING,
                    killable = (handler as? KillableProcess)?.canKillProcess() == true,
                )
            }
            .sortedBy { it.name }
    }

    /** Worktree label for the clone name: stored display name, else the directory basename. */
    private fun label(repo: String, worktree: String): String {
        val store = Path.of(repo).normalize().resolve(".kilo").resolve("worktree-names.json")
        val named = readWorktreeState(store).names[worktree]?.trim()
        if (!named.isNullOrEmpty()) return named
        return worktree.trimEnd('/').substringAfterLast('/').ifBlank { worktree }
    }
}
