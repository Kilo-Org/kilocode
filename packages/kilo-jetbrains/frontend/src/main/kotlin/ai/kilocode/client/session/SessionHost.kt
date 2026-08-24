package ai.kilocode.client.session

import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.session.ui.empty.EmptySessionPanel
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.util.UiTimer
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.registry.Registry
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JComponent

abstract class SessionHost(
    protected val project: Project,
    protected val root: Workspace,
    private val create: (Project, Workspace, SessionManager, SessionRef?, UiTimerSource) -> SessionUi =
        { project, workspace, manager, ref, timers ->
            service<SessionUiFactory>().create(project, workspace, manager, ref, timers)
        },
    private val resolve: (String) -> Workspace = { dir -> service<KiloWorkspaceService>().workspace(dir) },
    private val status: () -> Map<String, SessionActivityKind> = { emptyMap() },
    protected val timers: UiTimerSource = UiTimers,
    private val request: (JComponent) -> Unit,
) : SessionManager, Disposable {
    protected val opened = mutableMapOf<String, SessionUi>()
    private val all = mutableSetOf<SessionUi>()
    private val activeTimers = mutableMapOf<SessionUi, UiTimer>()
    private var current: SessionUi? = null
    private var latest: SessionUi? = null

    @RequiresEdt
    override fun newSession() {
        val active = current
        if (active?.blank == true) return
        register(active)
        show(create(project, root, this, null, timers))
        onSessionsChanged()
    }

    @RequiresEdt
    override fun openSession(ref: SessionRef) {
        openSession(ref, focus = true)
    }

    @RequiresEdt
    open fun openSession(ref: SessionRef, focus: Boolean) {
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
        show(ui, focus)
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
        current?.syncActivity()
    }

    @RequiresEdt
    override fun focusPrompt() {
        focus(current?.promptFocusedComponent)
    }

    @RequiresEdt
    override fun emptyPanel(parent: Disposable, controller: SessionController): EmptySessionPanel = EmptySessionPanel(
        parent,
        controller,
        controller.recents(),
        history = { showHistory() },
        activity = { activity() },
        titles = { titles() },
        timers = timers,
    )

    @RequiresEdt
    protected fun currentUi(): SessionUi? = current

    /**
     * Present an empty, lazily-created session panel so a host never sits on a blank void while a
     * real session cannot be created yet (e.g. the backend is paused for migration). Unlike
     * [newSession] it does not fire [onSessionsChanged], so it won't kick off list reloads.
     */
    @RequiresEdt
    protected fun showBlank() {
        if (current?.blank == true) return
        show(create(project, root, this, null, timers))
    }

    @RequiresEdt
    fun currentKey(): String? {
        val ui = current ?: return null
        if (ui.blank) return NEW
        return ui.id ?: ui.cacheKey
    }

    @RequiresEdt
    protected fun latestUi(): SessionUi? = latest?.takeIf { it in all }

    @RequiresEdt
    protected open fun removeSession(id: String) {
        val ui = opened.remove(id) ?: return
        disposeUi(ui)
        onSessionsChanged()
    }

    @RequiresEdt
    protected fun disposeSession(id: String) {
        val ui = opened[id] ?: return
        disposeUi(ui)
        onSessionsChanged()
    }

    @RequiresEdt
    protected fun forceSession(id: String) {
        val ui = opened[id] ?: return
        disposeUi(ui)
    }

    @RequiresEdt
    protected fun show(ui: SessionUi, focus: Boolean = true) {
        cancel(ui)
        all.add(ui)
        register(ui)
        latest = ui
        if (current === ui) return
        release(current)
        current = ui
        present(ui)
        if (focus) focus(ui.defaultFocusedComponent)
    }

    @RequiresEdt
    protected fun focus(component: JComponent?) {
        val focus = component ?: return
        request(focus)
    }

    @RequiresEdt
    protected fun register(ui: SessionUi?) {
        val key = ui?.cacheKey ?: return
        opened.putIfAbsent(key, ui)
    }

    @RequiresEdt
    protected fun release(ui: SessionUi?) {
        if (ui == null) return
        if (ui.cacheKey == null) {
            disposeUi(ui)
            return
        }
        register(ui)
        schedule(ui)
    }

    @RequiresEdt
    protected fun clearCurrent() {
        current = null
        present(null)
    }

    @RequiresEdt
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

    @RequiresEdt
    private fun disposeUi(ui: SessionUi) {
        cancel(ui)
        opened.entries.removeIf { it.value === ui }
        all.remove(ui)
        if (current === ui) current = null
        if (latest === ui) latest = null
        Disposer.dispose(ui)
    }

    @RequiresEdt
    private fun schedule(ui: SessionUi) {
        cancel(ui)
        val delay = Registry.intValue("kilo.session.inactive.disposeTimeoutMs").coerceAtLeast(0)
        val timer = timers.timer(delay, repeats = false) {
            activeTimers.remove(ui)
            if (ui === current || ui !in all) return@timer
            disposeUi(ui)
            onSessionsChanged()
        }
        activeTimers[ui] = timer
        timer.start()
    }

    @RequiresEdt
    private fun cancel(ui: SessionUi) {
        activeTimers.remove(ui)?.stop()
    }

    @RequiresEdt
    protected open fun onSessionsChanged() {}

    @RequiresEdt
    protected abstract fun present(ui: SessionUi?)

    @RequiresEdt
    override fun dispose() {
        val items = all.toList()
        activeTimers.values.forEach { it.stop() }
        activeTimers.clear()
        opened.clear()
        all.clear()
        current = null
        latest = null
        present(null)
        items.forEach { Disposer.dispose(it) }
    }

    companion object {
        const val NEW = "new"
    }
}
