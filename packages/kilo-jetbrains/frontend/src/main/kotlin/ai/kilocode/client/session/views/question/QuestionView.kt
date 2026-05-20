package ai.kilocode.client.session.views.question

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Question
import ai.kilocode.client.session.model.QuestionItem
import ai.kilocode.client.session.model.QuestionOption
import ai.kilocode.client.session.ui.SessionView
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.QuestionReplyDto
import com.intellij.icons.AllIcons
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBRadioButton
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Dimension
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.AbstractButton
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.ButtonGroup
import javax.swing.JButton
import javax.swing.JPanel

/** Question tool form rendered inside the session transcript. */
class QuestionView(
    private val reply: (String, QuestionReplyDto) -> Unit,
    private val reject: (String) -> Unit,
    private val scroll: () -> Unit = {},
) : BorderLayoutPanel(), SessionEditorStyleTarget, SessionView {
    override val sessionViewKind = SessionView.Kind.Default

    private var request: String? = null
    private var question: Question? = null
    private var idx = 0
    private var selections = emptyList<MutableSet<String>>()
    private var style = SessionEditorStyle.current()
    private val texts = mutableListOf<Pair<JBTextArea, Boolean>>()

    private val card = object : BorderLayoutPanel() {
        override fun updateUI() {
            super.updateUI()
            isOpaque = true
            background = SessionUiStyle.View.surface()
            border = SessionUiStyle.View.card()
        }
    }
    private val root = JPanel().apply {
        isOpaque = false
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        border = JBUI.Borders.empty(UiStyle.Gap.lg(), UiStyle.Gap.pad(), UiStyle.Gap.lg(), UiStyle.Gap.pad())
    }
    private val header = JPanel(BorderLayout()).apply {
        isOpaque = false
        border = JBUI.Borders.emptyBottom(UiStyle.Gap.lg())
        alignmentX = Component.LEFT_ALIGNMENT
    }
    private val summary = JBLabel()
    private val nav = JPanel().apply {
        isOpaque = false
        layout = BoxLayout(this, BoxLayout.X_AXIS)
    }
    private val back = HoverIcon().apply {
        val ico = AllIcons.Actions.Back
        icon = ico
        disabledIcon = IconLoader.getDisabledIcon(ico)
        toolTipText = KiloBundle.message("session.question.back")
        addActionListener { goBack() }
    }
    private val fwd = HoverIcon().apply {
        val ico = AllIcons.Actions.Forward
        icon = ico
        disabledIcon = IconLoader.getDisabledIcon(ico)
        toolTipText = KiloBundle.message("session.question.next")
        addActionListener { goForward() }
    }
    private val body = JPanel().apply {
        isOpaque = false
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        alignmentX = Component.LEFT_ALIGNMENT
    }
    private val footer = JPanel(BorderLayout()).apply {
        isOpaque = false
        border = JBUI.Borders.emptyTop(UiStyle.Gap.lg())
        alignmentX = Component.LEFT_ALIGNMENT
    }
    private val dismiss = JButton(KiloBundle.message("session.question.dismiss")).apply {
        addActionListener { doReject() }
    }
    private val right = JPanel().apply {
        isOpaque = false
        layout = BoxLayout(this, BoxLayout.X_AXIS)
    }

    init {
        isOpaque = false
        isVisible = false

        nav.add(back)
        nav.add(fwd)
        header.add(summary, BorderLayout.WEST)
        header.add(nav, BorderLayout.EAST)
        footer.add(dismiss, BorderLayout.WEST)
        footer.add(right, BorderLayout.EAST)
        root.add(header)
        root.add(body)
        root.add(footer)
        card.add(root, BorderLayout.CENTER)
        add(card, BorderLayout.CENTER)
    }

    fun show(q: Question) {
        if (q.items.isEmpty()) {
            hideView()
            return
        }
        request = q.id
        question = q
        idx = 0
        selections = List(q.items.size) { mutableSetOf() }
        isVisible = true
        syncPage()
    }

    fun hideView() {
        request = null
        question = null
        idx = 0
        selections = emptyList()
        texts.clear()
        body.removeAll()
        right.removeAll()
        isVisible = false
        refresh()
    }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        val changed = texts.fold(false) { acc, item -> setFont(item.first, item.second) || acc }
        if (!changed) return
        refresh()
    }

    private fun syncPage() {
        val q = question ?: return
        texts.clear()
        body.removeAll()
        if (review(q)) addReview(q) else addContent(q.items[idx], selections[idx])
        syncHeader(q)
        syncFooter(q)
        syncControls(q)
        refresh()
    }

    private fun syncHeader(q: Question) {
        val total = q.items.size
        val shown = minOf(idx + 1, total)
        summary.text = KiloBundle.message("session.question.summary", shown, total)
        summary.foreground = UiStyle.Colors.weak()
        nav.isVisible = total > 1
    }

    private fun syncFooter(q: Question) {
        right.removeAll()
        if (review(q)) {
            val back = JButton(KiloBundle.message("session.question.back")).apply {
                addActionListener { goBack() }
            }
            val submit = JButton(KiloBundle.message("session.question.submit")).apply {
                putClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY, true)
                addActionListener { doReply() }
            }
            right.add(back)
            right.add(Box.createHorizontalStrut(JBUI.scale(UiStyle.Gap.sm())))
            right.add(submit)
            return
        }

        val label = when {
            direct(q) -> KiloBundle.message("session.question.submit")
            lastItem(q) -> KiloBundle.message("session.question.review")
            else -> KiloBundle.message("session.question.next")
        }
        val button = JButton(label).apply {
            putClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY, direct(q) || lastItem(q))
            addActionListener {
                when {
                    direct(q) -> doReply()
                    lastItem(q) -> goReview()
                    else -> goForward()
                }
            }
        }
        right.add(button)
    }

    private fun syncControls(q: Question) {
        val ready = selections.getOrNull(idx)?.isNotEmpty() == true
        back.isEnabled = idx > 0
        fwd.isEnabled = idx < q.items.size && ready
        for (node in right.components) {
            if (node is JButton && node.text != KiloBundle.message("session.question.back")) {
                node.isEnabled = review(q) || ready
            }
        }
    }

    private fun addContent(item: QuestionItem, set: MutableSet<String>) {
        val title = text(item.question, UiStyle.Colors.fg(), true)
        title.border = JBUI.Borders.emptyBottom(UiStyle.Gap.xs())
        title.alignmentX = Component.LEFT_ALIGNMENT
        body.add(title)

        val hint = text(
            KiloBundle.message(if (item.multiple) "session.question.hint.multi" else "session.question.hint.single"),
            UiStyle.Colors.weak(),
        )
        hint.border = JBUI.Borders.emptyBottom(UiStyle.Gap.lg())
        hint.alignmentX = Component.LEFT_ALIGNMENT
        body.add(hint)

        val opts = optionList(item, set)
        opts.alignmentX = Component.LEFT_ALIGNMENT
        body.add(opts)
    }

    private fun addReview(q: Question) {
        val title = text(KiloBundle.message("session.question.review.title"), UiStyle.Colors.fg(), true)
        title.border = JBUI.Borders.emptyBottom(UiStyle.Gap.lg())
        title.alignmentX = Component.LEFT_ALIGNMENT
        body.add(title)

        for ((i, item) in q.items.withIndex()) {
            val row = reviewRow(item, i)
            row.alignmentX = Component.LEFT_ALIGNMENT
            body.add(row)
        }
    }

    private fun reviewRow(item: QuestionItem, i: Int): JPanel {
        val row = JPanel().apply {
            isOpaque = false
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            border = JBUI.Borders.emptyBottom(UiStyle.Gap.lg())
        }
        val question = text(item.question, UiStyle.Colors.weak())
        question.alignmentX = Component.LEFT_ALIGNMENT
        row.add(question)

        val joined = selections.getOrNull(i)?.joinToString(", ").orEmpty()
        val answer = text(
            joined.ifBlank { KiloBundle.message("session.question.review.notAnswered") },
            UiStyle.Colors.fg(),
            true,
        )
        answer.alignmentX = Component.LEFT_ALIGNMENT
        row.add(answer)
        return row
    }

    private fun optionList(item: QuestionItem, set: MutableSet<String>): JPanel {
        val panel = JPanel().apply {
            isOpaque = false
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
        }
        if (item.multiple) {
            for (opt in item.options) panel.add(checkboxRow(opt, set))
            return panel
        }
        val group = ButtonGroup()
        for (opt in item.options) panel.add(radioRow(opt, set, group))
        return panel
    }

    private fun radioRow(opt: QuestionOption, set: MutableSet<String>, group: ButtonGroup): JPanel {
        val radio = JBRadioButton().apply {
            actionCommand = opt.label
            isSelected = opt.label in set
            isOpaque = false
        }
        group.add(radio)
        radio.addActionListener {
            set.clear()
            set.add(opt.label)
            refreshSelection()
        }
        return optionRow(radio, opt)
    }

    private fun checkboxRow(opt: QuestionOption, set: MutableSet<String>): JPanel {
        val box = JBCheckBox().apply {
            actionCommand = opt.label
            isSelected = opt.label in set
            isOpaque = false
        }
        box.addActionListener {
            if (box.isSelected) set.add(opt.label) else set.remove(opt.label)
            refreshSelection()
        }
        return optionRow(box, opt)
    }

    private fun optionRow(toggle: AbstractButton, opt: QuestionOption): JPanel {
        val row = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.emptyBottom(UiStyle.Gap.lg())
            toolTipText = opt.description.ifBlank { null }
            alignmentX = Component.LEFT_ALIGNMENT
        }
        val press = object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (toggle.isEnabled) toggle.doClick()
            }
        }
        val icon = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.emptyRight(UiStyle.Gap.sm())
            add(toggle, BorderLayout.NORTH)
            addMouseListener(press)
        }
        val col = JPanel().apply {
            isOpaque = false
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            addMouseListener(press)
        }
        val label = text(opt.label, UiStyle.Colors.fg(), true)
        label.alignmentX = Component.LEFT_ALIGNMENT
        label.addMouseListener(press)
        col.add(label)

        if (opt.description.isNotBlank()) {
            val desc = text(opt.description, UiStyle.Colors.weak())
            desc.alignmentX = Component.LEFT_ALIGNMENT
            desc.addMouseListener(press)
            col.add(desc)
        }

        row.addMouseListener(press)
        row.add(icon, BorderLayout.WEST)
        row.add(col, BorderLayout.CENTER)
        return row
    }

    private fun text(value: String, color: Color, bold: Boolean = false): JBTextArea {
        val area = object : JBTextArea(value) {
            override fun getPreferredSize() = withWidth(super.getPreferredSize().height)

            override fun getMaximumSize(): Dimension {
                val size = preferredSize
                return Dimension(Int.MAX_VALUE, size.height)
            }

            private fun withWidth(fallback: Int): Dimension {
                val width = space()
                if (width <= 0) return Dimension(super.getPreferredSize().width, fallback)
                val old = size
                setSize(width, Int.MAX_VALUE)
                val size = super.getPreferredSize()
                setSize(old)
                return Dimension(width, size.height)
            }

            private fun space(): Int {
                var node = parent
                while (node != null) {
                    if (node.width > 0) {
                        val ins = node.insets
                        return (node.width - ins.left - ins.right).coerceAtLeast(0)
                    }
                    node = node.parent
                }
                return width
            }
        }.apply {
            isEditable = false
            isOpaque = false
            isFocusable = false
            caret.isVisible = false
            caret.isSelectionVisible = false
            lineWrap = true
            wrapStyleWord = true
            foreground = color
            border = JBUI.Borders.empty()
        }
        texts.add(area to bold)
        setFont(area, bold)
        return area
    }

    private fun single(q: Question): Boolean = q.items.size == 1 && !q.items[0].multiple

    private fun review(q: Question): Boolean = !single(q) && idx == q.items.size

    private fun lastItem(q: Question): Boolean = idx == q.items.size - 1

    private fun direct(q: Question): Boolean = single(q)

    private fun goBack() {
        if (idx <= 0) return
        idx--
        syncPage()
        scroll()
    }

    private fun goForward() {
        val q = question ?: return
        if (idx >= q.items.size || selections.getOrNull(idx)?.isEmpty() != false) return
        val review = idx == q.items.size - 1 && !direct(q)
        if (review) {
            goReview()
        }
        if (!review) {
            idx++
            syncPage()
            scroll()
        }
    }

    private fun goReview() {
        val q = question ?: return
        if (idx == q.items.size - 1 && selections[idx].isNotEmpty()) {
            idx = q.items.size
            syncPage()
            scroll()
        }
    }

    private fun refreshSelection() {
        question?.let(::syncControls)
        refresh()
        scroll()
    }

    private fun doReply() {
        val id = request ?: return
        if (selections.any { it.isEmpty() }) return
        reply(id, QuestionReplyDto(selections.map { it.toList() }))
        hideView()
    }

    private fun doReject() {
        val id = request ?: return
        reject(id)
        hideView()
    }

    private fun setFont(area: JBTextArea, bold: Boolean): Boolean {
        val font = if (bold) style.boldEditorFont else style.transcriptFont
        if (area.font == font) return false
        area.font = font
        return true
    }

    private fun refresh() {
        revalidate()
        repaint()
        parent?.revalidate()
        parent?.repaint()
    }
}
