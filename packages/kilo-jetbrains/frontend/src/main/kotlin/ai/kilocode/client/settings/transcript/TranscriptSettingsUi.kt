package ai.kilocode.client.settings.transcript

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.settings.ApprovalReasonVisibilityListener
import ai.kilocode.client.session.settings.BlockDisplay
import ai.kilocode.client.session.settings.ReasoningDisplay
import ai.kilocode.client.session.settings.TranscriptDisplayListener
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.SettingsPanel
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsToggle
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.ComboBox
import com.intellij.ui.SimpleListCellRenderer
import javax.swing.DefaultComboBoxModel

/**
 * Transcript page. Every setting here is a local IDE preference, so the page renders immediately
 * and writes on change instead of going through [ai.kilocode.client.settings.base.BaseSettingsUi]'s
 * draft/apply flow, which would gate the UI on CLI readiness it does not need.
 */
internal class TranscriptSettingsUi : SettingsPanel(), Disposable {
    private val approvalReason = SettingsToggle(KiloPluginSettings.getShowApprovalReason()) { visible ->
        KiloPluginSettings.setShowApprovalReason(visible)
        ApplicationManager.getApplication().messageBus
            .syncPublisher(ApprovalReasonVisibilityListener.TOPIC)
            .changed(visible)
    }
    private val reasoning = reasoningCombo(::setReasoning)
        .apply { selectedItem = KiloPluginSettings.getReasoningDisplay() }
    private val terminal = blockCombo(::setTerminal)
        .apply { selectedItem = KiloPluginSettings.getTerminalCommandDisplay() }
    private val codeEdit = blockCombo(::setCodeEdit)
        .apply { selectedItem = KiloPluginSettings.getCodeEditDisplay() }
    private val mcpTool = blockCombo(::setMcpTool)
        .apply { selectedItem = KiloPluginSettings.getMcpToolDisplay() }
    private val hoverPreview = SettingsToggle(KiloPluginSettings.getHoverPreview()) { KiloPluginSettings.setHoverPreview(it) }

    init {
        val content = BaseContentPanel()
        content.section(
            KiloBundle.message("settings.transcript.title"),
            KiloBundle.message("settings.transcript.description"),
        ).row(
            SettingsRow(
                KiloBundle.message("settings.transcript.approvalReason.title"),
                KiloBundle.message("settings.transcript.approvalReason.description"),
                approvalReason,
            ),
        ).row(
            SettingsRow(
                KiloBundle.message("settings.transcript.reasoningDisplay.title"),
                KiloBundle.message("settings.transcript.reasoningDisplay.description"),
                reasoning,
            ),
        ).row(
            SettingsRow(
                KiloBundle.message("settings.transcript.terminalCommand.title"),
                KiloBundle.message("settings.transcript.terminalCommand.description"),
                terminal,
            ),
        ).row(
            SettingsRow(
                KiloBundle.message("settings.transcript.codeEdit.title"),
                KiloBundle.message("settings.transcript.codeEdit.description"),
                codeEdit,
            ),
        ).row(
            SettingsRow(
                KiloBundle.message("settings.transcript.mcpTool.title"),
                KiloBundle.message("settings.transcript.mcpTool.description"),
                mcpTool,
            ),
        ).row(
            SettingsRow(
                KiloBundle.message("settings.transcript.hoverPreview.title"),
                KiloBundle.message("settings.transcript.hoverPreview.description"),
                hoverPreview,
            ),
        )
        setContent(content)
    }

    /** Resyncs every control from persisted state, e.g. when the platform calls [reset]. */
    fun sync() {
        approvalReason.isSelected = KiloPluginSettings.getShowApprovalReason()
        reasoning.selectedItem = KiloPluginSettings.getReasoningDisplay()
        terminal.selectedItem = KiloPluginSettings.getTerminalCommandDisplay()
        codeEdit.selectedItem = KiloPluginSettings.getCodeEditDisplay()
        mcpTool.selectedItem = KiloPluginSettings.getMcpToolDisplay()
        hoverPreview.isSelected = KiloPluginSettings.getHoverPreview()
    }

    private fun setReasoning(value: ReasoningDisplay) {
        if (KiloPluginSettings.getReasoningDisplay() == value) return
        KiloPluginSettings.setReasoningDisplay(value)
        displayChanged()
    }

    private fun setTerminal(value: BlockDisplay) {
        if (KiloPluginSettings.getTerminalCommandDisplay() == value) return
        KiloPluginSettings.setTerminalCommandDisplay(value)
        displayChanged()
    }

    private fun setCodeEdit(value: BlockDisplay) {
        if (KiloPluginSettings.getCodeEditDisplay() == value) return
        KiloPluginSettings.setCodeEditDisplay(value)
        displayChanged()
    }

    private fun setMcpTool(value: BlockDisplay) {
        if (KiloPluginSettings.getMcpToolDisplay() == value) return
        KiloPluginSettings.setMcpToolDisplay(value)
        displayChanged()
    }

    private fun displayChanged() {
        ApplicationManager.getApplication().messageBus
            .syncPublisher(TranscriptDisplayListener.TOPIC)
            .changed()
    }

    override fun dispose() = Unit

    companion object {
        private fun reasoningLabel(value: ReasoningDisplay): String = when (value) {
            ReasoningDisplay.EXPANDED -> KiloBundle.message("settings.transcript.option.expanded")
            ReasoningDisplay.PREVIEW -> KiloBundle.message("settings.transcript.option.preview")
            ReasoningDisplay.HEADLINE -> KiloBundle.message("settings.transcript.option.headline")
        }

        private fun blockLabel(value: BlockDisplay): String = when (value) {
            BlockDisplay.EXPANDED -> KiloBundle.message("settings.transcript.option.expanded")
            BlockDisplay.COLLAPSED -> KiloBundle.message("settings.transcript.option.collapsed")
        }

        private fun reasoningCombo(onSelect: (ReasoningDisplay) -> Unit): ComboBox<ReasoningDisplay> =
            ComboBox(DefaultComboBoxModel(ReasoningDisplay.entries.toTypedArray())).apply {
                renderer = SimpleListCellRenderer.create("") { reasoningLabel(it) }
                addActionListener { (selectedItem as? ReasoningDisplay)?.let(onSelect) }
            }

        private fun blockCombo(onSelect: (BlockDisplay) -> Unit): ComboBox<BlockDisplay> =
            ComboBox(DefaultComboBoxModel(BlockDisplay.entries.toTypedArray())).apply {
                renderer = SimpleListCellRenderer.create("") { blockLabel(it) }
                addActionListener { (selectedItem as? BlockDisplay)?.let(onSelect) }
            }
    }
}
