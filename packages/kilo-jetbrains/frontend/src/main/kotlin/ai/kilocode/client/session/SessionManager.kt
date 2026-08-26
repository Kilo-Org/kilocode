package ai.kilocode.client.session

import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.session.ui.empty.EmptySessionPanel
import ai.kilocode.client.app.Workspace
import ai.kilocode.rpc.dto.SessionDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.DataKey

interface SessionManager {
    companion object {
        val KEY = DataKey.create<SessionManager>("ai.kilocode.client.session.SessionManager")
        val WORKSPACE_KEY = DataKey.create<Workspace>("ai.kilocode.client.session.Workspace")
    }

    fun newSession()

    /** Whether this surface can open the New Worktree flow (sidebar only). */
    val supportsNewWorktree: Boolean get() = false

    /** Opens the New Worktree flow. No-op unless [supportsNewWorktree] is true. */
    fun newWorktree() {}

    /** Whether this surface can move the current chat into a worktree (sidebar only). */
    val supportsMoveToWorktree: Boolean get() = false

    /** Opens the Move to Worktree flow. No-op unless [supportsMoveToWorktree] is true. */
    fun moveToWorktree(sessionId: String?, directory: String) {}

    fun showHistory(back: (() -> Unit)? = null)

    fun openSession(ref: SessionRef)

    fun activity(): Map<String, SessionActivityKind> = emptyMap()

    fun titles(): Map<String, String> = emptyMap()

    fun activityChanged() {}

    fun focusPrompt() {}

    val showsBranchDock: Boolean get() = true

    val hostedInEditorTab: Boolean get() = false

    val readonly: Boolean get() = false

    fun emptyPanel(parent: Disposable, controller: SessionController): EmptySessionPanel = EmptySessionPanel(
        parent,
        controller,
        controller.recents(),
        history = { showHistory() },
        activity = { activity() },
        titles = { titles() },
    )

    fun openSession(session: SessionDto) {
        openSession(SessionRef.Local(session))
    }
}
