package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.agentManager.WorkspaceSessionEditorManager
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.SessionUi
import ai.kilocode.rpc.dto.HostedSystemEventDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt

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
) : WorkspaceSessionEditorManager(project, workspace) {
    init {
        Disposer.register(parent, this)
    }

    override val hosted: Boolean get() = true
    override val showsBranchDock: Boolean get() = false
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
    override fun activityChanged() {
        super.activityChanged()
        onListChanged?.invoke()
    }

    @RequiresEdt
    fun show(ref: SessionRef.Hosted, focus: Boolean = true) {
        openSession(ref, focus)
    }

    @RequiresEdt
    fun setPreparation(event: HostedSystemEventDto?) {
        currentUi()?.setHostedPreparation(event)
    }
}
