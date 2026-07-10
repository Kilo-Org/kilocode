package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.views.base.BaseQuestionView
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import javax.swing.JPanel

class RevertBanner(
    private val model: SessionModel,
    private val redoAction: () -> Unit,
    private val redoAllAction: () -> Unit,
    focus: (() -> Unit)? = null,
) : BorderLayoutPanel(), SessionView, SessionEditorStyleTarget {
    override val sessionViewKind = SessionView.Kind.Default

    private val card = BaseQuestionView(focus = focus)

    private val body = Stack.vertical(UiStyle.Gap.lg())

    private val files = Stack.vertical(UiStyle.Gap.xs())

    private val rows = LinkedHashMap<String, Row>()

    private val hint = JBLabel(KiloBundle.message("revert.banner.hint")).apply {
        font = JBFont.small()
    }

    private val notice = JBLabel(KiloBundle.message("revert.banner.filesNotRestored")).apply {
        font = JBFont.small()
    }

    init {
        isOpaque = false
        card.setHeaderIcon(AllIcons.Actions.Back, KiloBundle.message("revert.message.rollback"))
        body.next(files).next(hint).next(notice)
        card.setContent(body)
        card.setActions(listOf(
            BaseQuestionView.Action("redo", KiloBundle.message("revert.banner.redo"), primary = false) { redoAction() },
            BaseQuestionView.Action("all", KiloBundle.message("revert.banner.redo.all"), primary = false) { redoAllAction() },
        ))
        add(card, BorderLayout.CENTER)
        applyStyle(SessionEditorStyle.current())
        update()
    }

    @RequiresEdt
    fun update() {
        val revert = model.revert()
        isVisible = revert != null
        if (revert == null) return
        val total = model.revertedCount()
        card.setHeader(KiloBundle.message(if (total == 1) "revert.banner.count.one" else "revert.banner.count.other", total))
        card.setActionVisible("all", total > 1)
        notice.isVisible = revert.snapshot == null
        val keep = model.diff.mapTo(LinkedHashSet()) { it.file }
        rows.entries.removeIf { it.key !in keep }
        val order = model.diff.map { item ->
            val row = rows.getOrPut(item.file) {
                Row(item.file)
            }
            row.update(item.file, item.additions, item.deletions)
            row.panel
        }
        if (files.components.toList() != order) {
            files.removeAll()
            order.forEach { files.next(it) }
        }
        revalidate()
        repaint()
    }

    override fun applyStyle(style: SessionEditorStyle) {
        card.applyStyle(style)
        hint.foreground = UIUtil.getLabelForeground()
        notice.foreground = UIUtil.getContextHelpForeground()
        rows.values.forEach { it.applyStyle() }
    }

    private class Row(file: String) {
        private val label = JBLabel(file)
        private val badge = DiffStatBadge(0, 0)
        val panel: JPanel = Stack.horizontal(UiStyle.Gap.sm())
            .next(label)
            .next(badge)

        init {
            applyStyle()
        }

        fun update(file: String, additions: Int, deletions: Int) {
            if (label.text != file) label.text = file
            badge.update(additions, deletions)
        }

        fun applyStyle() {
            label.foreground = UIUtil.getLabelForeground()
        }
    }
}
