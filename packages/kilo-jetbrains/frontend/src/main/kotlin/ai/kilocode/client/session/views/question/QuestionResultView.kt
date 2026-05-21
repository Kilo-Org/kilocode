package ai.kilocode.client.session.views.question

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.PartView
import ai.kilocode.client.session.views.ToolView
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Font
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.BoxLayout
import javax.swing.JPanel
import javax.swing.SwingUtilities

class QuestionResultView(tool: Tool) : PartView() {

    override val contentId: String = tool.id

    private var result = QuestionResultParser.parse(tool) ?: QuestionResult(emptyList(), emptyList())
    private var style = SessionEditorStyle.current()
    private val texts = mutableListOf<Pair<JBTextArea, Boolean>>()

    private val root = object : JPanel(BorderLayout()) {
        override fun updateUI() {
            super.updateUI()
            isOpaque = true
            background = SessionUiStyle.View.surface()
            border = SessionUiStyle.View.card()
        }
    }
    private val header = object : JPanel(BorderLayout(JBUI.scale(SessionUiStyle.View.CARD_LAYOUT_GAP), 0)) {
        override fun updateUI() {
            super.updateUI()
            isOpaque = true
            background = SessionUiStyle.View.header()
            border = JBUI.Borders.empty(
                JBUI.scale(SessionUiStyle.View.CARD_VERTICAL_PADDING),
                JBUI.scale(SessionUiStyle.View.CARD_HORIZONTAL_PADDING),
            )
        }
    }
    private val glyph = JBLabel(AllIcons.General.Balloon)
    private val title = JBLabel()
    private val sub = JBLabel().apply { foreground = UiStyle.Colors.weak() }
    private val arrow = JBLabel()
    private val center = JPanel(BorderLayout(JBUI.scale(SessionUiStyle.View.CARD_LAYOUT_GAP), 0)).apply {
        isOpaque = false
    }
    private var pane: JPanel? = null

    private val click = object : MouseAdapter() {
        override fun mouseClicked(e: MouseEvent) { toggle() }
    }

    private val mouse = object : MouseAdapter() {
        override fun mouseEntered(e: MouseEvent) { setHover(true) }
        override fun mouseExited(e: MouseEvent) {
            if (inside(e)) return
            setHover(false)
        }
    }

    init {
        layout = BorderLayout()
        isOpaque = false

        center.add(title, BorderLayout.WEST)
        center.add(sub, BorderLayout.CENTER)
        header.add(glyph, BorderLayout.WEST)
        header.add(center, BorderLayout.CENTER)
        header.add(arrow, BorderLayout.EAST)
        root.add(header, BorderLayout.NORTH)

        listOf(header, glyph, title, sub, arrow, center).forEach {
            it.addMouseListener(click)
            it.addMouseListener(mouse)
            it.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        }
        header.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)

        applyStyle(SessionEditorStyle.current())
        add(root, BorderLayout.CENTER)
        syncLabels()
        syncArrow()
    }

    override fun update(content: Content) {
        if (content !is Tool) return
        val next = QuestionResultParser.parse(content) ?: QuestionResult(emptyList(), emptyList())
        if (next == result) return
        result = next
        syncLabels()
        syncBody()
        refresh()
    }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        val label = setFont(title, style.boldEditorFont) || setFont(sub, style.smallEditorFont)
        val body = texts.fold(false) { acc, item -> setFont(item.first, item.second) || acc }
        if (!label && !body) return
        refresh()
    }

    fun toggle() {
        if (isExpanded()) {
            pane?.let { root.remove(it) }
        } else {
            root.add(body(), BorderLayout.CENTER)
        }
        syncArrow()
        refresh()
    }

    fun isExpanded(): Boolean = pane?.parent === root

    fun labelText(): String = listOf(title.text, sub.text).filter { it.isNotBlank() }.joinToString(" ")

    fun bodyText(): String = result.questions.mapIndexed { i, q ->
        val joined = result.answers.getOrNull(i)?.joinToString(", ").orEmpty()
        listOf(q, joined.ifBlank { KiloBundle.message("session.question.review.notAnswered") }).joinToString("\n")
    }.joinToString("\n")

    fun bodyCreated(): Boolean = pane != null

    fun bodyFonts(): List<Font> = texts.map { it.first.font }

    override fun dumpLabel(): String = "QuestionResultView#$contentId(${labelText()})"

    companion object {
        fun canRender(tool: Tool): Boolean = QuestionResultParser.parse(tool) != null
    }

    private fun body(): JPanel {
        pane?.let { return it }
        val panel = object : JPanel() {
            override fun updateUI() {
                super.updateUI()
                isOpaque = true
                background = SessionUiStyle.View.surface()
                border = JBUI.Borders.empty(
                    JBUI.scale(SessionUiStyle.View.CARD_VERTICAL_PADDING),
                    JBUI.scale(SessionUiStyle.View.CARD_HORIZONTAL_PADDING),
                )
            }
        }.apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
        }
        pane = panel
        syncBody()
        return panel
    }

    private fun syncLabels() {
        title.text = KiloBundle.message("session.question.result.title")
        val count = result.answers.count { it.isNotEmpty() }
        sub.text = KiloBundle.message("session.question.result.answered", count)
        sub.foreground = UiStyle.Colors.weak()
    }

    private fun syncBody() {
        val panel = pane ?: return
        panel.removeAll()
        texts.clear()

        for ((i, q) in result.questions.withIndex()) {
            val row = JPanel().apply {
                isOpaque = false
                layout = BoxLayout(this, BoxLayout.Y_AXIS)
                alignmentX = Component.LEFT_ALIGNMENT
            }
            if (i > 0) row.border = JBUI.Borders.emptyTop(UiStyle.Gap.lg())

            val qText = makeText(q, UiStyle.Colors.weak(), false)
            qText.alignmentX = Component.LEFT_ALIGNMENT
            row.add(qText)

            val joined = result.answers.getOrNull(i)?.joinToString(", ").orEmpty()
            val aText = makeText(
                joined.ifBlank { KiloBundle.message("session.question.review.notAnswered") },
                UiStyle.Colors.fg(),
                true,
            )
            aText.alignmentX = Component.LEFT_ALIGNMENT
            row.add(aText)
            panel.add(row)
        }
    }

    private fun makeText(value: String, color: Color, bold: Boolean): JBTextArea {
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

    private fun syncArrow() {
        arrow.icon = if (isExpanded()) AllIcons.General.ArrowDown else AllIcons.General.ArrowRight
    }

    private fun setHover(value: Boolean) {
        val color = if (value) SessionUiStyle.View.headerHover() else SessionUiStyle.View.header()
        if (header.background?.rgb == color.rgb) return
        header.background = color
        header.repaint()
    }

    private fun inside(e: MouseEvent): Boolean {
        val point = SwingUtilities.convertPoint(e.component, e.point, header)
        return header.contains(point)
    }

    private fun setFont(label: JBLabel, font: Font): Boolean {
        if (label.font == font) return false
        label.font = font
        return true
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
    }
}
