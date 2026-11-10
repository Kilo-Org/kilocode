package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.agentManager.WorkspaceSessionEditorManager
import ai.kilocode.client.app.HostedReadiness
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.SessionUi
import ai.kilocode.client.session.controller.KILO_PROVIDER
import ai.kilocode.rpc.dto.HostedAgentDto
import ai.kilocode.rpc.dto.HostedStartSessionDto
import ai.kilocode.rpc.dto.HostedSystemEventDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import ai.kilocode.rpc.dto.PromptDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.util.UUID

/**
 * Hosts the ordinary [SessionUi] for one Cloud workspace.
 *
 * Everything that would touch the local checkout — branch dock, worktrees, forking — is disabled;
 * prompt, command, Stop, questions, permissions, and diff stay routed through the normal transcript.
 * A new session starts as a blank panel and Cloud creates it from the first prompt, matching the
 * local worktree flow.
 */
class HostedWorkspaceEditorManager(
    parent: Disposable,
    project: Project,
    workspace: Workspace,
    private val ref: HostedWorkspaceRefDto,
) : WorkspaceSessionEditorManager(project, workspace) {
    init {
        Disposer.register(parent, this)
    }

    override val hosted: Boolean get() = true
    override val showsBranchDock: Boolean get() = false
    override val supportsFork: Boolean get() = false
    override val supportsNewWorktree: Boolean get() = false
    override val supportsMoveToWorktree: Boolean get() = false

    /** Fired on the EDT once the first prompt created a Cloud session. */
    var onCreated: ((HostedWorkspaceSessionDto) -> Unit)? = null

    // The controller registers the same UI under the new ref via [sessionCreated]; hold the created
    // DTO here so the panel opens that UI instead of creating a second one.
    @Volatile
    private var pending: HostedWorkspaceSessionDto? = null

    override fun showHistory(back: (() -> Unit)?) {
        // The workspace editor already lists every hosted root session.
    }

    /**
     * Cloud has no empty-session API: the start call both creates the session and submits its first
     * prompt, so the editor seeds nothing and the controller skips its follow-up send.
     */
    override suspend fun createSession(prompt: PromptDto): SessionRef {
        val text = prompt.parts.mapNotNull { it.text }.joinToString("\n").trim()
        val agent = prompt.agent
        val provider = prompt.providerID
        val model = prompt.modelID
        if (text.isEmpty() || agent == null || provider == null || model == null || provider != KILO_PROVIDER) {
            throw IllegalStateException(KiloBundle.message("hosted.workspace.create.noModel"))
        }
        val message = prompt.messageID ?: hostedMessageID()
        val result = project.service<KiloHostedService>().start(
            ref,
            HostedStartSessionDto(
                prompt = text,
                agent = HostedAgentDto(agent, "$provider/$model", prompt.variant),
                operationKey = UUID.randomUUID().toString(),
                messageID = message,
            ),
        )
        val session = result.session
        if (result.failure != null || session == null) {
            throw IllegalStateException(result.failure?.message ?: KiloBundle.message("hosted.workspace.session.failed"))
        }
        pending = session
        return SessionRef.Hosted(ref.providerID, ref.workspaceID, session.nativeSessionID, session.title)
    }

    @RequiresEdt
    override fun sessionCreated(ui: SessionUi, ref: SessionRef) {
        super.sessionCreated(ui, ref)
        val session = pending
        if (session == null || ref !is SessionRef.Hosted || ref.id != session.id) return
        pending = null
        onCreated?.invoke(session)
    }

    @RequiresEdt
    fun closeSession(ref: SessionRef.Hosted) {
        forceSession(ref.key)
        if (currentUi() == null) clearCurrent()
    }

    @RequiresEdt
    fun clearPresentation() {
        clearCurrent()
    }

    @RequiresEdt
    override fun activityChanged() {
        super.activityChanged()
        onListChanged?.invoke()
    }

    /** Shows the blank prompt panel so a fresh editor never sits on an empty pane. */
    @RequiresEdt
    fun blank() {
        showBlank()
    }

    @RequiresEdt
    fun show(ref: SessionRef.Hosted, focus: Boolean = true) {
        openSession(ref, focus)
    }

    @RequiresEdt
    fun setPreparation(readiness: HostedReadiness, event: HostedSystemEventDto?) {
        currentUi()?.setHostedPreparation(readiness, event)
    }

    @RequiresEdt
    fun setTitles(titles: Map<String, String>) {
        if (titles.isEmpty()) return
        openSessions().forEach { ui ->
            val id = ui.id ?: return@forEach
            titles[id]?.let(ui::setHostedTitle)
        }
    }

    @RequiresEdt
    fun seedPrompt(prompt: PromptDto) {
        currentUi()?.seedHostedPrompt(prompt)
    }
}