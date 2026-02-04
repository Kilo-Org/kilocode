package ai.kilo.plugin.actions

import ai.kilo.plugin.services.KiloCliDiscovery
import ai.kilo.plugin.services.KiloServerService
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.components.JBLabel
import com.intellij.ui.dsl.builder.panel
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.swing.JComponent

/**
 * Action to display Kilo server information in a popup dialog.
 */
class ServerInfoAction : AnAction(), DumbAware {
    private val scope = CoroutineScope(Dispatchers.Default)

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val serverService = KiloServerService.getInstance(project)

        scope.launch {
            val health = serverService.checkHealth()
            val cliBinary = KiloCliDiscovery.findBinary(project.basePath)

            withContext(Dispatchers.Main) {
                val dialog = ServerInfoDialog(
                    baseUrl = serverService.baseUrl,
                    isRunning = serverService.isServerRunning,
                    version = health?.version,
                    healthy = health?.healthy,
                    cliBinary = cliBinary,
                    projectPath = project.basePath
                )
                dialog.show()
            }
        }
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null
    }
}

private class ServerInfoDialog(
    private val baseUrl: String,
    private val isRunning: Boolean,
    private val version: String?,
    private val healthy: Boolean?,
    private val cliBinary: String?,
    private val projectPath: String?
) : DialogWrapper(true) {

    init {
        title = "Kilo Server Info"
        setOKButtonText("Close")
        setCancelButtonText("")
        init()
    }

    override fun createCenterPanel(): JComponent {
        return panel {
            row("Status:") {
                cell(JBLabel(if (isRunning) "Running" else "Stopped").apply {
                    foreground = if (isRunning) JBUI.CurrentTheme.Focus.focusColor() else JBUI.CurrentTheme.Label.disabledForeground()
                })
            }
            row("Health:") {
                cell(JBLabel(when (healthy) {
                    true -> "Healthy"
                    false -> "Unhealthy"
                    null -> "Unknown"
                }))
            }
            row("Version:") {
                cell(JBLabel(version ?: "Unknown"))
            }
            separator()
            row("Server URL:") {
                cell(JBLabel(baseUrl))
            }
            row("CLI Binary:") {
                cell(JBLabel(cliBinary ?: "Not found"))
            }
            row("Project:") {
                cell(JBLabel(projectPath ?: "Unknown"))
            }
        }.apply {
            border = JBUI.Borders.empty(10)
        }
    }

    override fun createActions() = arrayOf(okAction)
}
