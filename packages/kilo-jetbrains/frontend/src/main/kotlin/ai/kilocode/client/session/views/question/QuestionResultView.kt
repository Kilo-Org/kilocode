package ai.kilocode.client.session.views.question

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.session.views.tool.ToolView
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Font
import java.awt.Rectangle
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.BoxLayout
import javax.swing.JPanel
import javax.swing.SwingUtilities

class QuestionResultView(tool: Tool, private val selection: SessionSelection? = null) : PartView() {

    override val contentId: String = tool.id

    private var result = QuestionResultParser.parse(tool) ?: QuestionResult(emptyList(), emptyList())
    private var style = SessionEditorStyle.current()
    private val texts = mutableListOf<Pair<JBTextArea, Boolean>>()
    private val regs = mutableListOf<Disposable>()

    private val root = object : JPanel(BorderLayout()) {
        override fun updateUI() {
            super.updateUI()
            isOpaque = true
            background = SessionUiStyle.View.Surface.bgColor()
            border = JBUI.Borders.empty(1)
        }
    }
    private val header = object : JPanel(BorderLayout(JBUI.scale(SessionUiStyle.View.Layout.GAP), 0)) {
        override fun updateUI() {
            super.updateUI()
            isOpaque = true
            background = SessionUiStyle.View.Surface.headerBgColor()
            border = JBUI.Borders.empty(
                JBUI.scale(SessionUiStyle.View.Layout.VERTICAL_PADDING),
                JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING),
            )
        }
    }
    private val glyph = JBLabel(SessionViewIcons.bubble)
    private val title = JBLabel()
    private val sub = JBLabel().apply { foreground = UiStyle.Colors.weak() }
    private val arrow = JBLabel()
    private val center = JPanel(BorderLayout(JBUI.scale(SessionUiStyle.View.Layout.GAP), 0)).apply {
        isOpaque = false
    }
    private var pane: JPanel? = null

    private val click = object : MouseAdapter() {
        override fun mouseClicked(e: MouseEvent) { toggle() }
    }

    private val mouse = object : MouseAdapter() {
        override fun mouseEntered(e: MouseEvent) { setHovered(true) }
        override fun mouseExited(e: MouseEvent) {
            if (inside(e)) return
            setHovered(false)
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
        syncBorder()
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
        val t = setFont(title, style.boldFont)
        val s = setFont(sub, style.smallFont)
        val label = t || s
        val body = texts.fold(false) { acc, item -> setFont(item.first, item.second) || acc }
        if (!label && !body) return
        refresh()
    }

    fun toggle() {
        resize?.invoke(this) { toggleBody() } ?: toggleBody()
        syncArrow()
        refresh()
    }

    private fun toggleBody() {
        if (isExpanded()) {
            pane?.let { root.remove(it) }
        } else {
            root.add(body(), BorderLayout.CENTER)
        }
        syncBorder()
    }

    fun isExpanded(): Boolean = pane?.parent === root

    fun labelText(): String = listOf(title.text, sub.text).filter { it.isNotBlank() }.joinToString(" ")

    fun bodyText(): String = result.questions.mapIndexed { i, q ->
        val joined = result.answers.getOrNull(i)?.joinToString(", ").orEmpty()
        listOf(q, joined.ifBlank { KiloBundle.message("session.question.review.notAnswered") }).joinToString("\n")
    }.joinToString("\n")

    fun bodyCreated(): Boolean = pane != null

    fun bodyFonts(): List<Font> = texts.map { it.first.font }

    fun titleFont(): Font = title.font
    fun subFont(): Font = sub.font

    override fun dispose() {
        disposeRegs()
        texts.clear()
    }

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
                background = SessionUiStyle.View.Surface.bgColor()
                border = JBUI.Borders.compound(
                    JBUI.Borders.customLine(
                        SessionUiStyle.View.Outline.brightColor(),
                        SessionUiStyle.View.Outline.width(),
                        0,
                        0,
                        0,
                    ),
                    JBUI.Borders.empty(
                        JBUI.scale(SessionUiStyle.View.Layout.VERTICAL_PADDING),
                        JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING),
                    ),
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
        disposeRegs()
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

            override fun scrollRectToVisible(aRect: Rectangle) {}

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
        selection?.register(area)?.let(regs::add)
        setFont(area, bold)
        return area
    }

    private fun disposeRegs() {
        regs.forEach(Disposer::dispose)
        regs.clear()
    }

    private fun syncArrow() {
        arrow.icon = if (isExpanded()) SessionViewIcons.chevronExpanded else SessionViewIcons.chevronCollapsed
    }

    override fun setHovered(value: Boolean) {
        hover?.invoke(this, value)
        val color =
            if (value) SessionUiStyle.View.Surface.headerHoverBgColor() else SessionUiStyle.View.Surface.headerBgColor()
        if (header.background?.rgb != color.rgb) {
            header.background = color
            header.repaint()
        }
    }

    private fun syncBorder() {
        if (isExpanded()) {
            root.border = JBUI.Borders.customLine(
                SessionUiStyle.View.Outline.brightColor(),
                SessionUiStyle.View.Outline.width(),
            )
            return
        }
        root.border = JBUI.Borders.empty(1)
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
        val font = if (bold) style.boldFont else style.regularFont
        if (area.font == font) return false
        area.font = font
        return true
    }

    private fun refresh() {
        revalidate()
        repaint()
    }
}
