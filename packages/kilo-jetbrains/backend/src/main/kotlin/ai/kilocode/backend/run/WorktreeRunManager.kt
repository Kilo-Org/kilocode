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
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.jdom.Element
import java.nio.file.Path
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Runs the project's run configurations inside git worktree directories via per-worktree
 * transient clones and tracks their processes. Two ways in, both producing a clone that is never
 * registered in [RunManager]:
 * - [WorktreeRunAdapter] transplants external-system and command-line style configurations directly.
 * - [WorktreeRunDelegate] hands everything else (Spring Boot, Application, Kotlin/Groovy app, ...) to
 *   the build system the platform's own run delegation would use, because a module-based
 *   configuration's classpath comes from the main checkout's modules and cannot be transplanted.
 *
 * State tracking is fully public-API: the manager subscribes to
 * [ExecutionManager.EXECUTION_TOPIC] and matches [ExecutionEnvironment.getRunnerAndConfigurationSettings]
 * by identity against the clone cache ([keyOf]), recording the started [ProcessHandler] per
 * (config, worktree) key. The reported state is read back from the handler's own state machine, so
 * it cannot drift from what the IDE's Stop button sees.
 *
 * Stop delegates to [ExecutionManagerImpl.stopProcess] — the entry point every platform stop action
 * uses — which records `TERMINATION_REQUESTED`, detaches or destroys per `detachIsDefault()`, and
 * escalates to [KillableProcess.killProcess] when the process is already terminating. A delegated run
 * needs one more stage: cancelling a build does not always take the application it forked with it, so
 * [arm] hands any surviving process to [WorktreeRunReaper] and keeps a killable row for it.
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

        /** Poll interval while waiting for a handler to disappear or a reaped pid to exit. */
        private const val REAP_POLL_INTERVAL_MS = 500L

        /** Bound on waiting for the platform's own stop to clear a handler before scanning for orphans. */
        private const val HANDLER_WAIT_MS = 3_000L

        /** Grace period [release] gives a SIGTERM'd orphan before escalating to SIGKILL. */
        private const val RELEASE_GRACE_MS = 3_000L
    }

    internal data class Key(val id: String, val worktree: String)

    /** What [produce] built: the clone to execute, plus source settings that will not apply to it. */
    private data class Produced(val settings: RunnerAndConfigurationSettings, val dropped: List<String> = emptyList())

    /**
     * [start] is when this clone was created — the lower bound [WorktreeRunReaper.match] uses.
     * [reapable] marks clones that can fork an application outliving their own process: a build only
     * forks compiler workers, which are shared and must never be reaped.
     */
    private data class Entry(
        val settings: RunnerAndConfigurationSettings,
        val print: String,
        val dropped: List<String> = emptyList(),
        val reapable: Boolean = false,
        val start: Instant = Instant.now(),
    )

    private val clones = ConcurrentHashMap<Key, Entry>()
    private val handlers = ConcurrentHashMap<Key, ProcessHandler>()

    /**
     * Pids [WorktreeRunReaper] is tracking per key because their [ProcessHandler] is already gone but
     * the forked app JVM it started is not. Populated by [arm], drained once every tracked pid exits
     * or [stop] force-kills them, or dropped without waiting by [release] before a worktree directory
     * is removed.
     */
    private val orphans = ConcurrentHashMap<Key, Set<Long>>()
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

    /**
     * Direct-transplant configs ([WorktreeRunAdapter.supports]) plus, for everything else, the build
     * system the platform's own delegation would hand the configuration to
     * ([WorktreeRunDelegate.support]) — so the popup lists the project's Spring Boot/Application/Kotlin
     * configurations too, not only external-system tasks. Runs under a read action: module lookup
     * requires one.
     *
     * Logs every listed and skipped configuration with the reason, because "my run configuration is
     * missing from the popup" is otherwise indistinguishable from "the backend never ran this".
     */
    suspend fun configs(): RunConfigListDto {
        val manager = RunManager.getInstance(project)
        val skipped = mutableListOf<String>()
        val items = readAction {
            manager.allSettings.mapNotNull { s ->
                val type = s.type.displayName
                if (WorktreeRunAdapter.supports(s.configuration)) {
                    return@mapNotNull RunConfigDto(s.uniqueID, s.name, type)
                }
                when (val support = WorktreeRunDelegate.support(s.configuration)) {
                    is WorktreeRunDelegate.Support.Delegate ->
                        RunConfigDto(s.uniqueID, s.name, type, via = support.via)

                    is WorktreeRunDelegate.Support.Skip -> {
                        skipped += "'${s.name}' [$type] ${support.reason}"
                        null
                    }
                }
            }
        }
        val roots = roots()
        LOG.info(
            "worktree run: configs listed=${items.size} skipped=${skipped.size} buildableRoots=${roots.size}" +
                items.joinToString("") { "\n  + '${it.name}' [${it.type}]${it.via?.let { v -> " via $v" } ?: ""}" } +
                skipped.joinToString("") { "\n  - $it" },
        )
        return RunConfigListDto(items, buildable = roots.isNotEmpty())
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
        val entry = lock.withLock {
            released.remove(pathKey(worktree))
            clone(manager, settings, Key(id, worktree), repo, label)
        } ?: return RunResultDto(error = produceErrorMessage(settings))
        LOG.info("worktree run: start config=${settings.name} worktree=$worktree")
        exec(entry.settings)
        // Reported every start, not only the first: the caveat applies to the run the user just began,
        // and a cached clone reuses the same reduced configuration.
        val warning = entry.dropped.takeIf { it.isNotEmpty() }?.joinToString()
        return RunResultDto(ok = true, warning = warning)
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
    ): Entry? {
        val print = fingerprint(settings.configuration)
        val entry = clones[key]
        if (entry != null && entry.print == print) return entry
        val next = readAction { produce(manager, settings, key.worktree, repo, label) } ?: return null
        if (entry != null) handlers[key]?.let { handler ->
            LOG.info("worktree run: stopping replaced clone before restart config=${key.id} worktree=${key.worktree}")
            val doomed = doomed(key, entry)
            ExecutionManagerImpl.stopProcess(handler)
            arm(key, doomed)
        }
        return Entry(next.settings, print, next.dropped, reapable = true).also { clones[key] = it }
    }

    /**
     * The outgoing run's application, identified before its replacement can start one of its own —
     * both occupy the same [key], so once the replacement is running no later scan could tell them
     * apart. Only pays for a process scan when a source edit actually replaced a live clone.
     *
     * Empty when another run is live in the same worktree, because
     * [WorktreeRunReaper.match] is worktree-wide: a sibling started after [entry] was created is in
     * its result too, and signalling somebody else's application is worse than leaving this one
     * behind. That is the same tradeoff [stop] makes for the same reason.
     */
    private suspend fun doomed(key: Key, entry: Entry): List<Long> {
        if (!entry.reapable) return emptyList()
        val siblings = siblings(key)
        if (siblings.isNotEmpty()) {
            LOG.info(
                "worktree run: not identifying config=${key.id}'s app process in ${key.worktree};" +
                    " cannot tell it apart while ${siblings.map { it.id }} still run there",
            )
            return emptyList()
        }
        return WorktreeRunReaper.match(key.worktree, entry.start, WorktreeRunReaper.scan())
    }

    /** Other keys with a live process in the same worktree as [key]. */
    private fun siblings(key: Key): List<Key> =
        handlers.keys.filter { it != key && pathKey(it.worktree) == pathKey(key.worktree) }

    /**
     * Direct transplant first ([WorktreeRunAdapter] — external-system + CLI-style configs);
     * otherwise delegates to whichever build system's [com.intellij.task.ProjectTaskRunner] the
     * platform itself would use to run this configuration ([WorktreeRunDelegate] — Spring Boot,
     * Application, Kotlin/Groovy app, ...). Called inside a read action.
     */
    private fun produce(
        manager: RunManager,
        settings: RunnerAndConfigurationSettings,
        worktree: String,
        repo: String,
        label: String,
    ): Produced? {
        WorktreeRunAdapter.transplant(manager, settings, worktree, repo, label)?.let {
            LOG.info("worktree run: transplanted config=${settings.name} worktree=$worktree")
            return Produced(it)
        }
        val support = WorktreeRunDelegate.support(settings.configuration)
        if (support is WorktreeRunDelegate.Support.Skip) {
            LOG.info("worktree run: cannot run config=${settings.name}: ${support.reason}")
            return null
        }
        val attempt = WorktreeRunDelegate.delegate(project, settings.configuration, worktree, repo) ?: return null
        LOG.info(
            "worktree run: delegated config=${settings.name} to ${attempt.result.via}" +
                " tasks=${attempt.result.configuration.settings.taskNames} worktree=$worktree" +
                if (attempt.dropped.isEmpty()) "" else " dropped=${attempt.dropped}",
        )
        WorktreeRunDelegate.adapt(attempt.result, worktree, repo, label, settings.name)
        return Produced(attempt.result.settings, attempt.dropped)
    }

    /**
     * Why the run could not be prepared. A configuration whose build system is known but declined it
     * gets the actionable hint; the generic message is for configurations nothing can run.
     */
    private suspend fun produceErrorMessage(settings: RunnerAndConfigurationSettings): String {
        val support = readAction { WorktreeRunDelegate.support(settings.configuration) }
        return when (support) {
            is WorktreeRunDelegate.Support.Delegate ->
                "${support.via} declined to run '${settings.name}' — ${WorktreeRunDelegate.DECLINED_HINT}"

            is WorktreeRunDelegate.Support.Skip ->
                "cannot run '${settings.name}' in a worktree: ${support.reason}"
        }
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
        val key = Key(id, worktree)
        val handler = handlers[key]
        if (handler != null) {
            LOG.info(
                "worktree run: stop config=$id worktree=$worktree" +
                    " terminating=${handler.isProcessTerminating} detach=${handler.detachIsDefault()}",
            )
            // ExecutionManagerImpl lives in an impl package only because ExecutionManager exposes no
            // stop method; stopProcess itself is reviewed public API and is what every platform stop
            // action calls. Termination runs asynchronously, so the state flow updates from the
            // handler events. Gradle has supported build cancellation for JavaExec-backed tasks (which
            // a delegated bootRun/run is) since 4.8, so this SIGTERMs a delegated app's forked JVM in
            // the common case; arm() is the fallback for when it does not.
            ExecutionManagerImpl.stopProcess(handler)
            clones[key]?.takeIf { it.reapable }?.let { arm(key, handler, it.start) }
            return true
        }
        // No live handler: either unknown, or its app JVM outlived it and arm() is already tracking
        // it as an orphan — a second Stop/Kill click force-kills that orphan directly.
        val tracked = orphans[key]
        if (tracked.isNullOrEmpty()) return false
        LOG.info("worktree run: force killing orphan app process config=$id worktree=$worktree pids=$tracked")
        WorktreeRunReaper.terminate(tracked, force = true)
        return true
    }

    /**
     * Stop path: once [handler] has let go of [key], SIGTERMs (never force-kills — that is [stop]'s job
     * on a second call) any app process [WorktreeRunReaper] can match to this worktree since [since].
     *
     * Attribution is by worktree path, not by pid lineage — the application's parent is the build
     * daemon, not the IDE — so it cannot tell one config's application from another's. It therefore
     * declines whenever some other run in the same worktree is still live, rather than risk SIGTERMing
     * an application the user is still using. A live delegated run always has a handler for as long as
     * its application runs, because the build that forked it blocks.
     */
    private fun arm(key: Key, handler: ProcessHandler, since: Instant) {
        cs.launch {
            if (!awaitGone(key, handler)) {
                LOG.info("worktree run: handler still alive after stop, not reaping config=${key.id}")
                return@launch
            }
            val siblings = siblings(key)
            if (siblings.isNotEmpty()) {
                LOG.info(
                    "worktree run: not reaping config=${key.id} worktree=${key.worktree};" +
                        " cannot attribute an app process while ${siblings.map { it.id }} still run there",
                )
                return@launch
            }
            val matches = WorktreeRunReaper.match(key.worktree, since, WorktreeRunReaper.scan())
            if (matches.isEmpty()) {
                LOG.info(
                    "worktree run: no orphan app process started since $since" +
                        " for config=${key.id} worktree=${key.worktree}",
                )
                return@launch
            }
            reap(key, matches)
        }
    }

    /**
     * Replace path: [doomed] came from [doomed], which already applied the sibling guard and scanned
     * before the replacement could start, so the set is settled by the time this runs.
     *
     * It must not wait on a process handler the way the stop-path [arm] does, because the replacement
     * immediately occupies this same [key]: "no handler here" would never come true, and treating the
     * replacement as a failed stop is exactly what abandons the outgoing application.
     */
    private fun arm(key: Key, doomed: List<Long>) {
        if (doomed.isEmpty()) return
        cs.launch {
            // Give the build's own cancellation the same grace the stop path allows, in case it takes
            // its application down without help. Signalling an already-dying process would be harmless
            // anyway; reap() filters the dead and waits out the rest.
            delay(HANDLER_WAIT_MS)
            val alive = doomed.filterNot { WorktreeRunReaper.allDead(listOf(it)) }
            if (alive.isEmpty()) {
                LOG.info("worktree run: replaced run's app process already exited config=${key.id}")
                return@launch
            }
            reap(key, alive)
        }
    }

    /** SIGTERM, publish a killable orphan row, and keep it until every pid is gone. */
    private suspend fun reap(key: Key, pids: List<Long>) {
        LOG.info("worktree run: reaping orphans config=${key.id} worktree=${key.worktree} pids=$pids")
        WorktreeRunReaper.terminate(pids, force = false)
        orphans[key] = pids.toSet()
        sync()
        while (!WorktreeRunReaper.allDead(pids)) delay(REAP_POLL_INTERVAL_MS)
        LOG.info("worktree run: orphans exited config=${key.id} worktree=${key.worktree} pids=$pids")
        orphans.remove(key)
        sync()
    }

    /**
     * Waits until [handler] no longer occupies [key], returning whether it let go. A *replacement*
     * handler on the same key counts as gone: the stop being waited on succeeded, and treating the new
     * run as a failed stop is what would abandon the outgoing application.
     */
    private suspend fun awaitGone(key: Key, handler: ProcessHandler): Boolean {
        val end = System.nanoTime() + HANDLER_WAIT_MS * 1_000_000
        while (handlers[key] === handler && System.nanoTime() < end) delay(REAP_POLL_INTERVAL_MS)
        return handlers[key] !== handler
    }

    private suspend fun awaitHandlersGone(keys: Collection<Key>, timeoutMs: Long) {
        val end = System.nanoTime() + timeoutMs * 1_000_000
        while (keys.any { handlers[it] != null } && System.nanoTime() < end) delay(REAP_POLL_INTERVAL_MS)
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
     *
     * Does not return until [reapBeforeRemoval] has dealt with an application a delegated run forked
     * and left behind, which a plain stop cannot reach.
     */
    suspend fun release(worktree: String): Boolean {
        val keys = lock.withLock {
            val target = pathKey(worktree)
            released.add(target)
            val found = clones.keys.filter { pathKey(it.worktree) == target }
            found.forEach { key -> handlers[key]?.let { ExecutionManagerImpl.stopProcess(it) } }
            LOG.info("worktree run: released worktree=$worktree keys=${found.size}")
            found
        }
        // Runs outside the lock: it can wait several seconds and must not block a run()/build() for a
        // different worktree.
        reapBeforeRemoval(worktree, keys)
        return keys.isNotEmpty()
    }

    /**
     * Stage 2 + 3 for a worktree about to be deleted: wait briefly for the platform's own stop to
     * clear each process handler, SIGTERM any app JVM [WorktreeRunReaper] can still match to the
     * worktree, then SIGKILL whatever survives a short grace period. Bounded and synchronous —
     * [release] must not return until it is safe to remove the worktree directory.
     */
    private suspend fun reapBeforeRemoval(worktree: String, keys: Collection<Key>) {
        if (keys.isEmpty()) return
        awaitHandlersGone(keys, HANDLER_WAIT_MS)
        val since = keys.mapNotNull { clones[it]?.start }.minOrNull()
        keys.forEach { orphans.remove(it) }
        if (since == null) {
            sync()
            return
        }
        val matches = WorktreeRunReaper.match(worktree, since, WorktreeRunReaper.scan())
        if (matches.isEmpty()) {
            sync()
            return
        }
        LOG.info("worktree run: reaping orphan app process(es) before removal worktree=$worktree pids=$matches")
        WorktreeRunReaper.terminate(matches, force = false)
        val end = System.nanoTime() + RELEASE_GRACE_MS * 1_000_000
        while (!WorktreeRunReaper.allDead(matches) && System.nanoTime() < end) delay(REAP_POLL_INTERVAL_MS)
        val alive = matches.filterNot { WorktreeRunReaper.allDead(listOf(it)) }
        if (alive.isNotEmpty()) {
            LOG.info("worktree run: force killing surviving orphan(s) before removal worktree=$worktree pids=$alive")
            WorktreeRunReaper.terminate(alive, force = true)
        }
        sync()
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
        val running = handlers.entries.map { entry ->
            val handler = entry.value
            RunStateDto(
                id = entry.key.id,
                name = clones[entry.key]?.settings?.name ?: entry.key.id,
                worktree = entry.key.worktree,
                state = if (handler.isProcessTerminating) RunProcessState.STOPPING else RunProcessState.RUNNING,
                killable = (handler as? KillableProcess)?.canKillProcess() == true,
            )
        }
        // A handler row wins on key collision — an orphan only exists once its handler is gone, so
        // this only guards against a race between arm()'s scan and a fresh processStarted for the
        // same key.
        val orphaned = orphans.keys.filter { !handlers.containsKey(it) }.map { key ->
            RunStateDto(
                id = key.id,
                name = clones[key]?.settings?.name ?: key.id,
                worktree = key.worktree,
                state = RunProcessState.STOPPING,
                killable = true,
                orphan = true,
            )
        }
        flow.value = (running + orphaned).sortedBy { it.name }
    }

    /** Worktree label for the clone name: stored display name, else the directory basename. */
    private suspend fun label(repo: String, worktree: String): String = withContext(Dispatchers.IO) {
        val store = Path.of(repo).normalize().resolve(".kilo").resolve("worktree-names.json")
        val named = readWorktreeState(store).names[worktree]?.trim()
        if (!named.isNullOrEmpty()) return@withContext named
        worktree.trimEnd('/').substringAfterLast('/').ifBlank { worktree }
    }
}
