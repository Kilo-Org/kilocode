package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SessionHost
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.SessionUi
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * Hosts the ordinary [SessionUi] for one Cloud workspace.
 *
 * Hosted sessions are created in Cloud, not here, so [newSession] is a no-op. Everything that
 * would touch the local checkout — branch dock, worktrees, forking — is disabled; prompt, command,
 * Stop, questions, permissions, and diff stay routed through the normal transcript.
 */
class HostedWorkspaceEditorManager(
    parent: Disposable,
    project: Project,
    workspace: Workspace,
    private val presentUi: (SessionUi?) -> Unit,
) : SessionHost(
    project = project,
    root = workspace,
    status = { project.service<KiloSessionService>().activitySnapshot() },
    request = { focus ->
        ApplicationManager.getApplication().invokeLater({
            IdeFocusManager.getInstance(project).requestFocusInProject(focus, project)
        }, ModalityState.defaultModalityState())
    },
) {
    private val right = JPanel(java.awt.BorderLayout())

    init {
        Disposer.register(parent, this)
    }

    val component: JPanel get() = right

    override val hosted: Boolean get() = true
    override val showsBranchDock: Boolean get() = false
    override val hostedInEditorTab: Boolean get() = true
    override val supportsFork: Boolean get() = false
    override val supportsNewWorktree: Boolean get() = false
    override val supportsMoveToWorktree: Boolean get() = false

    override fun showHistory(back: (() -> Unit)?) {
        // The workspace editor already lists every hosted root session.
    }

    @RequiresEdt
    override fun newSession() {
        // Opening this editor must not create a hosted session.
    }

    @RequiresEdt
    override fun present(ui: SessionUi?) {
        presentUi(ui)
    }

    @RequiresEdt
    fun show(ref: SessionRef.Hosted, focus: Boolean = true) {
        openSession(ref, focus)
    }
}
