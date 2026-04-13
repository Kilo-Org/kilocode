package ai.kilocode

import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBLabel
import com.intellij.ui.content.ContentFactory
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JPanel
import javax.swing.SwingConstants

class KiloToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val svc = project.service<KiloApiService>()
        val icon = JBLabel(
            IconLoader.getIcon("/icons/kilo-content.svg", KiloToolWindowFactory::class.java),
        ).apply {
            horizontalAlignment = SwingConstants.CENTER
            alignmentX = JPanel.CENTER_ALIGNMENT
        }

        val text = JBLabel(KiloBundle.message("toolwindow.status.disconnected"), SwingConstants.CENTER).apply {
            alignmentX = JPanel.CENTER_ALIGNMENT
            font = JBUI.Fonts.label(13f)
            foreground = UIUtil.getContextHelpForeground()
            setAllowAutoWrapping(true)
        }

        val body = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
            add(icon)
            add(Box.createVerticalStrut(JBUI.scale(16)))
            add(text)
        }

        val panel = JPanel(GridBagLayout()).apply {
            isOpaque = false
            add(body, GridBagConstraints())
        }

        val content = ContentFactory.getInstance().createContent(panel, "", false)
        val ui = Disposer.newDisposable()
        val job = svc.watch { msg ->
            text.text = msg
        }
        Disposer.register(ui, Disposable { job.cancel() })
        content.setDisposer(ui)
        toolWindow.contentManager.addContent(content)
        ActionManager.getInstance().getAction("Kilo.Settings")?.let {
            toolWindow.setTitleActions(listOf(it))
        }
        svc.connect()
    }
}
