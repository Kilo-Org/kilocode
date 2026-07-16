package ai.kilocode.client.settings.context

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.BaseSettingsUi
import ai.kilocode.client.settings.base.SettingsBannerKind
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsStackedRow
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ModelStateDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.components.service
import com.intellij.ui.CollectionListModel
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.ToolbarDecorator
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBTextField
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CoroutineScope
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.ListSelectionModel
import javax.swing.event.DocumentEvent
import javax.swing.text.AbstractDocument
import javax.swing.text.AttributeSet
import javax.swing.text.DocumentFilter

internal class ContextSettingsUi(
    cs: CoroutineScope,
    private val app: KiloAppService = service(),
    workspaces: KiloWorkspaceService = service(),
) : BaseSettingsUi<ContextSettingsContent, ContextDraft, ConfigPatchDto, KiloAppStateDto, Unit>(
    cs,
    ContextDraft(),
    app,
    workspaces,
    loginBanner = false,
) {
    init {
        startSettings(ContextSettingsContent { updateDraft(it) })
    }

    override fun change(from: ContextDraft, to: ContextDraft): ConfigPatchDto? = patch(from, to).takeIf(::changed)

    override fun save(change: ConfigPatchDto, done: (KiloAppStateDto?) -> Unit) {
        app.updateConfigAsync(change, done)
    }

    override fun base(result: KiloAppStateDto): ContextDraft = contextDraft(result.config)

    override fun draft(state: KiloAppStateDto): ContextDraft = contextDraft(state.config)

    override fun saved(base: ContextDraft, draft: ContextDraft): Boolean = savedMatches(base, draft)

    override fun pendingText(): String = KiloBundle.message("settings.context.save.pending")

    override fun failedText(): String = KiloBundle.message("settings.context.save.failed")

    override suspend fun loadWorkspace(root: String) = Unit

    override fun applyWorkspace(result: Unit) = Unit

    override fun models(state: ModelStateDto) = Unit

    override fun logSaveStarted(change: ConfigPatchDto) = LOG.info("context settings save: started ${summary(change)}")

    override fun logSaveCompleted(change: ConfigPatchDto) = LOG.info("context settings save: completed ${summary(change)}")

    override fun logSaveFailed(change: ConfigPatchDto) = LOG.warn("context settings save: failed ${summary(change)}")

    override fun logSaveFailedAfterDispose(change: ConfigPatchDto) = LOG.warn("context settings save: failed after dispose ${summary(change)}")

    override fun logSaveCompletedAfterDispose(change: ConfigPatchDto) = LOG.info("context settings save: completed after dispose ${summary(change)}")

    @RequiresEdt
    override fun syncContent() {
        val ready = appState.status == KiloAppStatusDto.READY
        val editable = ready && !saving
        form.sync(draft, editable)
        top.hideBanner()
        val err = saveError
        if (saving) {
            showProgress(KiloBundle.message("settings.context.save.pending"))
            return
        }
        if (err != null) {
            showError(err)
            return
        }
        if (!ready) {
            showProgress(KiloBundle.message("settings.cli.unavailable.message"))
            return
        }
        if (thresholdStatus(draft.threshold) == ThresholdStatus.INVALID) {
            top.showBanner(
                KiloBundle.message("settings.context.compaction.threshold.invalid"),
                emptyList(),
                SettingsBannerKind.ERROR,
            )
            clearProgress()
            return
        }
        clearProgress()
    }

    private companion object {
        val LOG = KiloLog.create(ContextSettingsUi::class.java)
    }
}

internal class ContextSettingsContent(
    private val update: (ContextDraft.() -> ContextDraft) -> Unit,
) : BaseContentPanel() {
    private val auto = SettingsToggle { value -> update { copy(auto = value) } }
    private val prune = SettingsToggle { value -> update { copy(prune = value) } }
    private val threshold = ThresholdField { value -> update { copy(threshold = value) } }
    private val patterns = PatternList { value -> update { copy(ignore = value) } }

    init {
        section(
            KiloBundle.message("settings.context.compaction.title"),
            KiloBundle.message("settings.context.compaction.description"),
        ).apply {
            row(SettingsRow(
                KiloBundle.message("settings.context.compaction.auto.title"),
                KiloBundle.message("settings.context.compaction.auto.description"),
                auto,
            ))
            row(SettingsRow(
                KiloBundle.message("settings.context.compaction.threshold.title"),
                KiloBundle.message("settings.context.compaction.threshold.description"),
                threshold.align(HAlign.RIGHT, VAlign.CENTER),
            ))
            row(SettingsRow(
                KiloBundle.message("settings.context.compaction.prune.title"),
                KiloBundle.message("settings.context.compaction.prune.description"),
                prune,
            ))
        }
        section(
            KiloBundle.message("settings.context.watcher.title"),
            KiloBundle.message("settings.context.watcher.description"),
        ).row(SettingsStackedRow(
            KiloBundle.message("settings.context.watcher.patterns.title"),
            KiloBundle.message("settings.context.watcher.patterns.description"),
            patterns,
        ))
    }

    @RequiresEdt
    fun sync(draft: ContextDraft, enabled: Boolean) {
        auto.isSelected = draft.auto
        prune.isSelected = draft.prune
        threshold.sync(draft.threshold)
        patterns.sync(draft.ignore)
        listOf(auto, prune, threshold, patterns).forEach { it.isEnabled = enabled }
    }
}

