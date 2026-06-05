package ai.kilocode.client.session

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.history.HistoryController
import ai.kilocode.client.session.history.HistoryPanel
import ai.kilocode.client.telemetry.Telemetry
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.DataProvider
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.registry.Registry
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.cancel
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.Timer

class SessionSidePanelManager(
    private val project: Project,
    private val root: Workspace,
    private val create: (Project, Workspace, SessionManager, SessionRef?) -> SessionUi = { project, workspace, manager, ref ->
        service<SessionUiFactory>().create(project, workspace, manager, ref)
    },
    private val resolve: (String) -> Workspace = { dir -> service<KiloWorkspaceService>().workspace(dir) },
    private val status: () -> Map<String, SessionActivityKind> = { project.service<KiloSessionService>().activity() },
    private val history: ((Disposable, (SessionRef) -> Unit, (String) -> Unit) -> JComponent)? = null,
) : SessionManager, Disposable {
    val component: JPanel = object : JPanel(BorderLayout()), DataProvider {
        override fun getData(dataId: String): Any? {
            if (SessionManager.KEY.`is`(dataId)) return this@SessionSidePanelManager
            if (SessionManager.WORKSPACE_KEY.`is`(dataId)) return root
            return null
        }
    }

    private val opened = mutableMapOf<String, SessionUi>()
    private val all = mutableSetOf<SessionUi>()
    private val timers = mutableMapOf<SessionUi, Timer>()
    private var current: SessionUi? = null
    private var latest: SessionUi? = null
    private var panel: JComponent? = null

    val defaultFocusedComponent: JComponent? get() = current?.defaultFocusedComponent ?: (panel as? HistoryPanel)?.defaultFocusedComponent

    override fun newSession() {
        val active = current
        if (active?.blank == true) return
        register(active)
        show(create(project, root, this, null))
    }

    override fun openSession(ref: SessionRef) {
        register(current)
        val ui = opened[ref.key] ?: run {
            val local = (ref as? SessionRef.Local)?.session?.id
            val existing = local?.let { opened[it] }
            if (existing != null) {
                opened[ref.key] = existing
                existing
            } else create(ref)
        }
        if (current === ui) return
        Telemetry.send("Session Opened", mapOf("source" to ref.type.name.lowercase(), "sessionId" to ref.id))
        show(ui)
    }

    @RequiresEdt
    override fun activity(): Map<String, SessionActivityKind> {
        val base = status()
        val live = all.mapNotNull { ui ->
            val id = ui.id ?: return@mapNotNull null
            val kind = ui.activityKind() ?: return@mapNotNull null
            id to kind
        }.toMap()
        return base + live
    }

    @RequiresEdt
    override fun titles(): Map<String, String> = all.mapNotNull { ui ->
        val id = ui.id ?: return@mapNotNull null
        val title = ui.title() ?: return@mapNotNull null
        id to title
    }.toMap()

    @RequiresEdt
    override fun activityChanged() {
        (panel as? HistoryPanel)?.syncActivity()
        current?.syncActivity()
    }

    private fun create(ref: SessionRef): SessionUi {
        val workspace = when (ref) {
            is SessionRef.Local -> ref.session?.directory?.let(resolve) ?: root
            is SessionRef.Cloud -> root
        }
        return create(project, workspace, this, ref).also {
            all.add(it)
            opened[ref.key] = it
            val local = (ref as? SessionRef.Local)?.session?.id
            if (local != null) opened.putIfAbsent(local, it)
        }
    }

    override fun showHistory() {
        val active = current
        register(active)
        release(active)
        val cached = panel
        val view = cached ?: createHistory().also { panel = it }
        if (cached != null && view is HistoryPanel) view.refresh()
        if (current == null && component.componentCount == 1 && component.getComponent(0) === view) {
            focusHistory(view)
            return
        }
        current = null
        component.removeAll()
        component.add(view, BorderLayout.CENTER)
        component.revalidate()
        component.repaint()
        focusHistory(view)
    }

    private fun focusHistory(view: JComponent) {
        val focus = (view as? HistoryPanel)?.defaultFocusedComponent ?: return
        ApplicationManager.getApplication().invokeLater({
            IdeFocusManager.getInstance(project).requestFocusInProject(focus, project)
        }, ModalityState.defaultModalityState())
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
        return HistoryPanel(this, controller, nav = this::back, manager = this).component
    }

    private fun back() {
        val ui = latest
        if (ui != null && ui in all) {
            show(ui)
            return
        }
        latest = null
        newSession()
    }

    private fun removeSession(id: String) {
        val ui = opened.remove(id) ?: return
        disposeUi(ui)
    }

    private fun show(ui: SessionUi) {
        cancel(ui)
        all.add(ui)
        register(ui)
        latest = ui
        if (current === ui) return
        release(current)
        component.removeAll()
        current = ui
        component.add(ui, BorderLayout.CENTER)
        component.revalidate()
        component.repaint()
    }

    private fun register(ui: SessionUi?) {
        val key = ui?.cacheKey ?: return
        opened.putIfAbsent(key, ui)
    }

    private fun release(ui: SessionUi?) {
        if (ui == null) return
        if (ui.cacheKey == null) {
            disposeUi(ui)
            return
        }
        register(ui)
        schedule(ui)
    }

    private fun disposeUi(ui: SessionUi) {
        cancel(ui)
        opened.entries.removeIf { it.value === ui }
        all.remove(ui)
        if (current === ui) current = null
        if (latest === ui) latest = null
        Disposer.dispose(ui)
    }

    private fun schedule(ui: SessionUi) {
        cancel(ui)
        val delay = Registry.intValue("kilo.session.inactive.disposeTimeoutMs").coerceAtLeast(0)
        val timer = Timer(delay) {
            timers.remove(ui)
            if (ui === current || ui !in all) return@Timer
            disposeUi(ui)
        }
        timer.isRepeats = false
        timers[ui] = timer
        timer.start()
    }

    private fun cancel(ui: SessionUi) {
        timers.remove(ui)?.stop()
    }

    override fun dispose() {
        val items = all.toList()
        timers.values.forEach { it.stop() }
        timers.clear()
        opened.clear()
        all.clear()
        current = null
        latest = null
        component.removeAll()
        items.forEach { Disposer.dispose(it) }
    }
}
