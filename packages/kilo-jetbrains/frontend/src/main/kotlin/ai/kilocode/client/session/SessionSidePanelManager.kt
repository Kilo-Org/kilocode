package ai.kilocode.client.session

import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.rpc.dto.SessionDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.DataProvider
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel

class SessionSidePanelManager(
    private val project: Project,
    private val root: Workspace,
    private val create: (Project, Workspace, SessionManager, String?, Boolean, SessionDto?) -> SessionUi = { project, workspace, manager, id, loading, session ->
        service<SessionUiFactory>().create(project, workspace, manager, id, loading, session)
    },
    private val resolve: (String) -> Workspace = { dir -> service<KiloWorkspaceService>().workspace(dir) },
) : SessionManager, Disposable {
    val component: JPanel = object : JPanel(BorderLayout()), DataProvider {
        override fun getData(dataId: String): Any? {
            if (SessionManager.KEY.`is`(dataId)) return this@SessionSidePanelManager
            return null
        }
    }

    private val opened = mutableMapOf<String, SessionUi>()
    private val all = mutableSetOf<SessionUi>()
    private var current: SessionUi? = null

    val defaultFocusedComponent: JComponent? get() = current?.defaultFocusedComponent

    override fun newSession() {
        val active = current
        if (active?.blank == true) return
        register(active)
        show(create(project, root, this, null, active == null, null))
    }

    override fun openSession(session: SessionDto) {
        register(current)
        val ui = opened.getOrPut(session.id) {
            create(project, resolve(session.directory), this, session.id, false, session).also {
                all.add(it)
            }
        }
        show(ui)
    }

    private fun show(ui: SessionUi) {
        all.add(ui)
        if (current === ui) return
        release(current)
        component.removeAll()
        current = ui
        component.add(ui, BorderLayout.CENTER)
        component.revalidate()
        component.repaint()
    }

    private fun register(ui: SessionUi?) {
        val id = ui?.id ?: return
        opened.putIfAbsent(id, ui)
    }

    private fun release(ui: SessionUi?) {
        if (ui == null) return
        if (ui.id != null) {
            register(ui)
            return
        }
        all.remove(ui)
        Disposer.dispose(ui)
    }

    override fun dispose() {
        val items = all.toList()
        opened.clear()
        all.clear()
        current = null
        component.removeAll()
        items.forEach { Disposer.dispose(it) }
    }
}
