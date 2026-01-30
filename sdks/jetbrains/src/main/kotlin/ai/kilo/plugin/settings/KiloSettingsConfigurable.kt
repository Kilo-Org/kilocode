package ai.kilo.plugin.settings

import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.ui.TextFieldWithBrowseButton
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.ui.components.fields.ExtendableTextField
import com.intellij.util.ui.FormBuilder
import com.intellij.util.ui.JBUI
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * Settings UI for the Kilo plugin.
 * Accessible via Settings > Tools > Kilo
 */
class KiloSettingsConfigurable : Configurable {

    private var panel: JPanel? = null
    private var executablePathField: TextFieldWithBrowseButton? = null
    private var autoStartCheckbox: JBCheckBox? = null
    private var serverPortField: JBTextField? = null
    private var defaultAgentField: JBTextField? = null

    override fun getDisplayName(): String = "Kilo"

    override fun createComponent(): JComponent {
        executablePathField = TextFieldWithBrowseButton().apply {
            addBrowseFolderListener(
                "Select Kilo Executable",
                "Choose the path to the kilo or opencode executable",
                null,
                FileChooserDescriptorFactory.createSingleFileDescriptor()
            )
            toolTipText = "Leave empty to auto-detect kilo or opencode in PATH"
        }

        autoStartCheckbox = JBCheckBox("Auto-start server when project opens")

        serverPortField = JBTextField(10).apply {
            toolTipText = "Leave empty for random port"
        }

        defaultAgentField = JBTextField(20).apply {
            toolTipText = "Default agent is 'code'"
        }

        panel = FormBuilder.createFormBuilder()
            .addLabeledComponent(
                JBLabel("Executable path:"),
                executablePathField!!,
                1,
                false
            )
            .addComponent(
                JBLabel("Leave empty to auto-detect kilo or opencode in PATH").apply {
                    foreground = JBUI.CurrentTheme.ContextHelp.FOREGROUND
                    font = JBUI.Fonts.smallFont()
                },
                0
            )
            .addVerticalGap(10)
            .addComponent(autoStartCheckbox!!, 1)
            .addVerticalGap(10)
            .addLabeledComponent(
                JBLabel("Server port:"),
                serverPortField!!,
                1,
                false
            )
            .addComponent(
                JBLabel("Leave empty for random port assignment").apply {
                    foreground = JBUI.CurrentTheme.ContextHelp.FOREGROUND
                    font = JBUI.Fonts.smallFont()
                },
                0
            )
            .addVerticalGap(10)
            .addLabeledComponent(
                JBLabel("Default agent:"),
                defaultAgentField!!,
                1,
                false
            )
            .addComponent(
                JBLabel("Agent to use by default (e.g., code, plan, debug)").apply {
                    foreground = JBUI.CurrentTheme.ContextHelp.FOREGROUND
                    font = JBUI.Fonts.smallFont()
                },
                0
            )
            .addComponentFillVertically(JPanel(), 0)
            .panel

        return panel!!
    }

    override fun isModified(): Boolean {
        val settings = KiloSettings.getInstance()
        val state = settings.state

        return executablePathField?.text != state.kiloExecutablePath ||
                autoStartCheckbox?.isSelected != state.autoStartServer ||
                parsePort(serverPortField?.text) != state.serverPort ||
                parseAgent(defaultAgentField?.text) != state.defaultAgent
    }

    override fun apply() {
        val settings = KiloSettings.getInstance()
        val state = settings.state

        state.kiloExecutablePath = executablePathField?.text ?: ""
        state.autoStartServer = autoStartCheckbox?.isSelected ?: true
        state.serverPort = parsePort(serverPortField?.text)
        state.defaultAgent = parseAgent(defaultAgentField?.text)
    }

    override fun reset() {
        val settings = KiloSettings.getInstance()
        val state = settings.state

        executablePathField?.text = state.kiloExecutablePath
        autoStartCheckbox?.isSelected = state.autoStartServer
        serverPortField?.text = state.serverPort?.toString() ?: ""
        defaultAgentField?.text = state.defaultAgent ?: ""
    }

    override fun disposeUIResources() {
        panel = null
        executablePathField = null
        autoStartCheckbox = null
        serverPortField = null
        defaultAgentField = null
    }

    override fun getPreferredFocusedComponent(): JComponent? = executablePathField

    private fun parsePort(text: String?): Int? {
        if (text.isNullOrBlank()) return null
        return text.trim().toIntOrNull()?.takeIf { it in 1024..65535 }
    }

    private fun parseAgent(text: String?): String? {
        if (text.isNullOrBlank()) return null
        return text.trim().takeIf { it.isNotEmpty() }
    }
}
