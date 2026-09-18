package ai.kilocode.client.session.subagent

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionUi
import ai.kilocode.client.session.SessionUiFactory
import ai.kilocode.client.vfs.KiloEditorKind
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloVirtualFile
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.cancel
import java.awt.BorderLayout
import javax.swing.Icon
import javax.swing.JComponent

object SubagentSessionEditorKind : KiloEditorKind {
    const val ID = "subagent-session"

    override val id: String = ID

    override fun title(params: Map<String, String>): String {
        val id = params[SESSION]?.takeIf { it.isNotBlank() } ?: return KiloBundle.message("session.subagent.title")
        return service<SubagentTitleCache>().title(id)?.takeIf { it.isNotBlank() }
            ?: KiloBundle.message("session.subagent.title")
    }

    override fun icon(params: Map<String, String>): Icon = AllIcons.Nodes.Function
    override fun presentablePath(params: Map<String, String>): String = KiloBundle.message("session.subagent.path", params[SESSION].orEmpty())
    override fun isValid(params: Map<String, String>): Boolean = !params[SESSION].isNullOrBlank() && !params[DIR].isNullOrBlank()

    @RequiresEdt
    override fun preferredFocus(component: JComponent): JComponent? = (component as? SubagentSessionEditorPanel)?.host?.currentFocus()

    @RequiresEdt
    override fun createContent(project: Project, file: KiloVirtualFile, parent: Disposable): JComponent {
        val id = file.path.params[SESSION]?.takeIf { it.isNotBlank() } ?: return BorderLayoutPanel()
        val dir = file.path.params[DIR]?.takeIf { it.isNotBlank() } ?: return BorderLayoutPanel()
        val workspace = service<KiloWorkspaceService>().workspace(dir)
        val cs = service<SessionUiFactory>().scope()
        Disposer.register(parent) { cs.cancel() }
        val host = SubagentSessionEditorHost(
            parent = parent,
            project = project,
            workspace = workspace,
            create = { p, w, manager, ref, timers ->
                SessionUi(
                    project = p,
                    workspace = w,
                    sessions = p.service<KiloSessionService>(),
                    app = service<KiloAppService>(),
                    cs = cs,
                    ref = ref,
                    manager = manager,
                    timers = timers,
                )
            },
        )
        host.open(id)
        return SubagentSessionEditorPanel(host)
    }

    private const val SESSION = "sessionId"
    private const val DIR = "directory"
}

class SubagentSessionEditorPanel(val host: SubagentSessionEditorHost) : BorderLayoutPanel() {
    init {
        add(host.component, BorderLayout.CENTER)
    }
}

fun ensureSubagentSessionEditorKind() {
    service<KiloEditorKindRegistry>().register(SubagentSessionEditorKind)
}

internal fun unregisterSubagentSessionEditorKind() {
    service<KiloEditorKindRegistry>().unregister(SubagentSessionEditorKind.ID)
}

internal fun subagentSessionParams(sessionId: String, directory: String): Map<String, String> = linkedMapOf(
    "sessionId" to sessionId,
    "directory" to directory,
)
