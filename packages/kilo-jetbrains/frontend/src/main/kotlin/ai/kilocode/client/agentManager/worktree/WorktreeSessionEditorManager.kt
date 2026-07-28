package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SessionHost
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.SessionUi
import ai.kilocode.client.session.SessionUiFactory
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.session.history.LocalHistoryItem
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import ai.kilocode.rpc.dto.SessionDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel

open class WorktreeSessionEditorManager(
    parent: Disposable,
    project: Project,
    private val worktree: Workspace,
    private val list: WorktreeSessionListController,
    create: (Project, Workspace, SessionManager, SessionRef?, UiTimerSource) -> SessionUi =
        { project, workspace, manager, ref, timers ->
            service<SessionUiFactory>().create(project, workspace, manager, ref, timers)
        },
    resolve: (String) -> Workspace = { dir -> service<KiloWorkspaceService>().workspace(dir) },
    status: () -> Map<String, SessionActivityKind> = { project.service<KiloSessionService>().activity() },
    timers: UiTimerSource = UiTimers,
    request: (JComponent) -> Unit = { focus ->
        ApplicationManager.getApplication().invokeLater({
            IdeFocusManager.getInstance(project).requestFocusInProject(focus, project)
        }, ModalityState.defaultModalityState())
    },
    private val notify: (String, String?) -> Unit = { title, content -> KiloNotifications.error(project, title, content) },
) : SessionHost(project, worktree, create, resolve, status, timers, request) {
    private val right = JPanel(BorderLayout())
    private val deleting = linkedSetOf<String>()
    private var last: String? = null
    private var pending = false
    var onPresent: ((String?) -> Unit)? = null
    var onListChanged: (() -> Unit)? = null
    internal var startFocus = false

    val component: JPanel get() = right

    init {
        Disposer.register(parent, this)
    }

    @RequiresEdt
    fun start() {
        list.reload {
            val dto = latest()
            if (dto != null) openSession(SessionRef.Local(dto), startFocus) else newSession(startFocus)
        }
    }

    @RequiresEdt
    open fun hasPendingNew(): Boolean = pending

    @RequiresEdt
    open fun deleting(): Set<String> = deleting

    @RequiresEdt
    override fun newSession() {
        newSession(focus = true)
    }

    @RequiresEdt
    open fun newSession(focus: Boolean) {
        if (pending) return
        pending = true
        onListChanged?.invoke()
        list.create { session ->
            pending = false
            if (session != null) openSession(SessionRef.Local(session), focus) else onListChanged?.invoke()
        }
    }

    @RequiresEdt
    fun preferredFocus(): JComponent? = currentUi()?.defaultFocusedComponent

    @RequiresEdt
    override fun showHistory() {
        list.reload()
        onListChanged?.invoke()
    }

    @RequiresEdt
    override fun activityChanged() {
        super.activityChanged()
        val id = currentUi()?.id
        if (last == null && id != null) {
            last = id
            list.reload { onListChanged?.invoke() }
            return
        }
        last = id
        onListChanged?.invoke()
    }

    @RequiresEdt
    open fun deleteSessions(ids: List<String>) {
        val active = ids.filter { it != NEW && it !in deleting }.distinct()
        if (active.isEmpty()) return
        val key = currentKey()
        val names = active.associateWith(::title)
        deleting.addAll(active)
        val target = if (key in active) next(key) else null
        onListChanged?.invoke()
        active.forEach { id ->
            val name = names[id] ?: title(id)
            list.delete(id) { ok, err ->
                deleting.remove(id)
                onListChanged?.invoke()
                if (ok) return@delete
                notify(KiloBundle.message("worktree.session.delete.failed.title", name), err)
            }
        }
        active.forEach(::forceSession)
        if (key in active) {
            if (target != null) openSession(SessionRef.Local(target)) else newSession()
        }
    }

    @RequiresEdt
    override fun present(ui: SessionUi?) {
        right.removeAll()
        if (ui != null) right.add(ui, BorderLayout.CENTER)
        right.revalidate()
        right.repaint()
        last = ui?.id
        onPresent?.invoke(currentKey())
    }

    @RequiresEdt
    override fun onSessionsChanged() {
        list.reload { onListChanged?.invoke() }
    }

    @RequiresEdt
    private fun latest(): SessionDto? {
        return (0 until list.model.size)
            .map { list.model.getElementAt(it) }
            .filter { it.id !in deleting }
            .maxByOrNull { it.time.updated }
    }

    @RequiresEdt
    private fun next(key: String?): SessionDto? {
        val rows = HistoryTime.sorted((0 until list.model.size).map { LocalHistoryItem(list.model.getElementAt(it)) })
            .map { it.session }
        val idx = rows.indexOfFirst { it.id == key }
        if (idx < 0) return rows.firstOrNull { it.id !in deleting }
        return rows.drop(idx + 1).firstOrNull { it.id !in deleting }
            ?: rows.take(idx).asReversed().firstOrNull { it.id !in deleting }
    }

    @RequiresEdt
    private fun title(id: String): String {
        return (0 until list.model.size)
            .map { list.model.getElementAt(it) }
            .firstOrNull { it.id == id }
            ?.title
            ?.takeIf { it.isNotBlank() }
            ?: KiloBundle.message("worktree.session.untitled")
    }
}
