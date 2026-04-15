package ai.kilocode.client

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.LoadErrorDto
import ai.kilocode.rpc.dto.LoadProgressDto
import ai.kilocode.rpc.dto.ProfileStatusDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.openapi.wm.ToolWindowManager
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
        val svc = service<KiloAppService>()
        val mgr = ToolWindowManager.getInstance(project)
        val icon = JBLabel(
            IconLoader.getIcon("/icons/kilo-content.svg", KiloToolWindowFactory::class.java),
        ).apply {
            horizontalAlignment = SwingConstants.CENTER
            alignmentX = JPanel.CENTER_ALIGNMENT
        }

        val status = JBLabel(
            KiloBundle.message("toolwindow.status.disconnected"),
            SwingConstants.CENTER,
        ).apply {
            alignmentX = JPanel.CENTER_ALIGNMENT
            font = JBUI.Fonts.label(13f)
            foreground = UIUtil.getContextHelpForeground()
            setAllowAutoWrapping(true)
        }

        val detail = JBLabel("", SwingConstants.CENTER).apply {
            alignmentX = JPanel.CENTER_ALIGNMENT
            font = JBUI.Fonts.smallFont()
            foreground = UIUtil.getContextHelpForeground()
            setAllowAutoWrapping(true)
            setCopyable(true)
        }

        val body = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
            add(icon)
            add(Box.createVerticalStrut(JBUI.scale(16)))
            add(status)
            add(Box.createVerticalStrut(JBUI.scale(6)))
            add(detail)
        }

        val panel = JPanel(GridBagLayout()).apply {
            isOpaque = false
            add(body, GridBagConstraints())
        }

        val content = ContentFactory.getInstance().createContent(panel, "", false)
        val ui = Disposer.newDisposable()
        val job = svc.watch { state ->
            mgr.invokeLater {
                status.text = title(state)
                detail.text = details(state)
                detail.isVisible = detail.text.isNotEmpty()
            }
        }
        Disposer.register(ui, Disposable { job.cancel() })
        content.setDisposer(ui)
        toolWindow.contentManager.addContent(content)
        ActionManager.getInstance().getAction("Kilo.Settings")?.let {
            toolWindow.setTitleActions(listOf(it))
        }
        svc.connect()
    }

    private fun title(state: KiloAppStateDto): String =
        when (state.status) {
            KiloAppStatusDto.DISCONNECTED -> KiloBundle.message("toolwindow.status.disconnected")
            KiloAppStatusDto.CONNECTING -> KiloBundle.message("toolwindow.status.connecting")
            KiloAppStatusDto.LOADING -> KiloBundle.message("toolwindow.status.loading")
            KiloAppStatusDto.READY -> KiloBundle.message("toolwindow.status.connected")
            KiloAppStatusDto.ERROR -> KiloBundle.message(
                "toolwindow.status.error",
                state.error ?: KiloBundle.message("toolwindow.error.unknown"),
            )
        }

    private fun details(state: KiloAppStateDto): String =
        when (state.status) {
            KiloAppStatusDto.LOADING -> progress(state.progress)
            KiloAppStatusDto.READY -> ready(state)
            KiloAppStatusDto.ERROR -> errors(state)
            else -> ""
        }

    private fun progress(p: LoadProgressDto?): String {
        if (p == null) return ""
        val lines = mutableListOf<String>()
        lines.add(item("Config", p.config))
        lines.add(item("Notifications", p.notifications))
        lines.add(profile(p.profile))
        return "<html>${lines.joinToString("<br>")}</html>"
    }

    private fun item(name: String, loaded: Boolean): String =
        if (loaded) "$CHECK $name" else "$DOTS $name"

    private fun profile(status: ProfileStatusDto): String =
        when (status) {
            ProfileStatusDto.PENDING -> "$DOTS Profile"
            ProfileStatusDto.LOADED -> "$CHECK Profile"
            ProfileStatusDto.NOT_LOGGED_IN -> "$DASH Profile (not logged in)"
        }

    private fun ready(state: KiloAppStateDto): String {
        val svc = service<KiloAppService>()
        val ver = svc.version
        val lines = mutableListOf<String>()
        if (ver != null) lines.add("CLI: $ver")
        val p = state.progress
        if (p != null && p.profile == ProfileStatusDto.NOT_LOGGED_IN) {
            lines.add("Profile: not logged in")
        }
        return if (lines.isEmpty()) "" else "<html>${lines.joinToString("<br>")}</html>"
    }

    private fun errors(state: KiloAppStateDto): String {
        if (state.errors.isEmpty()) return ""
        val lines = state.errors.map(::formatError)
        return "<html>Failed to load:<br>${lines.joinToString("<br>")}</html>"
    }

    private fun formatError(err: LoadErrorDto): String {
        val suffix = err.detail ?: err.status?.let { "HTTP $it" } ?: ""
        return if (suffix.isEmpty()) "$CROSS ${err.resource}"
        else "$CROSS ${err.resource}: $suffix"
    }

    companion object {
        private const val CHECK = "\u2713"
        private const val CROSS = "\u2717"
        private const val DOTS = "\u2026"
        private const val DASH = "\u2013"
    }
}
