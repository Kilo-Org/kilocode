package ai.kilocode.client.settings.context

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.BaseSettingsUi
import ai.kilocode.client.settings.base.SettingsBannerKind
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.client.ui.HoverIcon
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
import com.intellij.openapi.ui.Messages
import com.intellij.ui.CollectionListModel
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.ScrollingUtil
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextField
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.DefaultListCellRenderer
import javax.swing.JList
import javax.swing.ListSelectionModel
import javax.swing.ScrollPaneConstants
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

    override fun change(from: ContextDraft, to: ContextDraft): ConfigPatchDto? = patch(from, to)?.takeIf(::changed)

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
    private val threshold = ThresholdField(
        KiloBundle.message("settings.context.compaction.threshold.placeholder"),
    ) { value -> update { copy(threshold = value) } }
    private val patterns = PatternList { value -> update { copy(ignore = value) } }

    init {
        section(
            KiloBundle.message("settings.context.compaction.title"),
        ).apply {
            row(SettingsRow(
                KiloBundle.message("settings.context.compaction.auto.title"),
                KiloBundle.message("settings.context.compaction.auto.description"),
                auto,
            ))
            row(SettingsRow(
                KiloBundle.message("settings.context.compaction.threshold.title"),
                KiloBundle.message("settings.context.compaction.threshold.description"),
                Stack.horizontal(UiStyle.Gap.xs())
                    .next(threshold)
                    .next(JBLabel(KiloBundle.message("settings.context.compaction.threshold.suffix")))
                    .align(HAlign.RIGHT, VAlign.CENTER),
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
        ).row(patterns)
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
    placeholder: String,
    private val change: (String) -> Unit,
) : JBTextField() {
    private var syncing = false

    init {
        columns = THRESHOLD_COLUMNS
        emptyText.text = placeholder
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
        if (!value.all { it.isDigit() || it == '.' }) return false
        val num = value.toDoubleOrNull() ?: return false
        return num >= 0.0 && num <= 100.0
    }
}

internal class PatternList(
    private val change: (List<String>) -> Unit,
) : Stack(StackAxis.VERTICAL, UiStyle.Gap.sm()) {
    private val model = CollectionListModel<String>()
    internal var input: () -> String? = {
        Messages.showInputDialog(
            this,
            KiloBundle.message("settings.context.watcher.input.prompt"),
            KiloBundle.message("settings.context.watcher.input.title"),
            null,
        )
    }
    internal var editor: (String) -> String? = { value ->
        Messages.showInputDialog(
            this,
            KiloBundle.message("settings.context.watcher.input.prompt"),
            KiloBundle.message("settings.context.watcher.title"),
            null,
            value,
            null,
        )
    }
    private val add = HoverIcon().apply {
        icon = AllIcons.General.Add
        toolTipText = KiloBundle.message("settings.context.watcher.add")
        addActionListener { add() }
    }
    private val remove = HoverIcon().apply {
        icon = AllIcons.General.Remove
        toolTipText = KiloBundle.message("settings.context.watcher.remove")
        addActionListener { remove() }
    }
    private val list = JBList(model).apply {
        selectionMode = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION
        isFocusable = true
        emptyText.text = KiloBundle.message("settings.context.watcher.empty")
        cellRenderer = PatternRenderer()
    }
    private val toolbar = Stack.horizontal().next(add).next(remove)
    private val scroll = JBScrollPane(list).apply {
        border = null
        viewportBorder = null
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
    }

    init {
        border = JBUI.Borders.empty(UiStyle.Gap.pad(), 0, UiStyle.Gap.pad(), 0)
        list.addListSelectionListener { if (!it.valueIsAdjusting) syncActions() }
        list.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount != 2 || !UIUtil.isActionClick(e, MouseEvent.MOUSE_CLICKED, true)) return
                val idx = list.locationToIndex(e.point)
                if (idx < 0 || list.getCellBounds(idx, idx)?.contains(e.point) != true) return
                edit(idx)
            }
        })
        list.registerKeyboardAction(
            { remove() },
            javax.swing.KeyStroke.getKeyStroke(KeyEvent.VK_DELETE, 0),
            JComponent.WHEN_FOCUSED,
        )
        ScrollingUtil.installActions(list)
        next(toolbar.align(HAlign.LEFT, VAlign.CENTER))
        gap(UiStyle.Gap.sm())
        next(scroll)
        syncActions()
    }

    @RequiresEdt
    fun sync(values: List<String>) {
        if (model.items != values) model.replaceAll(values)
        syncActions()
    }

    override fun setEnabled(enabled: Boolean) {
        super.setEnabled(enabled)
        add.isEnabled = enabled
        remove.isEnabled = enabled && list.selectedIndices.isNotEmpty()
        list.isEnabled = enabled
        scroll.isEnabled = enabled
        toolbar.isEnabled = enabled
        syncActions()
    }

    private fun add() {
        if (!isEnabled) return
        val value = input()?.trim().orEmpty()
        if (value.isBlank()) return
        val values = model.items.toMutableList()
        val idx = values.indexOf(value).takeIf { it >= 0 } ?: run {
            values += value
            model.replaceAll(values)
            change(values)
            values.lastIndex
        }
        list.selectedIndex = idx
        ScrollingUtil.ensureIndexIsVisible(list, idx, 0)
        syncActions()
    }

    private fun edit(idx: Int) {
        if (!isEnabled || idx < 0 || idx >= model.size) return
        val value = editor(model.getElementAt(idx))?.trim().orEmpty()
        if (value.isBlank()) return
        val values = model.items.toMutableList()
        val found = values.indexOf(value)
        val next = if (found >= 0 && found != idx) {
            values.removeAt(idx)
            if (found > idx) found - 1 else found
        } else {
            values[idx] = value
            idx
        }
        model.replaceAll(values)
        change(values)
        list.selectedIndex = next
        ScrollingUtil.ensureIndexIsVisible(list, next, 0)
        syncActions()
    }

    private fun remove() {
        val indices = list.selectedIndices.filter { it >= 0 && it < model.size }
        if (!isEnabled || indices.isEmpty()) return
        val values = model.items.toMutableList()
        indices.sortedDescending().forEach(values::removeAt)
        model.replaceAll(values)
        val next = indices.minOrNull()?.coerceAtMost(values.lastIndex) ?: -1
        if (next >= 0) list.selectedIndex = next else list.clearSelection()
        change(values)
        syncActions()
    }

    private fun syncActions() {
        add.isEnabled = isEnabled
        remove.isEnabled = isEnabled && list.selectedIndices.isNotEmpty()
    }

    private class PatternRenderer : DefaultListCellRenderer() {
        override fun getListCellRendererComponent(
            list: JList<*>?,
            value: Any?,
            index: Int,
            selected: Boolean,
            focus: Boolean,
        ): java.awt.Component {
            val comp = super.getListCellRendererComponent(list, value, index, selected, focus) as JComponent
            comp.border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())
            return comp
        }
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
