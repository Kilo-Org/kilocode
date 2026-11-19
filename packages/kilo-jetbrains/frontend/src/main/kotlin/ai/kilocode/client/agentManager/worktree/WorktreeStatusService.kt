package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.kiloRoot
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.util.UiTimer
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import ai.kilocode.client.util.edt
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.SessionActivityDto
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
    // Live session activity, as a lambda so the platform constructor below does not reach into
    // another project service while this one is still being built — it is called from a coroutine
    // instead. Defaults to a flow that never emits, so a test only wires this up when it is about
    // turn endings.
    activity: () -> StateFlow<Map<String, SessionActivityDto>> = { MutableStateFlow(emptyMap()) },
) {
    constructor(project: Project, cs: CoroutineScope) :
        this(project, cs, UiTimers, { project.service<KiloSessionService>().activity })

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
    /** In-flight stats/dirty polls, so a slow repository cannot stack fan-outs. See [loadStats]. */
    private var statsJob: Job? = null
    private var dirtyJob: Job? = null
    /** Trailing lookup for a request held back by the spend floor. See [hold]. */
    private var trail: UiTimer? = null
    /** The request waiting to be spent, or null when none is held. */
    private var want: Want? = null
    /** Worktree activity as of the previous snapshot, so an agent that stopped can be spotted. */
    private var kinds = emptyMap<String, SessionActivityKind>()
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
        cs.launch { activity().collect { snap -> edt { turned(aggregateWorktreeActivity(snap)) } } }
    }

    /** A refresh waiting for the spend floor, or for the lookup already running, to clear. */
    private data class Want(
        /** The strictest freshness ceiling held, or null to accept whatever the backend's TTL allows. */
        val age: Long?,
        /** Worktree paths whose cached answers are refused however loose [age] is. */
        val paths: Set<String>,
    )

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
     *
     * [fresh] names worktrees whose cached answers the backend must refuse whatever [maxAge] says,
     * for a caller that learned something about those rows in particular. See [stopped].
     */
    fun refreshPr(force: Boolean = false, maxAge: Long? = null, fresh: List<String> = emptyList()) {
        if (project.isDisposed || refs == 0 || !github) return
        // One lookup at a time, whatever the caller asked for. [force] bypasses the throttle, so
        // without this a caller returning to the IDE every few seconds could stack lookups faster than
        // they finish — and each one fans out to several concurrent `gh` calls, so they would multiply
        // that cost rather than answer sooner. Skipping instead of cancelling keeps the work already
        // spawned; the poll and the next focus correct whatever the running lookup began too early to
        // observe.
        if (prJob?.isActive == true) {
            LOG.info(
                "worktree PR refresh skipped, lookup in flight force=$force " +
                    "maxAge=${maxAge ?: "default"} fresh=${fresh.size}",
            )
            return
        }
        val now = timers.now()
        if (!force && now - lastPr < PR_THROTTLE) {
            LOG.info("worktree PR refresh throttled sinceMs=${now - lastPr}")
            return
        }
        lastPr = now
        loadPr(maxAge, fresh)
    }

    /**
     * Records that the agent working in [path] has stopped, so the next lookup resolves that
     * worktree from `gh` rather than from anything cached for it.
     *
     * This is the signal nothing else carries. A pull request opened from inside a worktree — the
     * usual way one appears in Agent Manager — changes neither the branch nor the head commit, which
     * is exactly what the backend keys its "this checkout has no pull request" answer by, so the
     * badge stayed hidden for as long as that answer was allowed to live. Nothing local moved, so
     * neither the poll nor a return to the IDE could tell the difference.
     *
     * Held rather than spent, so a repository full of busy agents cannot cost a lookup per turn
     * ending: the floor collapses a burst of them onto one lookup carrying every path they named.
     */
    @RequiresEdt(generateAssertion = false)
    private fun stopped(path: String) {
        if (project.isDisposed || refs == 0 || !github) return
        // Same reasoning as the focus path: the fan-out this would pay for is the one GitHub is
        // refusing, and the poll stays the single probe that notices the budget reset.
        if (ghFlow.value == GhAvailability.RATE_LIMITED) {
            LOG.info("worktree PR lookup skipped, github budget spent path=$path")
            return
        }
        LOG.info("worktree PR lookup owed, agent stopped path=$path")
        // No ceiling of its own: naming the path is what makes this lookup fresh, and the other rows
        // have had nothing happen to them worth re-running their `gh` ladder for.
        hold(null, setOf(path))
    }

    /**
     * Spots the worktrees whose agents stopped between [kinds] and [next], then adopts [next].
     *
     * Leaving [SessionActivityKind.RUNNING] is the transition that matters, whichever way it goes: to
     * no activity at all when the turn simply ended, or to a question, a permission or an error when
     * it stopped on something. Every one of those is a point where an agent has finished doing work
     * and may have opened a pull request on the way there. Entering RUNNING is not — nothing has
     * happened yet — and a row that was already not running has no new work to account for.
     */
    @RequiresEdt(generateAssertion = false)
    private fun turned(next: Map<String, SessionActivityKind>) {
        val was = kinds
        kinds = next
        for ((path, kind) in was) {
            if (kind != SessionActivityKind.RUNNING) continue
            if (next[path] == SessionActivityKind.RUNNING) continue
            stopped(path)
        }
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
     * Records a request that deserves fresh data, then tries to spend it. The record is what makes a
     * request that cannot run right now survive: the strictest ceiling wins, every named path
     * accumulates, and a newer request can never make an earlier one cheaper.
     */
    @RequiresEdt(generateAssertion = false)
    private fun hold(age: Long?, paths: Set<String> = emptySet()) {
        val held = want
        want = if (held == null) Want(age, paths) else Want(strict(held.age, age), held.paths + paths)
        spend()
    }

    /** The stricter of two freshness ceilings, where null is the loosest there is. */
    private fun strict(a: Long?, b: Long?): Long? {
        if (a == null) return b
        if (b == null) return a
        return minOf(a, b)
    }

    /**
     * Spends the held request when nothing stands in the way, and otherwise leaves it held for whichever
     * trigger clears first — the floor timer, or the completion of the lookup already running.
     *
     * Both blockers must hold rather than drop. The spend floor is the cheap case: the request only has
     * to wait out the rest of the window. The in-flight lookup is the dangerous one, because it may have
     * started *before* the departure or the turn ending, so its answer can predate the very change the
     * request came back to see; dropping it there would leave that stale answer standing until the next
     * [PR_POLL].
     */
    @RequiresEdt(generateAssertion = false)
    private fun spend() {
        val held = want ?: return
        if (project.isDisposed || refs == 0 || !github) {
            want = null
            return
        }
        // Re-checked here and not only when the request was recorded: a lookup that landed while it was
        // held can report the budget spent, and the fan-out it would pay for is the one GitHub is refusing.
        if (ghFlow.value == GhAvailability.RATE_LIMITED) {
            LOG.info("worktree PR request dropped, github budget spent ${describe(held)}")
            want = null
            return
        }
        // Its completion calls back here, so the request stays held instead of stacking a second fan-out.
        if (prJob?.isActive == true) {
            LOG.info("worktree PR request held, lookup in flight ${describe(held)}")
            return
        }
        val since = timers.now() - lastPr
        if (since < PR_THROTTLE) {
            LOG.info("worktree PR request deferred ${describe(held)} sinceMs=$since")
            arm(PR_THROTTLE - since)
            return
        }
        want = null
        trail?.stop()
        trail = null
        LOG.info("worktree PR request resumed ${describe(held)}")
        refreshPr(force = true, maxAge = held.age, fresh = held.paths.toList())
    }

    private fun describe(held: Want): String = "maxAge=${held.age ?: "default"} fresh=${held.paths.size}"

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
        // The stats/dirty guards are what keep polls from stacking, so a job that outlives its last
        // attach() would make them skip every refresh after the next attach — for the life of the
        // service if the RPC never returns.
        statsJob?.cancel()
        dirtyJob?.cancel()
        generation++
        debounce = null
        statsTimer = null
        prTimer = null
        trail = null
        want = null
        prJob = null
        statsJob = null
        dirtyJob = null
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
            // A request held from before the toggle has nothing left to ask about, and must not survive
            // to spend a fan-out once the integration is switched back on.
            trail?.stop()
            trail = null
            want = null
            prFlow.value = emptyMap()
            ghFlow.value = GhAvailability.OK
            return
        }
        if (refs == 0) return
        prTimer = timers.timer(PR_POLL) { refreshPr(force = true) }.also { it.start() }
        refreshPr(force = true)
    }

    /**
     * One stats poll at a time.
     *
     * The poll interval and the git watchdog used to be close enough that a slow repository could
     * have several polls in flight at once, each fanning out git processes — which is how a poll ends
     * up blaming git for a queue the client created.
     */
    private fun loadStats() {
        if (statsJob?.isActive == true) {
            LOG.info("worktree stats refresh skipped, poll in flight")
            return
        }
        statsJob = cs.launch {
            val dir = project.kiloRoot() ?: return@launch
            runCatching { service<KiloWorktreeService>().stats(dir) }
                .onSuccess { dto ->
                    statsFlow.value = merge(statsFlow.value, dto.items, { it.path }, { it.unavailable }, !dto.unavailable)
                }
                .onFailure { err -> LOG.warn("worktree stats refresh failed dir=$dir (previous values kept)", err) }
        }
    }

    // Resolves the backend root like loadStats rather than reading project.basePath, which is a
    // synthetic JetBrains Client path in split/remote mode. Pointing the backend at that path makes
    // dirty() answer for a directory that does not exist, which reads as "no local changes".
    private fun loadDirty() {
        if (dirtyJob?.isActive == true) {
            LOG.info("worktree dirty refresh skipped, poll in flight")
            return
        }
        dirtyJob = cs.launch {
            val dir = project.kiloRoot() ?: return@launch
            runCatching { service<KiloWorktreeService>().dirty(dir) }
                .onSuccess { dto ->
                    dirtyFlow.value = merge(dirtyFlow.value, dto.items, { it.path }, { it.unavailable }, !dto.unavailable)
                }
                .onFailure { err -> LOG.warn("worktree dirty refresh failed dir=$dir (previous values kept)", err) }
        }
    }

    private fun loadPr(maxAge: Long? = null, fresh: List<String> = emptyList()) {
        val gen = ++generation
        val job = cs.launch {
            val dir = project.kiloRoot() ?: return@launch
            runCatching { service<KiloWorktreeService>().prStatus(dir, maxAge, fresh) }
                .onSuccess { dto ->
                    // KiloWorktreeService.prStatus swallows the cancellation and answers with an
                    // empty DTO, so a lookup cancelled by a disable still lands here — and after a
                    // quick re-enable the github flag is true again. Only the newest lookup may
                    // publish, or a stale empty result would wipe fresh badges and report a false OK
                    // over a real UNAUTH.
                    if (gen != generation) return@onSuccess
                    LOG.info(
                        "worktree PR refresh done items=${dto.items.size} value=${dto.availability} " +
                            "maxAge=${maxAge ?: "default"} fresh=${fresh.size}",
                    )
                    // A spent GitHub budget carries no pull request data and says nothing about the
                    // pull requests themselves, so the rows keep what they had and the banner explains
                    // why it stopped moving. Publishing the empty list would instead blank every badge
                    // for up to an hour over something the user cannot act on. A gh that timed out is
                    // in exactly the same position: it answered nothing about these pull requests.
                    if (dto.availability != GhAvailability.RATE_LIMITED && dto.availability != GhAvailability.TIMEOUT) {
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

    /**
     * Merges a poll result over the previous one, keeping the previous entry wherever the backend
     * could not measure.
     *
     * An unavailable row carries zeros, and publishing those would render a failed poll as a clean
     * worktree — a badge silently disappearing is worse than a badge being briefly stale. Rows the
     * backend stopped reporting altogether are dropped, but only when [drop] says the poll itself
     * answered: the backend also returns an empty list when `git worktree list` fails, and dropping
     * on that is the same "failed poll renders as clean" bug one level up.
     */
    private fun <T> merge(
        previous: Map<String, T>,
        items: List<T>,
        key: (T) -> String,
        stale: (T) -> Boolean,
        drop: Boolean,
    ): Map<String, T> {
        val next = LinkedHashMap<String, T>(maxOf(items.size, previous.size))
        if (!drop) next.putAll(previous)
        for (item in items) {
            val id = normalizeWorktreePath(key(item))
            val kept = previous[id]
            next[id] = if (stale(item) && kept != null) kept else item
        }
        return next
    }
}
