package ai.kilocode.client.session

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.history.HistoryController
import ai.kilocode.client.session.history.HistoryPanel
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.util.UiTimer
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
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

class SessionSidePanelManager(
    private val project: Project,
    private val root: Workspace,
    private val create: (Project, Workspace, SessionManager, SessionRef?, UiTimerSource) -> SessionUi =
        { project, workspace, manager, ref, timers ->
            service<SessionUiFactory>().create(project, workspace, manager, ref, timers)
        },
    private val resolve: (String) -> Workspace = { dir -> service<KiloWorkspaceService>().workspace(dir) },
    private val status: () -> Map<String, SessionActivityKind> = { project.service<KiloSessionService>().activity() },
    private val history: ((Disposable, (SessionRef) -> Unit, (String) -> Unit) -> JComponent)? = null,
    private val timers: UiTimerSource = UiTimers,
    private val request: (JComponent) -> Unit = { focus ->
        ApplicationManager.getApplication().invokeLater({
            IdeFocusManager.getInstance(project).requestFocusInProject(focus, project)
        }, ModalityState.defaultModalityState())
    },
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
    private val activeTimers = mutableMapOf<SessionUi, UiTimer>()
    private var current: SessionUi? = null
    private var latest: SessionUi? = null
    private var panel: JComponent? = null

    val defaultFocusedComponent: JComponent? get() = current?.defaultFocusedComponent ?: (panel as? HistoryPanel)?.defaultFocusedComponent

    override fun newSession() {
        val active = current
        if (active?.blank == true) return
        register(active)
        show(create(project, root, this, null, timers))
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

    @RequiresEdt
    override fun focusPrompt() {
        focus(current?.promptFocusedComponent)
    }

    private fun create(ref: SessionRef): SessionUi {
        val workspace = when (ref) {
            is SessionRef.Local -> ref.session?.directory?.let(resolve) ?: root
            is SessionRef.Cloud -> root
        }
        return create(project, workspace, this, ref, timers).also {
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
            focus((view as? HistoryPanel)?.defaultFocusedComponent)
            return
        }
        current = null
        component.removeAll()
        component.add(view, BorderLayout.CENTER)
        component.revalidate()
        component.repaint()
        focus((view as? HistoryPanel)?.defaultFocusedComponent)
    }

    private fun focus(component: JComponent?) {
        val focus = component ?: return
        request(focus)
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
        focus(ui.defaultFocusedComponent)
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
        val timer = timers.timer(delay, repeats = false) {
            activeTimers.remove(ui)
            if (ui === current || ui !in all) return@timer
            disposeUi(ui)
        }
        activeTimers[ui] = timer
        timer.start()
    }

    private fun cancel(ui: SessionUi) {
        activeTimers.remove(ui)?.stop()
    }

    override fun dispose() {
        val items = all.toList()
        activeTimers.values.forEach { it.stop() }
        activeTimers.clear()
        opened.clear()
        all.clear()
        current = null
        latest = null
        component.removeAll()
        items.forEach { Disposer.dispose(it) }
    }
}
