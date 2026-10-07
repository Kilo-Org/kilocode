package ai.kilocode.client.settings.agents

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.auth.copyToClipboard
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.util.webUrl
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.JBUI
import java.awt.event.ActionEvent
import java.awt.event.FocusAdapter
import java.awt.event.FocusEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.AbstractAction
import javax.swing.Action
import javax.swing.JComponent

/**
 * Shown when the CLI could not open a browser to finish an MCP OAuth sign-in. Lets the user copy or
 * open the authorization URL manually.
 */
internal class McpAuthUrlDialog(
    private val name: String,
    private val url: String,
) : DialogWrapper(false) {
    private val urlField = JBTextField(url).apply {
        isEditable = false
        columns = 40
        addFocusListener(object : FocusAdapter() {
            override fun focusGained(e: FocusEvent) = selectAll()
        })
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) = selectAll()
        })
    }
    private var center: JComponent? = null

    // The URL originates from the remote MCP server, so the scheme is re-checked here instead of
    // trusting the caller: this dialog is also reachable from the CLI's browser-open-failed event.
    private val openAction: Action = object : AbstractAction(KiloBundle.message("settings.agentBehavior.mcp.authUrl.open")) {
        override fun actionPerformed(e: ActionEvent) {
            if (!webUrl(url)) return
            BrowserUtil.browse(url)
        }
    }

    private val copyAction: Action = object : AbstractAction(KiloBundle.message("settings.agentBehavior.mcp.authUrl.copy")) {
        override fun actionPerformed(e: ActionEvent) {
            copyToClipboard(url, KiloBundle.message("settings.agentBehavior.mcp.authUrl.copy"), urlField)
        }
    }

    init {
        title = KiloBundle.message("settings.agentBehavior.mcp.authUrl.title")
        isModal = false
        // Copying a non-web URL is harmless, opening it is not, so only Open is withheld.
        openAction.isEnabled = webUrl(url)
        init()
    }

    internal fun contentForTest(): JComponent = center ?: error("center panel not built")

    internal fun openActionForTest(): Action = openAction

    override fun createCenterPanel(): JComponent {
        val panel = Stack.vertical(UiStyle.Gap.sm())
            .next(JBLabel(KiloBundle.message("settings.agentBehavior.mcp.authUrl.message", name)))
            .next(urlField)
        panel.border = JBUI.Borders.empty(UiStyle.Gap.pad())
        center = panel
        return panel
    }

    override fun createActions(): Array<Action> = arrayOf(openAction, copyAction, okAction)

    override fun getPreferredFocusedComponent(): JComponent = urlField
}
