package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.kiloRoot
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.util.UiTimer
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import ai.kilocode.client.util.edt
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
    /** Trailing lookup for a return held back by the spend floor. See [hold]. */
    private var trail: UiTimer? = null
    /** Freshness ceiling the held return is waiting to spend, or null when none is held. */
    private var pending: Long? = null
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
        //
        // Unfiltered on both sides: the absence belongs to the application, not to one frame, so every
        // open project records it and consumes its own copy on the next activation, whichever frame
        // reports it. Routing activation on ideFrame.project instead left a project whose frame never
        // regains focus holding an absence it could never consume, and the frame the platform hands us
        // can report a null or default project (welcome screen), which matched nothing at all.
        bus.subscribe(ApplicationActivationListener.TOPIC, object : ApplicationActivationListener {
            override fun applicationActivated(ideFrame: IdeFrame) = focus()

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
        if (!force && now - lastPr < PR_THROTTLE) {
            LOG.info("worktree PR refresh throttled sinceMs=${now - lastPr}")
            return
        }
        lastPr = now
        loadPr(maxAge)
    }

    /**
     * Reloads PR state on return to the IDE, scaled to the absence. A dialog or popup that never took
     * focus out of the IDE reports no absence and costs nothing; a quick window switch takes the
     * throttled path; an absence long enough to have contained an external change is worth paying a
     * full `gh` fan-out for, and is the only path that can get past the backend's own PR cache.
     *
     * The absence decides whether a return *deserves* fresh data; [PR_THROTTLE] decides whether we may
     * *pay* for it yet. Keeping the two apart is what lets the bar sit at [Away.FRESH] — low enough to
     * catch a quick trip to a browser — without letting steady window switching multiply a fan-out
     * that costs several `gh` calls per worktree.
     */
    // Assertion-free: the rest of this service is EDT-confined by the same convention rather than by
    // enforcement, and its public entry points are reached from tests directly.
    @RequiresEdt(generateAssertion = false)
    private fun focus() {
        val gone = away.back() ?: run {
            LOG.info("worktree PR focus ignored, no absence to answer")
            return
        }
        // A spent budget carries no PR data and refuses the fan-out anyway, so a return cannot learn
        // anything by paying for one. The poll stays the single probe that notices the reset.
        if (ghFlow.value == GhAvailability.RATE_LIMITED) {
            LOG.info("worktree PR focus skipped, github budget spent goneMs=$gone")
            return
        }
        // Under the bar the absence is window churn: reload, but let the backend answer from cache.
        val max = Away.ceiling(gone) ?: return refreshPr()
        hold(max)
    }

    /**
     * Records a return that deserves fresh data, then tries to spend it. The record is what makes a
     * return that cannot run right now survive: the strictest ceiling wins, and the newest return can
     * never make an earlier one cheaper.
     */
    @RequiresEdt(generateAssertion = false)
    private fun hold(max: Long) {
        pending = pending?.let { minOf(it, max) } ?: max
        spend()
    }

    /**
     * Spends the held return when nothing stands in the way, and otherwise leaves it held for whichever
     * trigger clears first — the floor timer, or the completion of the lookup already running.
     *
     * Both blockers must hold rather than drop. The spend floor is the cheap case: the request only has
     * to wait out the rest of the window. The in-flight lookup is the dangerous one, because it may have
     * started *before* the departure, so its answer can predate the very change the return came back to
     * see; dropping the request there would leave that stale answer standing until the next [PR_POLL].
     */
    @RequiresEdt(generateAssertion = false)
    private fun spend() {
        val max = pending ?: return
        if (project.isDisposed || refs == 0 || !github) {
            pending = null
            return
        }
        // Re-checked here and not only at focus time: a lookup that landed while the return was held can
        // report the budget spent, and the fan-out it would pay for is the one GitHub is refusing.
        if (ghFlow.value == GhAvailability.RATE_LIMITED) {
            LOG.info("worktree PR focus dropped, github budget spent maxAge=$max")
            pending = null
            return
        }
        // Its completion calls back here, so the return stays held instead of stacking a second fan-out.
        if (prJob?.isActive == true) {
            LOG.info("worktree PR focus held, lookup in flight maxAge=$max")
            return
        }
        val since = timers.now() - lastPr
        if (since < PR_THROTTLE) {
            LOG.info("worktree PR focus deferred maxAge=$max sinceMs=$since")
            arm(PR_THROTTLE - since)
            return
        }
        pending = null
        trail?.stop()
        trail = null
        LOG.info("worktree PR focus resumed maxAge=$max")
        refreshPr(force = true, maxAge = max)
    }

    /**
     * Arms the trailing lookup at the end of the current floor window. Deliberately not a sliding
     * debounce: a continuing burst must not keep pushing the deadline out, so an already-armed timer is
     * left alone and the window end stays fixed from the first deferral.
     */
    @RequiresEdt(generateAssertion = false)
    private fun arm(wait: Long) {
        if (trail?.isRunning() == true) return
        trail = timers.timer(wait.coerceAtLeast(1).toInt(), repeats = false) { flush() }.also { it.start() }
    }

    @RequiresEdt(generateAssertion = false)
    private fun flush() {
        trail = null
        spend()
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
        trail?.stop()
        prJob?.cancel()
        generation++
        debounce = null
        statsTimer = null
        prTimer = null
        trail = null
        pending = null
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
            // A return held from before the toggle has nothing left to ask about, and must not survive
            // to spend a fan-out once the integration is switched back on.
            trail?.stop()
            trail = null
            pending = null
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
                .onFailure { err -> LOG.warn("worktree stats refresh failed dir=$dir (previous values kept)", err) }
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
                .onFailure { err -> LOG.warn("worktree dirty refresh failed dir=$dir (previous values kept)", err) }
        }
    }

    private fun loadPr(maxAge: Long? = null) {
        val gen = ++generation
        val job = cs.launch {
            val dir = project.kiloRoot() ?: return@launch
            runCatching { service<KiloWorktreeService>().prStatus(dir, maxAge) }
                .onSuccess { dto ->
                    // KiloWorktreeService.prStatus swallows the cancellation and answers with an
                    // empty DTO, so a lookup cancelled by a disable still lands here — and after a
                    // quick re-enable the github flag is true again. Only the newest lookup may
                    // publish, or a stale empty result would wipe fresh badges and report a false OK
                    // over a real UNAUTH.
                    if (gen != generation) return@onSuccess
                    LOG.info("worktree PR refresh done items=${dto.items.size} value=${dto.availability} maxAge=${maxAge ?: "default"}")
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
        prJob = job
        // Covers every way the lookup can end — answered, failed, cancelled, or returned early on an
        // unresolved root — so a return held behind it is spent rather than left for the poll. A
        // superseded generation means a newer lookup already owns the loop and will drain it instead.
        job.invokeOnCompletion { edt { if (gen == generation) spend() } }
    }
}
