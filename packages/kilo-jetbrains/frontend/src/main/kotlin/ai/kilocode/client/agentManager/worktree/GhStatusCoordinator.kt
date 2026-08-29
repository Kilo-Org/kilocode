package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.app.kiloRoot
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.util.UiTimer
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import ai.kilocode.client.util.edt
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.GhAvailability
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CoroutineScope
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
    }

    private var timers: UiTimerSource = UiTimers
    private var value = GhAvailability.OK
    private var notified = false
    private var timer: UiTimer? = null
    private var refs = 0
    private var busy = false
    private var failures = 0
    private var generation = 0
    private val projects = linkedMapOf<Project, Int>()

    fun current(): GhAvailability = value

    fun attach(project: Project): AutoCloseable {
        edt { attachEdt(project) }
        return AutoCloseable { edt { detachEdt(project) } }
    }

    fun report(project: Project?, next: GhAvailability) {
        edt { apply(project, next) }
    }

    fun forceProbe(reason: String = "forced") {
        edt { probe(reason) }
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
        busy = false
        failures = 0
        LOG.info("gh probe loop stop")
    }

    @RequiresEdt
    private fun apply(project: Project?, next: GhAvailability) {
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
        LOG.info("gh probe start reason=$reason state=$value delay=${delay()}")
        cs.launch {
            runCatching {
                val dir = project.kiloRoot() ?: return@runCatching null
                LOG.info("gh probe dir=$dir")
                service<KiloWorktreeService>().ghStatus(dir)
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

    private fun baseDelay(): Int = when (value) {
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
