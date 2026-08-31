package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.kiloRoot
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.util.UiTimer
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.openapi.application.ApplicationActivationListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.IdeFrame
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

@Service(Service.Level.PROJECT)
class WorktreeStatusService internal constructor(
    private val project: Project,
    private val cs: CoroutineScope,
    private val timers: UiTimerSource = UiTimers,
) {
    constructor(project: Project, cs: CoroutineScope) : this(project, cs, UiTimers)

    companion object {
        private val LOG = KiloLog.create(WorktreeStatusService::class.java)
        private const val STATS_DEBOUNCE = 300
        private const val STATS_POLL = 30_000
        private const val PR_POLL = 120_000
        private const val PR_THROTTLE = 30_000L
    }

    private val statsFlow = MutableStateFlow<Map<String, WorktreeStatsDto>>(emptyMap())
    private val dirtyFlow = MutableStateFlow<Map<String, WorktreeDirtyDto>>(emptyMap())
    private val prFlow = MutableStateFlow<Map<String, WorktreePrDto>>(emptyMap())
    private val ghFlow = MutableStateFlow(GhAvailability.OK)
    private var debounce: UiTimer? = null
    private var statsTimer: UiTimer? = null
    private var prTimer: UiTimer? = null
    private var prJob: Job? = null
    private var refs = 0
    private var lastPr = 0L
    private var github = KiloPluginSettings.getGithub()
    // Bumped whenever a PR lookup starts or is abandoned, so a result that arrives after its reason
    // to exist is gone cannot publish. Mirrors GhStatusCoordinator's probe generation.
    private var generation = 0

    val stats: StateFlow<Map<String, WorktreeStatsDto>> get() = statsFlow
    val dirty: StateFlow<Map<String, WorktreeDirtyDto>> get() = dirtyFlow
    val pr: StateFlow<Map<String, WorktreePrDto>> get() = prFlow
    val gh: StateFlow<GhAvailability> get() = ghFlow

    init {
        val bus = ApplicationManager.getApplication().messageBus.connect(cs)
        bus.subscribe(GithubIntegrationListener.TOPIC, GithubIntegrationListener { enabled -> github(enabled) })
        // A PR can be merged or closed while the IDE sits in the background, so re-check on
        // activation. Unforced, so PR_THROTTLE collapses a burst of focus events into one lookup.
        bus.subscribe(ApplicationActivationListener.TOPIC, object : ApplicationActivationListener {
            override fun applicationActivated(ideFrame: IdeFrame) {
                if (ideFrame.project !== project) return
                refreshPr()
            }
        })
    }

    fun attach(): AutoCloseable {
        refs++
        if (refs == 1) start()
        return AutoCloseable {
            refs = (refs - 1).coerceAtLeast(0)
            if (refs == 0) stop()
        }
    }

    fun refreshStats() {
        if (project.isDisposed || refs == 0) return
        val timer = debounce ?: timers.timer(STATS_DEBOUNCE, repeats = false) { loadStats(); loadDirty() }.also { debounce = it }
        timer.restart()
    }

    fun refreshPr(force: Boolean = false) {
        if (project.isDisposed || refs == 0 || !github) return
        val now = timers.now()
        if (!force && now - lastPr < PR_THROTTLE) return
        lastPr = now
        loadPr()
    }

    private fun start() {
        refreshStats()
        refreshPr(force = true)
        statsTimer = timers.timer(STATS_POLL) { refreshStats() }.also { it.start() }
        if (github) prTimer = timers.timer(PR_POLL) { refreshPr(force = true) }.also { it.start() }
    }

    private fun stop() {
        debounce?.stop()
        statsTimer?.stop()
        prTimer?.stop()
        prJob?.cancel()
        generation++
        debounce = null
        statsTimer = null
        prTimer = null
        prJob = null
    }

    /**
     * Applies a GitHub integration setting change. Disabling cancels the in-flight PR lookup, stops
     * the poll, and clears the PR map so badges, tab titles, and PR actions drop immediately. Git
     * stats and dirty counts are unaffected.
     */
    private fun github(enabled: Boolean) {
        if (github == enabled) return
        github = enabled
        if (!enabled) {
            prTimer?.stop()
            prTimer = null
            prJob?.cancel()
            prJob = null
            generation++
            lastPr = 0
            prFlow.value = emptyMap()
            ghFlow.value = GhAvailability.OK
            return
        }
        if (refs == 0) return
        prTimer = timers.timer(PR_POLL) { refreshPr(force = true) }.also { it.start() }
        refreshPr(force = true)
    }

    private fun loadStats() {
        cs.launch {
            val dir = project.kiloRoot() ?: return@launch
            runCatching { service<KiloWorktreeService>().stats(dir) }
                .onSuccess { dto -> statsFlow.value = dto.items.associateBy { normalizeWorktreePath(it.path) } }
                .onFailure { err -> LOG.warn("worktree stats refresh failed dir=$dir", err) }
        }
    }

    // Resolves the backend root like loadStats rather than reading project.basePath, which is a
    // synthetic JetBrains Client path in split/remote mode. Pointing the backend at that path makes
    // dirty() answer for a directory that does not exist, which reads as "no local changes".
    private fun loadDirty() {
        cs.launch {
            val dir = project.kiloRoot() ?: return@launch
            runCatching { service<KiloWorktreeService>().dirty(dir) }
                .onSuccess { dto -> dirtyFlow.value = dto.items.associateBy { normalizeWorktreePath(it.path) } }
                .onFailure { err -> LOG.warn("worktree dirty refresh failed dir=$dir", err) }
        }
    }

    private fun loadPr() {
        val gen = ++generation
        prJob = cs.launch {
            val dir = project.kiloRoot() ?: return@launch
            runCatching { service<KiloWorktreeService>().prStatus(dir) }
                .onSuccess { dto ->
                    // KiloWorktreeService.prStatus swallows the cancellation and answers with an
                    // empty DTO, so a lookup cancelled by a disable still lands here — and after a
                    // quick re-enable the github flag is true again. Only the newest lookup may
                    // publish, or a stale empty result would wipe fresh badges and report a false OK
                    // over a real UNAUTH.
                    if (gen != generation) return@onSuccess
                    prFlow.value = dto.items.associateBy { normalizeWorktreePath(it.path) }
                    ghFlow.value = dto.availability
                    service<GhStatusCoordinator>().report(project, dto.availability)
                }
                .onFailure { err -> LOG.warn("worktree PR refresh failed dir=$dir", err) }
        }
    }
}
