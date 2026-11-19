package ai.kilocode.client.session.views.question

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.session.views.base.AbstractSessionPartView
import ai.kilocode.client.session.views.base.PartHeader
import ai.kilocode.client.session.views.tool.ApprovalReasonTarget
import ai.kilocode.client.session.views.tool.ToolApprovalFooter
import ai.kilocode.client.session.views.tool.approvalReasonsVisible
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Component
import java.awt.Dimension
import java.awt.Font
import java.awt.Rectangle
import javax.swing.BoxLayout
import javax.swing.JComponent
import javax.swing.JPanel

class QuestionResultView(
    tool: Tool,
    selection: SessionSelection? = null,
    private val parts: QuestionParts = questionParts(selection),
    private val footer: ToolApprovalFooter = ToolApprovalFooter(),
) : AbstractSessionPartView(parts.header, { parts.body }, { footer }), ApprovalReasonTarget {

    override val contentId: String = tool.id

    private var result = parse(tool)
    private var item = tool
    private var style = SessionEditorStyle.current()

    init {
        applyStyle(style)
        syncLabels()
        syncApprovalReason(approvalReasonsVisible())
    }

    override fun expand(): Boolean {
        val changed = super.expand()
        if (!changed) return false
        parts.body.set(result.questions, result.answers)
        return true
    }

    override fun update(content: Content) {
        if (content !is Tool) return
        item = content
        val next = parse(content)
        if (next == result) {
            if (syncApprovalReason(approvalReasonsVisible())) refresh()
            return
        }
        result = next
        syncLabels()
        if (isExpanded()) parts.body.set(result.questions, result.answers)
        syncApprovalReason(approvalReasonsVisible())
        refresh()
    }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        var changed = setFont(parts.title, style.boldFont)
        changed = setFont(parts.sub, style.smallFont) || changed
        changed = parts.body.applyStyle(style) || changed
        changed = footer.applyStyle(style) || changed
        if (changed) refresh()
    }

    override fun syncApprovalReason(visible: Boolean): Boolean {
        val changed = footer.update(item, visible)
        if (changed) refresh()
        return changed
    }

    fun labelText(): String = listOf(parts.title.text, parts.sub.text).filter { it.isNotBlank() }.joinToString(" ")

    fun bodyText(): String = result.questions.mapIndexed { i, q ->
        val joined = result.answers.getOrNull(i)?.joinToString(", ").orEmpty()
        listOf(q, joined.ifBlank { KiloBundle.message("session.question.review.notAnswered") }).joinToString("\n")
    }.joinToString("\n")

    fun bodyCreated(): Boolean = hasBody()

    fun bodyFonts(): List<Font> = parts.body.fonts()

    fun titleFont(): Font = parts.title.font

    fun subFont(): Font = parts.sub.font

    override fun dispose() = parts.body.dispose()

    override fun dumpLabel(): String = "QuestionResultView#$contentId(${labelText()})"

    private fun syncLabels() {
        parts.title.text = KiloBundle.message("session.question.result.title")
        val count = result.answers.count { it.isNotEmpty() }
        parts.sub.text = KiloBundle.message("session.question.result.answered", count)
        parts.sub.foreground = SessionUiStyle.Text.Secondary.foreground()
    }

    private fun setFont(label: JBLabel, font: Font): Boolean {
        if (label.font == font) return false
        label.font = font
        return true
    }

    companion object {
        fun canRender(tool: Tool): Boolean = QuestionResultParser.parse(tool) != null
    }
}

class QuestionParts(
    val header: PartHeader,
    val glyph: JBLabel,
    val title: JBLabel,
    val sub: JBLabel,
    val body: QuestionResultBody,
)

private fun questionParts(selection: SessionSelection?): QuestionParts {
    val glyph = JBLabel(SessionViewIcons.bubble)
    val title = JBLabel()
    val sub = JBLabel().apply { foreground = SessionUiStyle.Text.Secondary.foreground() }
    val header = PartHeader().apply {
        leading(glyph)
        left(title)
        titleGap()
        left(sub)
    }
    return QuestionParts(header, glyph, title, sub, QuestionResultBody(selection))
}

private fun parse(tool: Tool) = QuestionResultParser.parse(tool) ?: QuestionResult(emptyList(), emptyList())

/** Lazy body for [QuestionResultView]: a transparent column of question/answer text areas. */
class QuestionResultBody(private val selection: SessionSelection?) : JPanel() {

    private var questions: List<String> = emptyList()
    private var answers: List<List<String>> = emptyList()
    private var style = SessionEditorStyle.current()
    private val texts = mutableListOf<Pair<JBTextArea, Boolean>>()
    private val regs = mutableListOf<Disposable>()

    init {
        isOpaque = false
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        // Transparent answers body: the base separates it from the header with the standard gap, so
        // only content padding remains — no separator line.
        border = JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.Layout.VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING),
        )
    }

    fun set(questions: List<String>, answers: List<List<String>>) {
        this.questions = questions
        this.answers = answers
        rebuild()
    }

    fun applyStyle(style: SessionEditorStyle): Boolean {
        this.style = style
        return texts.fold(false) { acc, item -> setFont(item.first, item.second) || acc }
    }

    fun fonts(): List<Font> = texts.map { it.first.font }

    fun dispose() {
        disposeRegs()
        texts.clear()
    }

    private fun rebuild() {
        removeAll()
        disposeRegs()
        texts.clear()
        for ((i, q) in questions.withIndex()) {
            val row = JPanel().apply {
                isOpaque = false
                layout = BoxLayout(this, BoxLayout.Y_AXIS)
                alignmentX = Component.LEFT_ALIGNMENT
            }
            if (i > 0) row.border = JBUI.Borders.emptyTop(UiStyle.Gap.lg())

            val qText = makeText(q, SessionUiStyle.Text.Secondary.foreground(), false)
            qText.alignmentX = Component.LEFT_ALIGNMENT
            qText.border = JBUI.Borders.emptyBottom(UiStyle.Gap.xs())
            row.add(qText)

            val joined = answers.getOrNull(i)?.joinToString(", ").orEmpty()
            val aText = makeText(
                joined.ifBlank { KiloBundle.message("session.question.review.notAnswered") },
                SessionUiStyle.Colors.foreground(),
                true,
            )
            aText.alignmentX = Component.LEFT_ALIGNMENT
            row.add(aText)
            add(row)
        }
        revalidate()
        repaint()
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

    private fun setFont(area: JBTextArea, bold: Boolean): Boolean {
        val font = if (bold) style.boldFont else style.regularFont
        if (area.font == font) return false
        area.font = font
        return true
    }
}