private class ThresholdField(
    private val change: (String) -> Unit,
) : JBTextField() {
    private var syncing = false

    init {
        columns = THRESHOLD_COLUMNS
        emptyText.text = KiloBundle.message("settings.context.compaction.threshold.placeholder")
        (document as AbstractDocument).documentFilter = NumberFilter()
        document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(e: DocumentEvent) {
                if (!syncing) change(text)
            }
        })
    }

    fun sync(value: String) {
        if (text == value) return
        syncing = true
        text = value
        syncing = false
    }
}

private class NumberFilter : DocumentFilter() {
    override fun insertString(fb: FilterBypass, offset: Int, string: String?, attr: AttributeSet?) {
        replace(fb, offset, 0, string, attr)
    }

    override fun replace(fb: FilterBypass, offset: Int, length: Int, text: String?, attrs: AttributeSet?) {
        val value = text ?: ""
        val next = StringBuilder(fb.document.getText(0, fb.document.length))
            .replace(offset, offset + length, value)
            .toString()
        if (next.isEmpty() || valid(next)) super.replace(fb, offset, length, value, attrs)
    }

    private fun valid(value: String): Boolean {
        if (value.count { it == '.' } > 1) return false
        return value.all { it.isDigit() || it == '.' }
    }
}

internal class PatternList(
    private val change: (List<String>) -> Unit,
) : Stack(StackAxis.VERTICAL, UiStyle.Gap.sm()) {
    private val model = CollectionListModel<String>()
    internal val entry = JBTextField().apply {
        emptyText.text = KiloBundle.message("settings.context.watcher.placeholder")
    }
    private val add = JButton(KiloBundle.message("settings.context.watcher.add"), AllIcons.General.Add).apply {
        addActionListener { add() }
    }
    private val list = JBList(model).apply {
        selectionMode = ListSelectionModel.SINGLE_SELECTION
        emptyText.text = KiloBundle.message("settings.context.watcher.empty")
    }
    private val panel = ToolbarDecorator.createDecorator(list)
        .disableUpDownActions()
        .disableAddAction()
        .setRemoveAction { remove() }
        .setRemoveActionUpdater { isEnabled && list.selectedIndex >= 0 }
        .createPanel()

    init {
        entry.document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(e: DocumentEvent) = syncAdd()
        })
        entry.registerKeyboardAction(
            { add() },
            javax.swing.KeyStroke.getKeyStroke(java.awt.event.KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
        next(Stack.horizontal(UiStyle.Gap.sm()).next(entry).next(add))
        next(panel)
        syncAdd()
    }

    @RequiresEdt
    fun sync(values: List<String>) {
        if (model.items == values) return
        model.replaceAll(values)
        syncAdd()
    }

    override fun setEnabled(enabled: Boolean) {
        super.setEnabled(enabled)
        entry.isEnabled = enabled
        add.isEnabled = enabled && entry.text.trim().isNotBlank()
        list.isEnabled = enabled
        panel.isEnabled = enabled
        syncAdd()
    }

    private fun add() {
        val value = entry.text.trim()
        if (!isEnabled || value.isBlank()) return
        val values = model.items.toMutableList()
        if (value !in values) values += value
        entry.text = ""
        model.replaceAll(values)
        change(values)
        syncAdd()
    }

    private fun remove() {
        val idx = list.selectedIndex
        if (!isEnabled || idx < 0 || idx >= model.size) return
        val values = model.items.toMutableList()
        values.removeAt(idx)
        model.replaceAll(values)
        change(values)
        syncAdd()
    }

    private fun syncAdd() {
        add.isEnabled = isEnabled && entry.text.trim().isNotBlank()
    }
}

private fun summary(patch: ConfigPatchDto): String {
    val parts = listOfNotNull(
        "watcher".takeIf { patch.watcher != null },
        "compaction".takeIf { patch.compaction != null },
    )
    return parts.joinToString(",").ifEmpty { "none" }
}

private const val THRESHOLD_COLUMNS = 8
