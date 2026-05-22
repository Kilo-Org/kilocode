package ai.kilocode.client.session.views.base

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.RoundedContentPanel
import ai.kilocode.client.ui.UiStyle
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextArea
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Dimension
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.Icon
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * Shared rounded background panel for session inline views that follow the
 * question-view visual style: a card surface with a header text area, a
 * description text area, an optional component above the header, and slots
 * for view-specific content and a base-owned action-button footer.
 *
 * Both [ai.kilocode.client.session.views.question.QuestionView] and
 * [ai.kilocode.client.session.views.LoginRequiredView] use this as their
 * outer card shell so they share the same background, padding, and text
 * styling without duplicating the setup.
 *
 * The column always contains (in order): optional top, header row with the
 * header text, description text, optional content, optional action footer.
 * Call [setTopPanel], [setHeaderIcon], [setHeader], [setDescription],
 * [setContent], [setActions], or [setActionEnabled] to configure the card.
 */
class BaseQuestionView : RoundedContentPanel(
    UiStyle.Gap.lg(),
    UiStyle.Gap.pad(),
), SessionEditorStyleTarget {

    // ---- Action descriptor ----

    /**
     * Describes a button to render in the card's action footer.
     *
     * @param id     Stable identifier so [setActionEnabled] can target a specific button.
     * @param text   Button label shown to the user.
     * @param primary True → rendered as the platform default (accent) button.
     * @param enabled Initial enabled state.
     * @param handler Called when the button is clicked.
     */
    data class Action(
        val id: String,
        val text: String,
        val primary: Boolean,
        val enabled: Boolean = true,
        val handler: () -> Unit,
    )

    // ---- private state ----

    private var style = SessionEditorStyle.current()

    private val tracked = mutableListOf<Pair<JBTextArea, Boolean>>()

    private val header = object : JPanel(BorderLayout(UiStyle.Gap.sm(), 0)) {
        override fun getMaximumSize(): Dimension {
            val size = preferredSize
            return Dimension(Int.MAX_VALUE, size.height)
        }
    }.apply {
        isOpaque = false
        alignmentX = Component.LEFT_ALIGNMENT
    }

    private val icon = JBLabel().apply {
        border = JBUI.Borders.emptyRight(UiStyle.Gap.sm())
        isVisible = false
    }

    private val headerText: JBTextArea = makeText("", UiStyle.Colors.fg(), bold = true)
    private val descriptionText: JBTextArea = makeText("", UiStyle.Colors.weak(), bold = false)

    private var top: JComponent? = null
    private var content: JComponent? = null

    // action buttons keyed by id for enabled-state updates
    private val actionButtons = mutableMapOf<String, JButton>()
    private var actionFooter: JComponent? = null

    private val col = JPanel().apply {
        isOpaque = false
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
    }

    init {
        header.add(icon, BorderLayout.WEST)
        header.add(headerText, BorderLayout.CENTER)
        addToCenter(col)
        rebuildCol()
    }

    // ---- public text API ----

    /**
     * Set the header text and, optionally, the description text in one call.
     * Pass `null` or an empty string for [description] to hide the description row.
     */
    @RequiresEdt
    fun setHeader(text: String, description: String? = null) {
        headerText.text = text
        setDescription(description)
    }

    /**
     * Set or clear the description text below the header.
     * The description row is visible only when [text] is non-null and non-blank.
     */
    @RequiresEdt
    fun setDescription(text: String?) {
        descriptionText.text = text ?: ""
        descriptionText.isVisible = !text.isNullOrBlank()
    }

    // ---- public slot API ----

    /**
     * Optional panel rendered above the header row (e.g. summary + nav in
     * [ai.kilocode.client.session.views.question.QuestionView]).  When set,
     * it is inserted as the first child of the column; calling with `null`
     * removes a previously set component.
     */
    @RequiresEdt
    fun setTopPanel(top: JComponent?) {
        this.top = top
        rebuildCol()
    }

    /**
     * Optional icon rendered at the left edge of the header row.
     * Pass `null` to remove the icon while keeping header text alignment stable.
     */
    @RequiresEdt
    fun setHeaderIcon(icon: Icon?, tooltip: String? = null) {
        this.icon.icon = icon
        this.icon.toolTipText = tooltip
        this.icon.isVisible = icon != null
        this.icon.revalidate()
        this.icon.repaint()
    }

    /**
     * Replace the view-specific content slot that comes after the header/description.
     * Pass `null` to remove the current content.
     */
    @RequiresEdt
    fun setContent(content: JComponent?) {
        this.content = content
        rebuildCol()
    }

    /**
     * Configure the action buttons shown in the card's right-aligned footer.
     *
     * All buttons are created fresh; stable button references across calls can be
     * maintained by the caller through [setActionEnabled] using the [Action.id].
     * Pass an empty list to remove the footer entirely.
     */
    @RequiresEdt
    fun setActions(actions: List<Action>) {
        actionButtons.clear()
        actionFooter = if (actions.isEmpty()) {
            null
        } else {
            val row = JPanel().apply {
                isOpaque = false
                layout = BoxLayout(this, BoxLayout.X_AXIS)
                alignmentX = Component.LEFT_ALIGNMENT
            }
            for ((idx, action) in actions.withIndex()) {
                if (idx > 0) row.add(Box.createHorizontalStrut(UiStyle.Gap.sm()))
                val btn = makeButton(action.text, action.primary).apply {
                    isEnabled = action.enabled
                    addActionListener { action.handler() }
                }
                actionButtons[action.id] = btn
                row.add(btn)
            }
            val footer = JPanel(BorderLayout()).apply {
                isOpaque = false
                alignmentX = Component.LEFT_ALIGNMENT
            }
            footer.add(row, BorderLayout.EAST)
            footer
        }
        rebuildCol()
    }

    /**
     * Enable or disable a specific action button identified by [id].
     * No-ops if the id is not found (e.g. before [setActions] is called).
     */
    @RequiresEdt
    fun setActionEnabled(id: String, enabled: Boolean) {
        actionButtons[id]?.isEnabled = enabled
    }

    // ---- SessionEditorStyleTarget ----

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        for ((area, bold) in tracked) applyFont(area, bold)
    }

    // ---- contentColor override ----

    override fun contentColor(): Color = SessionUiStyle.View.surface()

    override fun outlineColor(): Color = SessionUiStyle.View.line()

    // ---- internal test helpers ----

    /** Returns the font currently applied to the header text area. For tests only. */
    internal fun headerFont() = headerText.font

    /** Returns the font currently applied to the description text area. For tests only. */
    internal fun descriptionFont() = descriptionText.font

    /** Returns all action buttons as generic JButton, keyed by their action id. For tests only. */
    internal fun actionButtonsForTest(): Map<String, JButton> = actionButtons.toMap()

    // ---- private helpers ----

    private fun rebuildCol() {
        col.removeAll()
        top?.let { col.add(it) }
        col.add(header)
        col.add(descriptionText)
        content?.let {
            col.add(gap())
            col.add(it)
        }
        actionFooter?.let {
            col.add(gap())
            col.add(it)
        }
        col.revalidate()
        col.repaint()
    }

    private fun gap(): Component = Box.createVerticalStrut(UiStyle.Gap.lg()).apply {
        setAlignmentX(Component.LEFT_ALIGNMENT)
    }

    private fun makeText(value: String, color: Color, bold: Boolean): JBTextArea {
        val area = object : JBTextArea(value) {
            override fun getPreferredSize() = withWidth(super.getPreferredSize().height)

            override fun getMaximumSize(): Dimension {
                val size = preferredSize
                return Dimension(Int.MAX_VALUE, size.height)
            }

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
            caret.isSelectionVisible = false
            lineWrap = true
            wrapStyleWord = true
            foreground = color
            border = JBUI.Borders.empty()
            alignmentX = Component.LEFT_ALIGNMENT
        }
        tracked.add(area to bold)
        applyFont(area, bold)
        return area
    }

    private fun applyFont(area: JBTextArea, bold: Boolean) {
        val font = if (bold) style.headerFont else style.hintFont
        if (area.font != font) area.font = font
    }

    private fun makeButton(text: String, primary: Boolean): JButton {
        val btn = object : JButton(text) {
            init {
                if (primary) putClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY, true)
                syncBackground()
            }

            override fun updateUI() {
                super.updateUI()
                syncBackground()
            }

            private fun syncBackground() {
                background = SessionUiStyle.View.surface()
            }
        }
        return btn
    }
}
