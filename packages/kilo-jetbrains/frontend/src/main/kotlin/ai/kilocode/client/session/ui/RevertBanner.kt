package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionDiffOpener
import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.session.views.base.DialogView
import ai.kilocode.client.session.views.base.PartHeader
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.toolbarButton
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import java.nio.file.Path
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

class RevertBanner(
    private val model: SessionModel,
    private val redoAction: () -> Unit,
    private val redoAllAction: () -> Unit,
    private val cancelAction: () -> Unit,
    focus: (() -> Unit)? = null,
    private var openDiff: SessionDiffOpener = { _, _, _ -> },
    private var sessionId: String? = null,
) : DialogView(focus = focus), SessionView {
    override val sessionViewKind = SessionView.Kind.Default

    companion object {
        /** Cap the reverted-file list to this many rows before scrolling. */
        const val MAX_FILE_ROWS = 10
    }

    private val title = JBLabel()

    private val diff = toolbarButton(
        ToolbarButtonAction(SessionViewIcons.openDiff, KiloBundle.message("session.part.tool.openDiff"), ::openDiffViewer),
    ).apply {
        isEnabled = false
        isVisible = false
    }

    private val header = PartHeader().apply {
        leading(JBLabel(AllIcons.Actions.Back))
        left(title)
        left(PartHeader.centered(diff))
    }

    private val body = Stack.vertical(UiStyle.Gap.lg())

    private val files = Stack.vertical(UiStyle.Gap.xs())

    private val scroll = object : JBScrollPane(
        files,
        ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
        ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED,
    ) {
        override fun getPreferredSize(): Dimension {
            val size = super.getPreferredSize()
            val cap = rowCap()
            return Dimension(size.width, if (cap > 0) minOf(size.height, cap) else size.height)
        }
    }.apply {
        border = JBUI.Borders.empty()
        viewportBorder = JBUI.Borders.empty()
        isOpaque = false
        viewport.isOpaque = false
    }

    private val rows = LinkedHashMap<String, Row>()
    private var progress: RevertProgress? = null

    private val hint = JBLabel(KiloBundle.message("revert.banner.hint")).apply {
        font = JBFont.small()
    }

    private val notice = JBLabel(KiloBundle.message("revert.banner.filesNotRestored")).apply {
        font = JBFont.small()
    }

    init {
        isOpaque = false
        setTopPanel(header)
        body.next(scroll).next(hint).next(notice)
        setContent(body)
        setActions(listOf(
            DialogView.Action("redo", KiloBundle.message("revert.banner.redo"), primary = false) { redoAction() },
            DialogView.Action("all", KiloBundle.message("revert.banner.redo.all"), primary = false) { redoAllAction() },
        ))
        applyStyle(SessionEditorStyle.current())
        update()
    }

    @RequiresEdt
    fun setDiffOpener(openDiff: SessionDiffOpener, sessionId: String?) {
        this.openDiff = openDiff
        this.sessionId = sessionId
    }

    @RequiresEdt
    fun update() {
        val revert = model.revert()
        isVisible = revert != null
        if (revert == null) return
        val total = model.revertedCount()
        title.text = KiloBundle.message(if (total == 1) "revert.banner.count.one" else "revert.banner.count.other", total)
        setActionVisible("all", total > 1)
        notice.isVisible = revert.snapshot == null
        val diffs = resolveDiffs(revert)
        val names = disambiguate(diffs.map { it.file })
        diff.isVisible = diffs.isNotEmpty()
        diff.isEnabled = diffs.isNotEmpty()
        val keep = diffs.mapTo(LinkedHashSet()) { it.file }
        rows.entries.removeIf { it.key !in keep }
        scroll.isVisible = diffs.isNotEmpty()
        val order = diffs.map { item ->
            val row = rows.getOrPut(item.file) {
                Row(item)
            }
            row.update(item, names[item.file] ?: item.file, absolute(item.file))
            row.panel
        }
        if (files.components.toList() != order) {
            files.removeAll()
            order.forEach { files.next(it) }
        }
        revalidate()
        repaint()
    }

    @RequiresEdt
    fun setReverting(state: SessionState) {
        val busy = state is SessionState.Reverting
        if (busy) {
            setActionEnabled("redo", false)
            setActionEnabled("all", false)
            val node = progress ?: RevertProgress(cancelAction).also {
                it.applyStyle(SessionEditorStyle.current())
                progress = it
            }
            node.setText(state.text)
            setActionLeft(node)
            return
        }
        setActionLeft(null)
        setActionEnabled("redo", true)
        setActionEnabled("all", true)
    }

    override fun applyStyle(style: SessionEditorStyle) {
        super.applyStyle(style)
        title.font = style.headerFont
        title.foreground = SessionUiStyle.Colors.foreground()
        progress?.applyStyle(style)
        hint.foreground = UIUtil.getLabelForeground()
        notice.foreground = SessionUiStyle.Text.Secondary.foreground()
        rows.values.forEach { it.applyStyle() }
    }

    /**
     * The rolled-back diff to render. Prefer the snapshot diff the CLI attaches to the revert; fall
     * back to the session's current file diff when the pinned CLI doesn't provide it. Empty when no
     * snapshot exists (files were not restored, so there is nothing to diff).
     */
    private fun resolveDiffs(revert: ai.kilocode.rpc.dto.SessionRevertDto): List<DiffFileDto> =
        if (revert.snapshot == null) emptyList() else revert.diffs.ifEmpty { model.diff }

    private fun openDiffViewer() {
        val revert = model.revert() ?: return
        val diffs = resolveDiffs(revert)
        if (diffs.isEmpty()) return
        openDiff(diffs, KiloBundle.message("revert.banner.openDiff.title"), "revert:${sessionId ?: "pending"}:${revert.messageID}")
    }

    private fun absolute(file: String): String {
        val path = runCatching { Path.of(file) }.getOrNull() ?: return file
        if (path.isAbsolute) return path.normalize().toString()
        val root = model.session?.directory
            ?.takeIf { it.isNotBlank() }
            ?.let { runCatching { Path.of(it) }.getOrNull() }
        return root?.resolve(path)?.normalize()?.toString() ?: file
    }

    /** Height that fits at most [MAX_FILE_ROWS] rows, or 0 when the list is short enough to show in full. */
    private fun rowCap(): Int {
        val comps = files.components
        if (comps.size <= MAX_FILE_ROWS) return 0
        val gap = UiStyle.Gap.xs()
        return (0 until MAX_FILE_ROWS).sumOf { comps[it].preferredSize.height } + gap * (MAX_FILE_ROWS - 1)
    }

    private class Row(item: DiffFileDto) {
        private val label = JBLabel(item.file).apply {
            toolTipText = item.file
        }
        private val badge = DiffStatBadge(item.additions, item.deletions)
        val panel: JPanel = Stack.horizontal(UiStyle.Gap.sm())
            .next(label)
            .next(badge)

        init {
            applyStyle()
            tip(item.file)
        }

        fun update(item: DiffFileDto, text: String, tip: String) {
            if (label.text != text) label.text = text
            if (panel.toolTipText != tip) tip(tip)
            badge.update(item.additions, item.deletions)
        }

        fun applyStyle() {
            label.foreground = UIUtil.getLabelForeground()
        }

        private fun tip(text: String) {
            tip(panel, text)
        }

        private fun tip(node: Component, text: String) {
            if (node is JComponent && node.toolTipText != text) node.toolTipText = text
            if (node is Container) node.components.forEach { tip(it, text) }
        }
    }
}

internal fun disambiguate(paths: List<String>): Map<String, String> {
    val parts = paths.associateWith { split(it) }
    return paths.groupBy { parts[it]?.lastOrNull().orEmpty() }.values.flatMap { group ->
        if (group.size == 1) return@flatMap listOf(group.first() to (parts[group.first()]?.lastOrNull() ?: group.first()))
        val depth = (1..(group.maxOf { parts[it]?.size ?: 1 })).firstOrNull { count ->
            group.map { suffix(parts[it].orEmpty(), count) }.toSet().size == group.size
        } ?: group.maxOf { parts[it]?.size ?: 1 }
        group.map { it to suffix(parts[it].orEmpty(), depth) }
    }.toMap()
}

private fun split(path: String): List<String> = path.split('/', '\\').filter { it.isNotEmpty() }

private fun suffix(parts: List<String>, depth: Int): String = parts.takeLast(depth).joinToString("/")
