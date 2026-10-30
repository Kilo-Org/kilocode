package ai.kilocode.client.agentManager

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SessionHost
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.SessionUi
import ai.kilocode.client.session.SessionUiFactory
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.components.BorderLayoutPanel
import javax.swing.JComponent

/** Owns the same retained session surface and selection notifications for either backend. */
abstract class WorkspaceSessionEditorManager(
    project: Project,
    workspace: Workspace,
    create: (Project, Workspace, SessionManager, SessionRef?, UiTimerSource) -> SessionUi =
        { project, workspace, manager, ref, timers ->
            service<SessionUiFactory>().create(project, workspace, manager, ref, timers)
        },
    resolve: (String) -> Workspace = { dir -> service<KiloWorkspaceService>().workspace(dir) },
    status: () -> Map<String, SessionActivityKind> = { project.service<KiloSessionService>().activitySnapshot() },
    timers: UiTimerSource = UiTimers,
    request: (JComponent) -> Unit = { focus ->
        ApplicationManager.getApplication().invokeLater({
            IdeFocusManager.getInstance(project).requestFocusInProject(focus, project)
        }, ModalityState.defaultModalityState())
    },
) : SessionHost(project, workspace, create, resolve, status, timers, request) {
    val component = BorderLayoutPanel()
    var onPresent: ((String?) -> Unit)? = null
    var onListChanged: (() -> Unit)? = null
    override val hostedInEditorTab: Boolean get() = true

    @RequiresEdt
    override fun present(ui: SessionUi?) {
        if (component.components.firstOrNull() === ui) return
        component.removeAll()
        if (ui != null) component.addToCenter(ui)
        component.revalidate()
        component.repaint()
        onPresent?.invoke(currentKey())
    }
}
