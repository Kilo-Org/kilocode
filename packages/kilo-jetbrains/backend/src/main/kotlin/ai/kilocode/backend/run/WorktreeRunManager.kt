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
import com.intellij.openapi.application.readAction
import com.intellij.openapi.components.Service
import com.intellij.openapi.externalSystem.model.ProjectSystemId
import com.intellij.openapi.externalSystem.model.execution.ExternalSystemTaskExecutionSettings
import com.intellij.openapi.externalSystem.service.execution.ExternalSystemRunConfiguration
import com.intellij.openapi.externalSystem.util.ExternalSystemApiUtil
import com.intellij.openapi.externalSystem.util.ExternalSystemUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.JDOMUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
 * by identity against the clone cache ([keyOf]), recording the started [ProcessHandler] per
 * (config, worktree) key. The reported state is read back from the handler's own state machine, so
 * it cannot drift from what the IDE's Stop button sees.
 *
 * Stop delegates to [ExecutionManagerImpl.stopProcess] — the entry point every platform stop action
 * uses — which records `TERMINATION_REQUESTED`, detaches or destroys per `detachIsDefault()`, and
 * escalates to [KillableProcess.killProcess] when the process is already terminating.
 *
 * [run] and [build] report `ok` once the run is dispatched into the platform pipeline, not once a
 * process is confirmed live: the platform surfaces execution errors itself (via its own error
 * notifications) and there is no public signal for a cancelled restart-confirmation dialog. The
 * [states] flow, read back from real process handlers, is the source of truth for what is running.
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
    private val handlers = ConcurrentHashMap<Key, ProcessHandler>()
    private val flow = MutableStateFlow<List<RunStateDto>>(emptyList())
    private val listening = AtomicBoolean()

    /**
     * Normalized worktree paths that have been released for removal. Because [exec] runs outside
     * [lock], a start already in flight when [release] runs would otherwise begin against a deleted
     * working directory; [processStarted] stops any process whose worktree is in this set. A fresh
     * [run]/[build] clears its own worktree so a directory recreated at the same path works again.
     */
    private val released = ConcurrentHashMap.newKeySet<String>()

    /**
     * Serializes the read-modify-write over [clones] so a double dispatch for the same key cannot
     * create two clones that both execute and lose one process's tracking. Held only around clone
     * creation, never across [exec] (which pumps the EDT and may show a modal).
     */
    private val lock = Mutex()

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
        // Reading a configuration's serialized state (fingerprint) and cloning it can touch the
        // project model, so the whole lookup + clone runs inside a read action.
        val settings = readAction { manager.allSettings.firstOrNull { it.uniqueID == id } }
            ?: return RunResultDto(error = "run configuration not found: $id")
        val repo = project.basePath ?: return RunResultDto(error = "project has no base path")
        val label = label(repo, worktree)
        val clone = lock.withLock {
            released.remove(pathKey(worktree))
            clone(manager, settings, Key(id, worktree), repo, label)
        } ?: return RunResultDto(error = "run configuration not supported: ${settings.name}")
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
        val many = roots.size > 1
        val prepared = lock.withLock {
            released.remove(pathKey(worktree))
            roots.map { root ->
                val settings = WorktreeRunAdapter.buildSettings(root.first, root.second, worktree, repo, clean)
                val name = name(clean, label, root.second, repo, many)
                buildClone(manager, root.first, settings, key(root.second, repo, worktree), name)
                    ?: return RunResultDto(error = "no run configuration type for ${root.first.readableName}")
            }
        }
        for (clone in prepared) {
            LOG.info("worktree build: start config=${clone.name}")
            exec(clone)
        }
        return RunResultDto(ok = true)
    }

    /**
     * Same reuse contract as [clone], except Build and Rebuild intentionally share one settings
     * instance per root/worktree. Switching between them mutates that same settings object before
     * execution, so `isAllowRunningInParallel = false` makes the platform stop the sibling process
     * instead of allowing Build and Rebuild to race over the same output directories.
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
        if (entry != null) {
            val config = entry.settings.configuration as? ExternalSystemRunConfiguration ?: return null
            config.name = name
            config.settings.setFrom(settings)
            entry.settings.name = name
            clones[key] = Entry(entry.settings, print)
            return entry.settings
        }
        val next = ExternalSystemUtil.createExternalSystemRunnerAndConfigurationSettings(settings, project, system)
            ?: return null
        next.name = name
        // A build has no before-run tasks of its own, and must not run in parallel with itself.
        next.configuration.beforeRunTasks = emptyList()
        next.configuration.isAllowRunningInParallel = false
        next.isActivateToolWindowBeforeRun = true
        clones[key] = Entry(next, print)
        return next
    }

    /** Stable per-(root, worktree) key shared by Build/Rebuild so they restart each other. */
    private fun key(root: String, repo: String, worktree: String): Key = Key("kilo.build:${relative(root, repo)}", worktree)

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
     * `restartRunProfile`. When the user edits the source configuration, a fresh clone picks up the
     * changes; because the platform's restart matches by settings identity, that fresh instance
     * would leave the previous process orphaned and unmanageable from the popup, so any process
     * still running under the replaced clone is stopped here first.
     */
    private suspend fun clone(
        manager: RunManager,
        settings: RunnerAndConfigurationSettings,
        key: Key,
        repo: String,
        label: String,
    ): RunnerAndConfigurationSettings? {
        val print = fingerprint(settings.configuration)
        val entry = clones[key]
        if (entry != null && entry.print == print) return entry.settings
        val next = readAction { WorktreeRunAdapter.transplant(manager, settings, key.worktree, repo, label) }
            ?: return null
        if (entry != null) handlers[key]?.let { handler ->
            LOG.info("worktree run: stopping replaced clone before restart config=${key.id} worktree=${key.worktree}")
            ExecutionManagerImpl.stopProcess(handler)
        }
        clones[key] = Entry(next, print)
        return next
    }

    private suspend fun fingerprint(config: RunConfiguration): String = readAction {
        val element = Element("configuration")
        try {
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

    /**
     * Stops every process started in [worktree] and marks it released. Called before the worktree
     * directory is removed so a live process is not left running against a deleted working
     * directory with no way to stop it from the popup.
     *
     * Takes [lock] so it cannot interleave with clone creation, and only marks the worktree instead
     * of dropping the clones: a [run]/[build] whose [exec] is already in flight has its clone in the
     * cache but no handler yet, so leaving the clone lets [processStarted] resolve the key and stop
     * that just-started process too. Terminated processes drop their released clones in the listener.
     */
    suspend fun release(worktree: String): Boolean = lock.withLock {
        val target = pathKey(worktree)
        released.add(target)
        val keys = clones.keys.filter { pathKey(it.worktree) == target }
        keys.forEach { key -> handlers[key]?.let { ExecutionManagerImpl.stopProcess(it) } }
        LOG.info("worktree run: released worktree=$worktree keys=${keys.size}")
        keys.isNotEmpty()
    }

    private fun pathKey(path: String): String = runCatching { Path.of(path).normalize().toString() }.getOrDefault(path)

    /** The (config, worktree) key that currently owns [settings], or null once it has been replaced. */
    private fun keyOf(settings: RunnerAndConfigurationSettings): Key? =
        clones.entries.firstOrNull { it.value.settings === settings }?.key

    private fun listen() {
        if (!listening.compareAndSet(false, true)) return
        project.messageBus.connect(cs).subscribe(ExecutionManager.EXECUTION_TOPIC, object : ExecutionListener {
            override fun processStarted(executorId: String, env: ExecutionEnvironment, handler: ProcessHandler) {
                // A replaced clone is no longer in the cache, so its late start resolves no key and
                // stays manageable only in its own Run tab — never re-adopted here.
                val key = env.runnerAndConfigurationSettings?.let { keyOf(it) } ?: return
                // The worktree was released for removal after this start was already dispatched: stop
                // the process so it does not run against a deleted directory, and forget the clone.
                if (pathKey(key.worktree) in released) {
                    LOG.info("worktree run: stopping start on released worktree=${key.worktree} config=${key.id}")
                    ExecutionManagerImpl.stopProcess(handler)
                    clones.remove(key)
                    return
                }
                handlers[key] = handler
                // The handler's own state machine is the source of truth: it reports STOPPING as soon
                // as termination starts, and drops the entry once the process is gone even if no
                // topic event follows.
                handler.addProcessListener(object : ProcessListener {
                    override fun processWillTerminate(event: ProcessEvent, willBeDestroyed: Boolean) = sync()

                    override fun processTerminated(event: ProcessEvent) {
                        if (handlers.remove(key, handler)) sync()
                        if (pathKey(key.worktree) in released) clones.remove(key)
                    }
                })
                sync()
            }

            override fun processNotStarted(executorId: String, env: ExecutionEnvironment, cause: Throwable?) {
                val key = env.runnerAndConfigurationSettings?.let { keyOf(it) } ?: return
                LOG.warn("worktree run: process not started config=${key.id} worktree=${key.worktree}", cause)
                handlers.remove(key)
                if (pathKey(key.worktree) in released) clones.remove(key)
                sync()
            }

            override fun processTerminated(executorId: String, env: ExecutionEnvironment, handler: ProcessHandler, exitCode: Int) {
                val key = env.runnerAndConfigurationSettings?.let { keyOf(it) } ?: return
                LOG.info("worktree run: terminated config=${key.id} worktree=${key.worktree} exit=$exitCode")
                if (handlers.remove(key, handler)) sync()
                if (pathKey(key.worktree) in released) clones.remove(key)
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
    private suspend fun label(repo: String, worktree: String): String = withContext(Dispatchers.IO) {
        val store = Path.of(repo).normalize().resolve(".kilo").resolve("worktree-names.json")
        val named = readWorktreeState(store).names[worktree]?.trim()
        if (!named.isNullOrEmpty()) return@withContext named
        worktree.trimEnd('/').substringAfterLast('/').ifBlank { worktree }
    }
}
