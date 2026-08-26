package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Outcome
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
        setOutlined(true)
        setHeaderIcon(AllIcons.General.Error, kind ?: KiloBundle.message("session.error.title"))
        setHeader(KiloBundle.message("session.error.title"), kind)
        error.text = message
        setContentPadding(left = false, right = false)
        setContent(error.scroll)
        isVisible = true
        refresh()
    }

    /**
     * A user-initiated stop is not a failure: it renders as one muted line with no icon and no card
     * outline. Only a model/provider failure gets the error card treatment.
     */
    @RequiresEdt
    fun showOutcome(outcome: Outcome) {
        when (outcome) {
            Outcome.INTERRUPTED -> {
                setOutlined(false)
                setHeaderIcon(null)
                setHeader("", KiloBundle.message("session.outcome.interrupted.note"))
            }

            Outcome.FAILED -> {
                val title = KiloBundle.message("session.outcome.failed.title")
                setOutlined(true)
                setHeaderIcon(AllIcons.General.Error, title)
                setHeader(title, KiloBundle.message("session.outcome.failed.description"))
            }
        }
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
    // The error text is a JViewport view. Never resize it from getPreferredSize():
    // JViewport listens for component-resized events and will feed them back into layout.
    private val area = object : JBTextArea() {
        override fun scrollRectToVisible(aRect: Rectangle) {}
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
            return Dimension(size.width, minOf(size.height, cap))
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
