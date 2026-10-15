package ai.kilocode.client.settings.transcript

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.settings.ApprovalReasonVisibilityListener
import ai.kilocode.client.session.settings.BlockDisplay
import ai.kilocode.client.session.settings.ReasoningDisplay
import ai.kilocode.client.session.settings.TranscriptDisplay
import ai.kilocode.client.session.settings.TranscriptDisplayListener
import ai.kilocode.client.settings.base.SettingsDraftPage
import ai.kilocode.client.settings.base.SettingsPanel
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsRows
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.ComboBox
import com.intellij.ui.OnePixelSplitter
import com.intellij.ui.SimpleListCellRenderer
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import javax.swing.DefaultComboBoxModel
import javax.swing.JComponent

/**
 * Transcript page. Not a CLI-configurable draft: every value is an IDE-local preference, and the page
 * must stay editable with the CLI unavailable, so it is a plain [SettingsDraftPage] the configurable
 * drives directly. Edits collect into [draft]; nothing is persisted or broadcast until the platform
 * calls [applyDraft]. The preview reflects [draft] the whole time.
 */
internal class TranscriptSettingsUi(timers: UiTimerSource = UiTimers) : BorderLayoutPanel(), Disposable, SettingsDraftPage {
    private var saved = KiloPluginSettings.getTranscriptDisplay()
    private var draft = saved

    private val approvalReason = SettingsToggle(draft.approvalReason) { value -> update { it.copy(approvalReason = value) } }
    private val reasoning = reasoningCombo { value -> update { it.copy(reasoning = value) } }
    private val terminal = blockToggle(draft.terminal) { value -> update { it.copy(terminal = value) } }
    private val codeEdit = blockToggle(draft.codeEdit) { value -> update { it.copy(codeEdit = value) } }
    private val mcpTool = blockToggle(draft.mcpTool) { value -> update { it.copy(mcpTool = value) } }
    private val hoverPreview = SettingsToggle(draft.hoverPreview) { value -> update { it.copy(hoverPreview = value) } }
    private val preview = TranscriptPreview(display = { draft }, timers = timers)
    private val controls = SettingsPanel().apply {
        border = JBUI.Borders.emptyRight(UiStyle.Gap.xl())
        setContent(SettingsRows()
            .row(
                SettingsRow(
                    KiloBundle.message("settings.transcript.approvalReason.title"),
                    KiloBundle.message("settings.transcript.approvalReason.description"),
                    approvalReason,
                ),
            )
            .row(
                SettingsRow(
                    KiloBundle.message("settings.transcript.reasoningDisplay.title"),
                    KiloBundle.message("settings.transcript.reasoningDisplay.description"),
                    reasoning,
                ),
            )
            .row(
                SettingsRow(
                    KiloBundle.message("settings.transcript.terminalCommand.title"),
                    KiloBundle.message("settings.transcript.terminalCommand.description"),
                    terminal,
                ),
            )
            .row(
                SettingsRow(
                    KiloBundle.message("settings.transcript.codeEdit.title"),
                    KiloBundle.message("settings.transcript.codeEdit.description"),
                    codeEdit,
                ),
            )
            .row(
                SettingsRow(
                    KiloBundle.message("settings.transcript.mcpTool.title"),
                    KiloBundle.message("settings.transcript.mcpTool.description"),
                    mcpTool,
                ),
            )
            .row(
                SettingsRow(
                    KiloBundle.message("settings.transcript.hoverPreview.title"),
                    KiloBundle.message("settings.transcript.hoverPreview.description"),
                    hoverPreview,
                ),
            ))
    }

    init {
        isOpaque = false
        syncControls()
        // The sample goes straight into the splitter: no label and no insets, so it reads as the chat
        // transcript it mirrors. A SettingsPanel would also cap it at its preferred height.
        val splitter = OnePixelSplitter(true, 0.5f).apply {
            splitterProportionKey = "Kilo.TranscriptSettings.splitter"
            firstComponent = controls
            secondComponent = preview
        }
        add(splitter, java.awt.BorderLayout.CENTER)
    }

    override fun modified(): Boolean = draft != saved

    override fun applyDraft() {
        val next = draft
        if (next == saved) return
        KiloPluginSettings.setTranscriptDisplay(next)
        val bus = ApplicationManager.getApplication().messageBus
        if (appearanceChanged(saved, next)) {
            bus.syncPublisher(TranscriptDisplayListener.TOPIC).changed(next)
        }
        if (saved.approvalReason != next.approvalReason) {
            bus.syncPublisher(ApprovalReasonVisibilityListener.TOPIC).changed(next.approvalReason)
        }
        saved = next
    }

    override fun resetDraft() {
        saved = KiloPluginSettings.getTranscriptDisplay()
        draft = saved
        syncControls()
        preview.replay()
    }

    override fun dispose() {
        preview.dispose()
    }

    /** Test seam: the reflection controls, isolated from the preview's own toggles and combos. */
    internal fun controlsForTest(): JComponent = controls

    /** Test seam: the live preview surface. */
    internal fun previewForTest(): TranscriptPreview = preview

    private fun update(transform: (TranscriptDisplay) -> TranscriptDisplay) {
        val next = transform(draft)
        if (next == draft) return
        draft = next
        preview.replay()
    }

    private fun syncControls() {
        approvalReason.isSelected = draft.approvalReason
        reasoning.selectedItem = draft.reasoning
        terminal.isSelected = draft.terminal == BlockDisplay.EXPANDED
        codeEdit.isSelected = draft.codeEdit == BlockDisplay.EXPANDED
        mcpTool.isSelected = draft.mcpTool == BlockDisplay.EXPANDED
        hoverPreview.isSelected = draft.hoverPreview
    }

    companion object {
        private fun appearanceChanged(previous: TranscriptDisplay, next: TranscriptDisplay): Boolean =
            previous.reasoning != next.reasoning ||
                previous.terminal != next.terminal ||
                previous.codeEdit != next.codeEdit ||
                previous.mcpTool != next.mcpTool

        private fun reasoningLabel(value: ReasoningDisplay): String = when (value) {
            ReasoningDisplay.EXPANDED -> KiloBundle.message("settings.transcript.option.expanded")
            ReasoningDisplay.PREVIEW -> KiloBundle.message("settings.transcript.option.preview")
            ReasoningDisplay.HEADLINE -> KiloBundle.message("settings.transcript.option.headline")
        }

        private fun reasoningCombo(onSelect: (ReasoningDisplay) -> Unit): ComboBox<ReasoningDisplay> =
            ComboBox(DefaultComboBoxModel(ReasoningDisplay.entries.toTypedArray())).apply {
                renderer = SimpleListCellRenderer.create("") { reasoningLabel(it) }
                addActionListener { (selectedItem as? ReasoningDisplay)?.let(onSelect) }
            }

        /** Expanded-vs-collapsed is binary, so it reads as an on/off switch rather than a two-item list. */
        private fun blockToggle(value: BlockDisplay, onToggle: (BlockDisplay) -> Unit): SettingsToggle =
            SettingsToggle(value == BlockDisplay.EXPANDED) { on ->
                onToggle(if (on) BlockDisplay.EXPANDED else BlockDisplay.COLLAPSED)
            }
    }
}
