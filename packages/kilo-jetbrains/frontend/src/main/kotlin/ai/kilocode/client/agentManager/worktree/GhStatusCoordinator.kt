package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.app.kiloRoot
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.util.UiTimer
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import ai.kilocode.client.util.edt
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.GhAvailability
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.application.ApplicationActivationListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.wm.IdeFrame
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * [probe] always resolves its target directory from [target]'s [Project.kiloRoot], which is the
 * project's main repository root, never a worktree — so this class does not need to know when a
 * worktree is being deleted. The one case that still matters (the *open project itself* is a
 * worktree that another window is deleting) is covered on the backend: `KiloWorktreeRpcApiImpl`'s
 * `probeGh` checks `WorktreeTrash` before spawning `git`/`gh`, since the RPC is directory-scoped and
 * cannot rely on this coordinator's behavior.
 */
@Service(Service.Level.APP)
class GhStatusCoordinator(
    private val cs: CoroutineScope,
) {
    internal constructor(cs: CoroutineScope, timers: UiTimerSource) : this(cs) {
        this.timers = timers
    }

    companion object {
        private val LOG = KiloLog.create(GhStatusCoordinator::class.java)
        private const val NORMAL = 30_000
        private const val FAST = 5_000
        private const val SLOW = 60_000
        // A spent GitHub budget resets on GitHub's schedule, not ours, and every probe until then is a
        // call spent confirming what the last one said. Slower than every other state for that reason,
        // while still noticing the reset long before the user would think to look.
        private const val LIMITED = 300_000
        private const val MAX_BACKOFF = 120_000
        // Floor between event-driven syncs. Matches the backend's gh auth status cache TTL, so a
        // burst of focus/tab events cannot outrun the answer a probe would get anyway. Measured from
        // the last probe's completion rather than its start: the backend writes its cache entry when
        // the probe finishes, so timing from the start would let a sync clear this floor and still be
        // served that entry.
        private const val EVENT_THROTTLE = 3_000L
    }

    /** An event-driven sync that could not run when it arrived, held for one trailing probe. */
    private data class Sync(val reason: String, val maxAge: Long?)

    private var timers: UiTimerSource = UiTimers
    private var value = GhAvailability.OK
    private var notified = false
    private var timer: UiTimer? = null
    private var trail: UiTimer? = null
    private var refs = 0
    private var busy = false
    private var failures = 0
    private var generation = 0
    private var github = KiloPluginSettings.getGithub()
    private var job: Job? = null
    /** When the last probe finished, whatever its outcome. See [EVENT_THROTTLE]. */
    private var probed = 0L
    private var pending: Sync? = null
    private val away = Away { timers.now() }
    private val projects = linkedMapOf<Project, Int>()

    init {
        val bus = ApplicationManager.getApplication().messageBus.connect(cs)
        bus.subscribe(GithubIntegrationListener.TOPIC, GithubIntegrationListener { enabled -> edt { github(enabled) } })
        // Returning to the IDE usually follows work done elsewhere — `gh auth login` in a terminal,
        // a PR merged in a browser — so re-check then instead of waiting out the poll interval.
        bus.subscribe(ApplicationActivationListener.TOPIC, object : ApplicationActivationListener {
            override fun applicationActivated(ideFrame: IdeFrame) = edt { focus() }

            override fun applicationDeactivated(ideFrame: IdeFrame) = edt { away.left() }
        })
    }

    fun current(): GhAvailability = value

    fun attach(project: Project): AutoCloseable {
        edt { attachEdt(project) }
        return AutoCloseable { edt { detachEdt(project) } }
    }

    fun report(project: Project?, next: GhAvailability) {
        edt { apply(project, next) }
    }

    /**
     * Submits an out-of-band probe after an event that may have changed gh state (IDE frame focus,
     * tool window tab switch). Coalesces rather than queues: a sync that cannot run right now is
     * held as a single trailing probe instead of one per event, so a burst costs at most one extra
     * probe per [EVENT_THROTTLE] window while never discarding the request outright — dropping it
     * would leave the stale verdict standing until the next scheduled poll.
     */
    fun sync(reason: String) {
        edt { syncEdt(reason) }
    }

    /**
     * Handles the IDE frame regaining focus. Work is proportional to the absence: none at all for a
     * popup that never really took focus away, a throttled sync for a quick window switch, and a
     * cache-bypassing probe once the absence is long enough to have contained a `gh auth login`.
     */
    @RequiresEdt
    private fun focus() {
        val gone = away.back() ?: run {
            // Logged so the absence of a frame-focus probe reads as "nothing to answer" rather than as
            // a listener that never fired, which is otherwise indistinguishable in the log.
            LOG.info("gh focus ignored, no absence to answer")
            return
        }
        syncEdt("frame-focus", Away.ceiling(gone))
    }

    @RequiresEdt
    private fun syncEdt(reason: String, maxAge: Long? = null) {
        if (refs == 0) return
        if (busy) {
            defer(reason, maxAge, "busy=true")
            return
        }
        val since = timers.now() - probed
        // A freshness requirement outranks the throttle: the caller has already established that the
        // answer a throttled sync would preserve is too old to be worth keeping.
        if (maxAge == null && since < EVENT_THROTTLE) {
            defer(reason, maxAge, "sinceMs=$since")
            arm(EVENT_THROTTLE - since)
            return
        }
        probe(reason, maxAge)
    }

    /**
     * Folds a sync that cannot run now into the single held one. The newest reason wins for the log
     * and the strictest freshness requirement survives, so a forced sync held behind a throttled one
     * still bypasses the backend cache when it finally runs.
     */
    @RequiresEdt
    private fun defer(reason: String, maxAge: Long?, why: String) {
        val held = pending?.maxAge
        val next = when {
            held == null -> maxAge
            maxAge == null -> held
            else -> minOf(held, maxAge)
        }
        pending = Sync(reason, next)
        LOG.info("gh sync deferred reason=$reason $why maxAge=${next ?: "default"}")
    }

    /**
     * Arms the trailing probe at the end of the current throttle window. Deliberately not a sliding
     * debounce: a continuing burst must not keep pushing the deadline out, so an already-armed timer
     * is left alone and the window end stays fixed from the first deferral.
     */
    @RequiresEdt
    private fun arm(ms: Long) {
        if (trail?.isRunning() == true) return
        trail = timers.timer(ms.coerceAtLeast(1).toInt(), repeats = false) { flush() }.also { it.start() }
    }

    @RequiresEdt
    private fun flush() {
        trail = null
        resume()
    }

    /**
     * Runs a held event-driven sync now that the loop is free, so the news it was submitted for does
     * not wait out a full poll interval. Returns true when a probe was started.
     *
     * A sync carrying no freshness requirement is instead discarded when a probe has just succeeded:
     * that answer already reflects the state the event was asking about, and re-running it would
     * turn every deferral into a guaranteed second call. A failed probe establishes nothing, so it
     * never counts as satisfying one.
     */
    @RequiresEdt
    private fun resume(): Boolean {
        val next = pending ?: return false
        if (busy) return false
        if (refs == 0) {
            pending = null
            return false
        }
        pending = null
        trail?.stop()
        trail = null
        val since = timers.now() - probed
        if (next.maxAge == null && failures == 0 && since < EVENT_THROTTLE) {
            LOG.info("gh sync satisfied reason=${next.reason} sinceMs=$since")
            return false
        }
        probe(next.reason, next.maxAge)
        return true
    }

    @RequiresEdt
    private fun attachEdt(project: Project) {
        if (project.isDisposed) return
        projects[project] = (projects[project] ?: 0) + 1
        refs++
        if (refs == 1) {
            generation++
            LOG.info("gh probe loop start refs=$refs")
            probe("attach")
            return
        }
        LOG.info("gh probe attach refs=$refs")
    }

    @RequiresEdt
    private fun detachEdt(project: Project) {
        val count = projects[project] ?: return
        if (count <= 1) projects.remove(project) else projects[project] = count - 1
        refs = (refs - 1).coerceAtLeast(0)
        if (refs > 0) {
            LOG.info("gh probe detach refs=$refs")
            return
        }
        generation++
        timer?.stop()
        timer = null
        trail?.stop()
        trail = null
        pending = null
        job?.cancel()
        job = null
        busy = false
        failures = 0
        LOG.info("gh probe loop stop")
    }

    @RequiresEdt
    private fun apply(project: Project?, next: GhAvailability) {
        // Ignore a stray backend result (e.g. an in-flight prStatus reporting into report()) that
        // resolves after the user turned the integration off — anything but OK/GIT_MISSING implies
        // gh ran, which cannot be trusted once disabled.
        if (!github && next != GhAvailability.OK && next != GhAvailability.GIT_MISSING) return
        if (value == next) return
        val previous = value
        value = next
        failures = 0
        ApplicationManager.getApplication()
            .messageBus
            .syncPublisher(GhStatusListener.TOPIC)
            .statusChanged(next)
        LOG.info("gh probe state previous=$previous next=$next delay=${delay()} refs=$refs")
        if (next == GhAvailability.OK) {
            notified = false
        } else if (!notified) {
            notified = true
            notify(project, next)
        }
        schedule()
    }

    @RequiresEdt
    private fun probe(reason: String, maxAge: Long? = null) {
        if (refs == 0) return
        if (busy) {
            LOG.info("gh probe skipped reason=$reason busy=true delay=${delay()}")
            schedule()
            return
        }
        val project = target() ?: run {
            LOG.info("gh probe skipped reason=$reason no_project=true delay=${delay()}")
            schedule()
            return
        }
        busy = true
        val gen = generation
        val start = timers.now()
        val mode = github
        LOG.info("gh probe start reason=$reason state=$value delay=${delay()} github=$mode maxAge=${maxAge ?: "default"}")
        job = cs.launch {
            runCatching {
                val dir = project.kiloRoot() ?: return@runCatching null
                LOG.info("gh probe dir=$dir")
                service<KiloWorktreeService>().ghStatus(dir, mode, maxAge)
            }
                .onSuccess { next ->
                    if (next == null) {
                        LOG.info("gh probe skipped reason=$reason unresolved_root=true project=${project.name}")
                        idle(gen)
                        return@onSuccess
                    }
                    done(gen, project, next, timers.now() - start)
                }
                .onFailure { err -> failed(gen, err, timers.now() - start) }
        }
    }

    /**
     * Applies a GitHub integration setting change. Disabling cancels the in-flight probe and forces
     * the published state to [GhAvailability.OK] so the banner hides at once instead of waiting for
     * the next probe; the loop keeps running so a missing git is still reported.
     */
    @RequiresEdt
    private fun github(enabled: Boolean) {
        if (github == enabled) return
        github = enabled
        job?.cancel()
        job = null
        busy = false
        failures = 0
        generation++
        notified = false
        // The toggle probes (or publishes OK) on its own, so a sync held from before it is redundant
        // and must not survive to fire a second probe straight after.
        trail?.stop()
        trail = null
        pending = null
        LOG.info("gh probe github=$enabled state=$value refs=$refs")
        if (!enabled) {
            apply(target(), GhAvailability.OK)
            schedule()
            return
        }
        probe("github-enabled")
    }

    private fun idle(gen: Int) {
        edt {
            if (gen != generation || refs == 0) return@edt
            busy = false
            probed = timers.now()
            schedule()
        }
    }

    private fun done(gen: Int, project: Project, next: GhAvailability, ms: Long) {
        edt {
            if (gen != generation || refs == 0) return@edt
            busy = false
            failures = 0
            probed = timers.now()
            LOG.info("gh probe done value=$next ms=$ms nextDelay=${delay()}")
            apply(project, next)
            schedule()
        }
    }

    private fun failed(gen: Int, err: Throwable, ms: Long) {
        edt {
            if (gen != generation || refs == 0) return@edt
            busy = false
            failures++
            probed = timers.now()
            LOG.warn("gh probe failed failures=$failures ms=$ms nextDelay=${delay()}", err)
            schedule()
        }
    }

    /**
     * Decides what the loop does next. A held event-driven sync outranks the poll: the news it was
     * submitted for has already arrived, so making the user wait out a full interval for it is the
     * staleness this whole path exists to avoid.
     */
    @RequiresEdt
    private fun schedule() {
        timer?.stop()
        timer = null
        if (refs == 0) return
        if (resume()) return
        val ms = delay()
        timer = timers.timer(ms, repeats = false) { probe("scheduled") }.also { it.start() }
        LOG.info("gh probe scheduled delay=$ms state=$value failures=$failures refs=$refs")
    }

    @RequiresEdt
    private fun target(): Project? {
        return projects.keys.firstOrNull { !it.isDisposed && it.basePath != null }
    }

    private fun delay(): Int {
        if (failures > 0) return (baseDelay() * (1 shl (failures - 1).coerceAtMost(4))).coerceAtMost(MAX_BACKOFF)
        return baseDelay()
    }

    // While the GitHub integration is off the loop only checks whether git exists, so it never needs
    // the OK cadence tuned for spotting a gh auth change.
    private fun baseDelay(): Int = if (!github) SLOW else when (value) {
        GhAvailability.OK -> NORMAL
        GhAvailability.UNAUTH -> FAST
        GhAvailability.MISSING -> SLOW
        GhAvailability.GIT_MISSING -> SLOW
        GhAvailability.RATE_LIMITED -> LIMITED
    }

    @RequiresEdt
    private fun notify(project: Project?, value: GhAvailability) {
        val target = project ?: ProjectManager.getInstance().openProjects.firstOrNull { !it.isDefault }
        if (value == GhAvailability.GIT_MISSING) {
            KiloNotifications.suggestion(
                target,
                KiloBundle.message("worktree.git.missing.title"),
                KiloBundle.message("worktree.git.missing.content"),
                KiloBundle.message("worktree.gh.learnMore"),
            ) { BrowserUtil.browse("https://git-scm.com/downloads") }
            return
        }
        if (value == GhAvailability.MISSING) {
            KiloNotifications.suggestion(
                target,
                KiloBundle.message("worktree.gh.missing.title"),
                KiloBundle.message("worktree.gh.missing.content"),
                KiloBundle.message("worktree.gh.learnMore"),
            ) { BrowserUtil.browse("https://cli.github.com/") }
            return
        }
        // Told once, not on every probe: `notified` only clears on a return to OK, and there is nothing
        // to do about a spent budget except wait for it, which the banner keeps saying meanwhile.
        if (value == GhAvailability.RATE_LIMITED) {
            KiloNotifications.suggestion(
                target,
                KiloBundle.message("worktree.gh.limited.title"),
                KiloBundle.message("worktree.gh.limited.content"),
                KiloBundle.message("worktree.gh.learnMore"),
            ) { BrowserUtil.browse(GH_LIMIT_DOCS) }
            return
        }
        KiloNotifications.suggestion(
            target,
            KiloBundle.message("worktree.gh.unauth.title"),
            KiloBundle.message("worktree.gh.unauth.content"),
            KiloBundle.message("worktree.gh.authorize"),
        ) {
            if (target == null) {
                BrowserUtil.browse("https://cli.github.com/manual/gh_auth_login")
                return@suggestion
            }
            edt { runGhAuthLogin(target) }
        }
    }
}
