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
        private const val MAX_BACKOFF = 120_000
        // Floor between event-driven syncs. Matches the backend's gh auth status cache TTL, so a
        // burst of focus/tab events cannot outrun the answer a probe would get anyway.
        private const val EVENT_THROTTLE = 3_000
    }

    private var timers: UiTimerSource = UiTimers
    private var value = GhAvailability.OK
    private var notified = false
    private var timer: UiTimer? = null
    private var refs = 0
    private var busy = false
    private var failures = 0
    private var generation = 0
    private var github = KiloPluginSettings.getGithub()
    private var job: Job? = null
    private var probed = 0L
    private val projects = linkedMapOf<Project, Int>()

    init {
        val bus = ApplicationManager.getApplication().messageBus.connect(cs)
        bus.subscribe(GithubIntegrationListener.TOPIC, GithubIntegrationListener { enabled -> edt { github(enabled) } })
        // Returning to the IDE usually follows work done elsewhere — `gh auth login` in a terminal,
        // a PR merged in a browser — so re-check then instead of waiting out the poll interval.
        bus.subscribe(ApplicationActivationListener.TOPIC, object : ApplicationActivationListener {
            override fun applicationActivated(ideFrame: IdeFrame) = sync("frame-focus")
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
     * tool window tab switch). Coalesces rather than queues: dropped while a probe is already in
     * flight or within [EVENT_THROTTLE] of the last one, so the single-probe-at-a-time loop keeps
     * its shape no matter how many events arrive.
     */
    fun sync(reason: String) {
        edt { syncEdt(reason) }
    }

    @RequiresEdt
    private fun syncEdt(reason: String) {
        if (refs == 0) return
        if (busy) {
            LOG.info("gh sync dropped reason=$reason busy=true")
            return
        }
        val since = timers.now() - probed
        if (since < EVENT_THROTTLE) {
            LOG.info("gh sync dropped reason=$reason sinceMs=$since")
            return
        }
        probe(reason)
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
    private fun probe(reason: String) {
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
        probed = start
        val mode = github
        LOG.info("gh probe start reason=$reason state=$value delay=${delay()} github=$mode")
        job = cs.launch {
            runCatching {
                val dir = project.kiloRoot() ?: return@runCatching null
                LOG.info("gh probe dir=$dir")
                service<KiloWorktreeService>().ghStatus(dir, mode)
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
            schedule()
        }
    }

    private fun done(gen: Int, project: Project, next: GhAvailability, ms: Long) {
        edt {
            if (gen != generation || refs == 0) return@edt
            busy = false
            failures = 0
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
            LOG.warn("gh probe failed failures=$failures ms=$ms nextDelay=${delay()}", err)
            schedule()
        }
    }

    @RequiresEdt
    private fun schedule() {
        timer?.stop()
        timer = null
        if (refs == 0) return
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
