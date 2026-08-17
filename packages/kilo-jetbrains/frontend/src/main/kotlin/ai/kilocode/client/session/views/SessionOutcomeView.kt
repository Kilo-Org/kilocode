package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Outcome
import ai.kilocode.client.session.model.OutcomeTone
import ai.kilocode.client.session.ui.SessionView
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.DialogView
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Dimension
import java.awt.Rectangle
import javax.swing.ScrollPaneConstants

class SessionOutcomeView(
    selection: SessionSelection? = null,
    focus: (() -> Unit)? = null,
) : DialogView(selection, focus), SessionView {

    override val sessionViewKind = SessionView.Kind.Default

    private val error = ErrorBody()

    init {
        isOpaque = false
        isVisible = false
        setActions(emptyList())
    }

    @RequiresEdt
    fun showError(message: String, kind: String?) {
        setHeaderIcon(AllIcons.General.Error, kind ?: KiloBundle.message("session.error.title"))
        setHeader(KiloBundle.message("session.error.title"))
        error.text = message
        setContentPadding(left = false, right = false)
        setContent(error.scroll)
        isVisible = true
        refresh()
    }

    @RequiresEdt
    fun showOutcome(outcome: Outcome, tone: OutcomeTone) {
        val title = when (outcome) {
            Outcome.INTERRUPTED -> KiloBundle.message("session.outcome.interrupted.title")
            Outcome.FAILED -> KiloBundle.message("session.outcome.failed.title")
        }
        val desc = when (outcome) {
            Outcome.INTERRUPTED -> KiloBundle.message("session.outcome.interrupted.description")
            Outcome.FAILED -> KiloBundle.message("session.outcome.failed.description")
        }
        val icon = when (tone) {
            OutcomeTone.WARNING -> AllIcons.General.Warning
            OutcomeTone.CRITICAL -> AllIcons.General.Error
        }
        setHeaderIcon(icon, title)
        setHeader(title, desc)
        setContentPadding()
        setContent(null)
        isVisible = true
        refresh()
    }

    @RequiresEdt
    fun hideView() {
        if (!isVisible) return
        isVisible = false
        refresh()
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        super.applyStyle(style)
        error.applyStyle(style)
    }
}

private class ErrorBody {
    private val area = object : JBTextArea() {
        override fun getPreferredSize() = withWidth(super.getPreferredSize().height)

        override fun scrollRectToVisible(aRect: Rectangle) {}

        private fun withWidth(fallback: Int): Dimension {
            val w = availableWidth()
            if (w <= 0) return Dimension(super.getPreferredSize().width, fallback)
            val old = size
            setSize(w, Int.MAX_VALUE)
            val ps = super.getPreferredSize()
            setSize(old)
            return Dimension(w, ps.height)
        }

        private fun availableWidth(): Int {
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
        caret.isSelectionVisible = true
        lineWrap = true
        wrapStyleWord = true
        border = JBUI.Borders.empty(0, UiStyle.Gap.pad())
    }

    val scroll = object : JBScrollPane(area) {
        override fun getPreferredSize(): Dimension {
            val size = super.getPreferredSize()
            val ins = viewportBorder?.getBorderInsets(this) ?: JBUI.emptyInsets()
            val chrome = insets.top + insets.bottom + ins.top + ins.bottom + area.insets.top + area.insets.bottom
            val cap = area.getFontMetrics(area.font).height * SessionUiStyle.View.Outcome.ERROR_LINES + chrome
            val height = minOf(area.preferredSize.height + chrome, cap)
            return Dimension(size.width, height)
        }

        override fun updateUI() {
            super.updateUI()
            border = JBUI.Borders.empty()
            viewportBorder = JBUI.Borders.empty()
            viewport?.isOpaque = false
        }
    }.apply {
        isOpaque = false
        viewport.isOpaque = false
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
    }

    init {
        applyStyle(SessionEditorStyle.current())
    }

    var text: String
        @RequiresEdt
        get() = area.text
        @RequiresEdt
        set(value) {
            if (area.text == value) return
            area.text = value
            area.caretPosition = 0
            scroll.revalidate()
            scroll.repaint()
        }

    @RequiresEdt
    fun applyStyle(style: SessionEditorStyle) {
        area.font = style.transcriptFont
        area.foreground = SessionUiStyle.Colors.foreground()
    }
}
