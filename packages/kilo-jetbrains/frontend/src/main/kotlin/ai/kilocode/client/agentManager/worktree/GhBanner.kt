package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.GhAvailability
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.EditorNotificationPanel
import com.intellij.util.concurrency.annotations.RequiresEdt

internal class GhBanner(
    private val project: Project,
    parent: Disposable,
) : EditorNotificationPanel(Status.Warning) {
    private var state = GhAvailability.OK
    private var synced: GhAvailability? = null

    init {
        val handle = service<GhStatusCoordinator>().attach(project)
        Disposer.register(parent) { handle.close() }
        ApplicationManager.getApplication().messageBus.connect(parent)
            .subscribe(GhStatusListener.TOPIC, GhStatusListener { render(it) })
        render(service<GhStatusCoordinator>().current())
    }

    @RequiresEdt
    private fun render(next: GhAvailability) {
        state = next
        if (next == GhAvailability.OK) {
            if (isVisible) {
                isVisible = false
                changed()
            }
            return
        }
        val dirty = synced != next
        if (dirty) sync(next)
        if (!isVisible) {
            isVisible = true
            changed()
            return
        }
        if (dirty) changed()
    }

    private fun sync(next: GhAvailability) {
        clear()
        text(when (next) {
            GhAvailability.GIT_MISSING -> KiloBundle.message("worktree.git.missing.content")
            GhAvailability.MISSING -> KiloBundle.message("worktree.gh.missing.content")
            GhAvailability.UNAUTH -> KiloBundle.message("worktree.gh.unauth.content")
            GhAvailability.OK -> ""
        })
        createActionLabel(when (next) {
            GhAvailability.GIT_MISSING -> KiloBundle.message("worktree.gh.learnMore")
            GhAvailability.MISSING -> KiloBundle.message("worktree.gh.learnMore")
            GhAvailability.UNAUTH -> KiloBundle.message("worktree.gh.authorize")
            GhAvailability.OK -> ""
        }) { runAction() }
        if (next == GhAvailability.UNAUTH) {
            createActionLabel(KiloBundle.message("worktree.gh.learnMore")) {
                BrowserUtil.browse("https://cli.github.com/manual/gh_auth_login")
            }
        }
        // Offered only for gh problems: a missing git is not the GitHub integration, and turning the
        // integration off would not make worktree stats work. The coordinator publishes OK in
        // response, which routes back through render() and hides this banner.
        if (next == GhAvailability.MISSING || next == GhAvailability.UNAUTH) {
            createActionLabel(KiloBundle.message("worktree.gh.disable")) {
                setGithubIntegration(false, "worktree_gh_banner")
            }.toolTipText = KiloBundle.message("worktree.gh.disable.tooltip")
        }
        synced = next
    }

    private fun runAction() {
        if (state == GhAvailability.GIT_MISSING) {
            BrowserUtil.browse("https://git-scm.com/downloads")
            return
        }
        if (state == GhAvailability.MISSING) {
            BrowserUtil.browse("https://cli.github.com/")
            return
        }
        if (state == GhAvailability.UNAUTH) runGhAuthLogin(project)
    }

    private fun changed() {
        parent?.revalidate()
        parent?.repaint()
    }
}
