package ai.kilocode.client.session

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.history.HistoryController
import ai.kilocode.client.session.history.HistoryPanel
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.DataProvider
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.cancel
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel

class SessionSidePanelManager(
    project: Project,
    root: Workspace,
    create: (Project, Workspace, SessionManager, SessionRef?, UiTimerSource) -> SessionUi =
        { project, workspace, manager, ref, timers ->
            service<SessionUiFactory>().create(project, workspace, manager, ref, timers)
        },
    resolve: (String) -> Workspace = { dir -> service<KiloWorkspaceService>().workspace(dir) },
    status: () -> Map<String, SessionActivityKind> = { project.service<KiloSessionService>().activitySnapshot() },
    private val history: ((Disposable, (SessionRef) -> Unit, (String) -> Unit) -> JComponent)? = null,
    timers: UiTimerSource = UiTimers,
    request: (JComponent) -> Unit = { focus ->
        ApplicationManager.getApplication().invokeLater({
            IdeFocusManager.getInstance(project).requestFocusInProject(focus, project)
        }, ModalityState.defaultModalityState())
    },
) : SessionHost(project, root, create, resolve, status, timers, request) {
    val component: JPanel = object : JPanel(BorderLayout()), DataProvider {
        override fun getData(dataId: String): Any? {
            if (SessionManager.KEY.`is`(dataId)) return this@SessionSidePanelManager
            if (SessionManager.WORKSPACE_KEY.`is`(dataId)) return root
            return null
        }
    }

    private var panel: JComponent? = null
    private var historyBack: (() -> Unit)? = null

    /** Wired by the tool window to open the Agent Manager's New Worktree flow from the chat dock. */
    var onNewWorktree: (() -> Unit)? = null

    /** Wired by the tool window to move the current chat into an Agent Manager worktree row. */
    var onMoveToWorktree: ((String?, String) -> Unit)? = null

    override val supportsNewWorktree: Boolean get() = onNewWorktree != null

    override val supportsMoveToWorktree: Boolean get() = onMoveToWorktree != null

    override fun newWorktree() {
        onNewWorktree?.invoke()
    }

    override fun moveToWorktree(sessionId: String?, directory: String) {
        onMoveToWorktree?.invoke(sessionId, directory)
    }

    val defaultFocusedComponent: JComponent? get() = currentUi()?.defaultFocusedComponent ?: (panel as? HistoryPanel)?.defaultFocusedComponent

    @RequiresEdt
    override fun activityChanged() {
        super.activityChanged()
        (panel as? HistoryPanel)?.syncActivity()
    }

    @RequiresEdt
    override fun showHistory(back: (() -> Unit)?) {
        historyBack = back
        val active = currentUi()
        register(active)
        release(active)
        val cached = panel
        val view = cached ?: createHistory().also { panel = it }
        if (cached != null && view is HistoryPanel) view.refresh()
        if (currentUi() == null && component.componentCount == 1 && component.getComponent(0) === view) {
            focus((view as? HistoryPanel)?.defaultFocusedComponent)
            return
        }
        clearCurrent()
        component.removeAll()
        component.add(view, BorderLayout.CENTER)
        component.revalidate()
        component.repaint()
        focus((view as? HistoryPanel)?.defaultFocusedComponent)
    }

    private fun createHistory(): JComponent {
        val custom = history
        if (custom != null) return custom(this, this::openSession, this::removeSession)
        val factory = service<SessionUiFactory>()
        val cs = factory.scope()
        val controller = HistoryController(
            sessions = project.service<KiloSessionService>(),
            workspace = root,
            cs = cs,
            open = this::openSession,
            deleted = this::removeSession,
        )
        Disposer.register(this) { cs.cancel() }
        return HistoryPanel(this, controller, nav = this::back, manager = this, timers = timers).component
    }

    @RequiresEdt
    private fun back() {
        val callback = historyBack
        historyBack = null
        if (callback != null) {
            callback()
            return
        }
        val ui = latestUi()
        if (ui != null) {
            show(ui)
            return
        }
        newSession()
    }

    @Suppress("unused")
    override fun removeSession(id: String) {
        super.removeSession(id)
    }

    @RequiresEdt
    override fun present(ui: SessionUi?) {
        component.removeAll()
        if (ui != null) component.add(ui, BorderLayout.CENTER)
        component.revalidate()
        component.repaint()
    }

    override fun dispose() {
        super.dispose()
        panel = null
    }
}
