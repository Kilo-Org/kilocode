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
import com.intellij.util.concurrency.annotations.RequiresEdt
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
    private val away = Away { timers.now() }
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
        // activation. The platform publishes both callbacks on the EDT, which is what lets the
        // absence be tracked in plain fields alongside the rest of this service's state.
        bus.subscribe(ApplicationActivationListener.TOPIC, object : ApplicationActivationListener {
            override fun applicationActivated(ideFrame: IdeFrame) {
                if (ideFrame.project !== project) return
                focus()
            }

            // Unfiltered: the absence belongs to the application, not to one frame, so every open
            // project records it and each consumes its own copy when that project is focused again.
            override fun applicationDeactivated(ideFrame: IdeFrame) = away.left()
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

    /**
     * Reloads PR state. [force] bypasses [PR_THROTTLE], the frontend floor between lookups. [maxAge]
     * caps how old a cached backend answer may be and is the only way past the backend's own PR
     * cache, so a caller that needs to observe a change made outside the IDE has to pass it.
     *
     * The two are separate because they guard different costs: the throttle guards the RPC round
     * trip, [maxAge] guards the per-worktree `gh` fan-out behind it.
     */
    fun refreshPr(force: Boolean = false, maxAge: Long? = null) {
        if (project.isDisposed || refs == 0 || !github) return
        // One lookup at a time, whatever the caller asked for. [force] bypasses the throttle, so
        // without this a caller returning to the IDE every few seconds could stack lookups faster than
        // they finish — and each one fans out to several concurrent `gh` calls, so they would multiply
        // that cost rather than answer sooner. Skipping instead of cancelling keeps the work already
        // spawned; the poll and the next focus correct whatever the running lookup began too early to
        // observe.
        if (prJob?.isActive == true) {
            LOG.info("worktree PR refresh skipped, lookup in flight force=$force maxAge=${maxAge ?: "default"}")
            return
        }
        val now = timers.now()
        if (!force && now - lastPr < PR_THROTTLE) return
        lastPr = now
        loadPr(maxAge)
    }

    /**
     * Reloads PR state on return to the IDE, scaled to the absence. A dialog or popup that never took
     * focus out of the IDE reports no absence and costs nothing; a quick window switch takes the
     * throttled path; a long absence is the case worth paying a full `gh` fan-out for, and is also the
     * only path that can get past the backend's own PR cache.
     */
    // Assertion-free: the rest of this service is EDT-confined by the same convention rather than by
    // enforcement, and its public entry points are reached from tests directly.
    @RequiresEdt(generateAssertion = false)
    private fun focus() {
        val gone = away.back() ?: return
        // The bar is the throttle this bypasses: a forced return spends a `gh` call per worktree, so
        // absences shorter than the floor the poll already keeps must not be able to beat it.
        val max = Away.ceiling(gone, PR_THROTTLE)
        refreshPr(force = max != null, maxAge = max)
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

    private fun loadPr(maxAge: Long? = null) {
        val gen = ++generation
        prJob = cs.launch {
            val dir = project.kiloRoot() ?: return@launch
            runCatching { service<KiloWorktreeService>().prStatus(dir, maxAge) }
                .onSuccess { dto ->
                    // KiloWorktreeService.prStatus swallows the cancellation and answers with an
                    // empty DTO, so a lookup cancelled by a disable still lands here — and after a
                    // quick re-enable the github flag is true again. Only the newest lookup may
                    // publish, or a stale empty result would wipe fresh badges and report a false OK
                    // over a real UNAUTH.
                    if (gen != generation) return@onSuccess
                    // A spent GitHub budget carries no pull request data and says nothing about the
                    // pull requests themselves, so the rows keep what they had and the banner explains
                    // why it stopped moving. Publishing the empty list would instead blank every badge
                    // for up to an hour over something the user cannot act on.
                    if (dto.availability != GhAvailability.RATE_LIMITED) {
                        prFlow.value = dto.items.associateBy { normalizeWorktreePath(it.path) }
                    }
                    ghFlow.value = dto.availability
                    service<GhStatusCoordinator>().report(project, dto.availability)
                }
                .onFailure { err -> LOG.warn("worktree PR refresh failed dir=$dir", err) }
        }
    }
}
