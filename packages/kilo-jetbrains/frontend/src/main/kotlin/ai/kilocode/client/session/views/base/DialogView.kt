package ai.kilocode.client.session.views.base

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.RoundedContentPanel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextArea
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Dimension
import java.awt.Rectangle
import javax.swing.JButton
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * Shared rounded background panel for session inline views that follow the
 * question-view visual style: a card surface with a header text area, a
 * description text area, an optional component above the header, and slots
 * for view-specific content and a base-owned action-button footer.
 *
 * Dialog-style views extend this so they share the same background, padding,
 * header, content slot, action footer, and text styling without duplicating
 * the setup.
 *
 * The root uses BorderLayout regions: optional top and header in north,
 * optional view content in center, and optional action controls in south.
 * Call [setTopPanel], [setHeaderIcon], [setHeader], [setDescription],
 * [setContent], [setActions], or [setActionEnabled] to configure the card.
 */
open class DialogView(
    private val selection: SessionSelection? = null,
    private val focus: (() -> Unit)? = null,
    // Insets are owned by syncInsets(); the super border is a placeholder it overwrites.
) : RoundedContentPanel(0, 0), SessionEditorStyleTarget {

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

    private val north = Stack.vertical()

    private val text = Stack.vertical()

    private val header = object : JPanel(BorderLayout(UiStyle.Gap.md(), 0)) {
        override fun getMaximumSize(): Dimension {
            val size = preferredSize
            return Dimension(Int.MAX_VALUE, size.height)
        }
    }.apply {
        isOpaque = false
    }

    private val icon = JBLabel().apply {
        horizontalAlignment = JBLabel.CENTER
        verticalAlignment = JBLabel.CENTER
        isVisible = false
    }

    // Both rows start blank, so both start hidden; setHeader/setDescription drive visibility from text.
    private val headerText: JBTextArea = makeText("", SessionUiStyle.Colors.foreground(), bold = true).apply {
        isVisible = false
    }
    private val descriptionText: JBTextArea = makeText("", SessionUiStyle.Text.Secondary.foreground(), bold = false).apply {
        isVisible = false
    }

    private var top: JComponent? = null
    private var content: JComponent? = null
    private var actionLeft: JComponent? = null

    // Top inset value used when top padding is on; QuestionView sets a non-standard step here.
    private var topInset = UiStyle.Gap.pad()
    // Header→content gap in the north stack.
    private var gap = UiStyle.Gap.lg()

    // Which edges keep the standard dialog padding around the content.
    private var padTop = true
    private var padLeft = true
    private var padRight = true
    private var padBottom = true
    private var outlined = true

    // action buttons keyed by id for retained updates
    private val actionButtons = mutableMapOf<String, JButton>()
    private val actionHandlers = mutableMapOf<String, () -> Unit>()
    private val actionOrder = mutableListOf<String>()

    private val mainActions = Stack.horizontal(gap = UiStyle.Gap.sm())

    private val sideActions = Stack.horizontal()

    private val footer = JPanel(BorderLayout()).apply {
        isOpaque = false
    }

    init {
        text.next(headerText).next(descriptionText)
        header.add(text, BorderLayout.CENTER)
        syncInsets()
        syncNorth()
        add(north, BorderLayout.NORTH)
    }

    // ---- public text API ----

    /**
     * Set the header text and, optionally, the description text in one call.
     * Pass `null` or an empty string for [description] to hide the description row.
     */
    @RequiresEdt
    fun setHeader(text: String, description: String? = null) {
        headerText.text = text
        headerText.isVisible = text.isNotBlank()
        setDescription(description)
        syncNorth()
    }

    /**
     * Set or clear the description text below the header.
     * The description row is visible only when [text] is non-null and non-blank.
     */
    @RequiresEdt
    fun setDescription(text: String?) {
        descriptionText.text = text ?: ""
        descriptionText.isVisible = !text.isNullOrBlank()
        syncNorth()
    }

    // ---- public slot API ----

    /**
     * Optional panel rendered above the header row (e.g. summary + nav in
     * [ai.kilocode.client.session.views.question.QuestionView]). Calling with
     * `null` removes a previously set component.
     */
    @RequiresEdt
    fun setTopPanel(top: JComponent?) {
        this.top = top
        syncNorth()
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
        val attached = this.icon.parent === header
        if (icon != null && !attached) header.add(this.icon, BorderLayout.WEST)
        if (icon == null && attached) header.remove(this.icon)
        this.icon.revalidate()
        this.icon.repaint()
        syncNorth()
    }

    /**
     * Replace the view-specific content slot that comes after the header/description.
     * Pass `null` to remove the current content.
     */
    @RequiresEdt
    fun setContent(content: JComponent?) {
        this.content?.let { remove(it) }
        this.content = content
        syncNorth()
        content?.let { add(it, BorderLayout.CENTER) }
        revalidate()
        repaint()
    }

    /**
     * Choose which edges keep the standard dialog padding around the content.
     * A disabled edge lets the content bleed to that card edge while the header
     * and action footer keep their own standard side padding.
     */
    @RequiresEdt
    fun setContentPadding(top: Boolean = true, left: Boolean = true, right: Boolean = true, bottom: Boolean = true) {
        padTop = top
        padLeft = left
        padRight = right
        padBottom = bottom
        syncInsets()
        revalidate()
        repaint()
    }

    /**
     * Set the top inset (when top padding is on) and the header→content gap.
     * Use for non-standard vertical spacing; the standard values are used otherwise.
     */
    @RequiresEdt
    fun setSpacing(top: Int, gap: Int) {
        topInset = top
        this.gap = gap
        syncInsets()
        syncNorth()
        revalidate()
        repaint()
    }

    /**
     * Configure the action buttons shown in the card's right-aligned footer.
     *
     * Buttons are retained by stable [Action.id] when possible and updated in place.
     * Pass an empty list to remove the footer entirely.
     */
    @RequiresEdt
    fun setActions(actions: List<Action>) {
        val ids = actions.map { it.id }.toSet()
        val stale = actionButtons.keys - ids
        stale.forEach {
            actionButtons.remove(it)
            actionHandlers.remove(it)
        }
        actionOrder.clear()
        mainActions.removeAll()
        for (action in actions) {
            val btn = actionButtons[action.id] ?: makeButton(action.id, action.text).also { actionButtons[action.id] = it }
            actionHandlers[action.id] = action.handler
            btn.text = action.text
            btn.isEnabled = action.enabled
            btn.putClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY, if (action.primary) true else null)
            actionButtons[action.id] = btn
            actionOrder.add(action.id)
            mainActions.next(btn)
        }
        syncFooter()
    }

    /**
     * Enable or disable a specific action button identified by [id].
     * No-ops if the id is not found (e.g. before [setActions] is called).
     */
    @RequiresEdt
    fun setActionEnabled(id: String, enabled: Boolean) {
        actionButtons[id]?.isEnabled = enabled
    }

    /**
     * Optional component rendered on the left side of the action footer.
     * Pass `null` to remove a previously set component.
     */
    @RequiresEdt
    fun setActionLeft(component: JComponent?) {
        actionLeft = component
        sideActions.removeAll()
        component?.let {
            it.isOpaque = false
            sideActions.next(it).fill(UiStyle.Gap.pad())
        }
        syncFooter()
    }

    /**
     * Show or hide a specific action button identified by [id].
     * No-ops if the id is not found.
     */
    @RequiresEdt
    fun setActionVisible(id: String, visible: Boolean) {
        val btn = actionButtons[id] ?: return
        if (btn.isVisible == visible) return
        btn.isVisible = visible
        mainActions.revalidate()
        mainActions.repaint()
    }

    /**
     * Update a specific action button label identified by [id].
     * No-ops if the id is not found.
     */
    @RequiresEdt
    fun setActionText(id: String, text: String) {
        val btn = actionButtons[id] ?: return
        if (btn.text == text) return
        btn.text = text
    }

    @RequiresEdt
    fun setOutlined(value: Boolean) {
        if (outlined == value) return
        outlined = value
        repaint()
    }

    /** Returns the retained action component for focus management, or this card when absent. */
    @RequiresEdt
    fun preferredActionComponent(id: String): JComponent = actionButtons[id] ?: this

    // ---- SessionEditorStyleTarget ----

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        for ((area, bold) in tracked) applyFont(area, bold)
    }

    @RequiresEdt
    protected fun refresh() {
        revalidate()
        repaint()
        parent?.revalidate()
        parent?.repaint()
    }

    // ---- contentColor override ----

    override fun contentColor(): Color = SessionUiStyle.View.Surface.bgColor()

    override fun outlineColor(): Color? = if (outlined) SessionUiStyle.View.Outline.brightColor() else null

    // ---- private helpers ----

    private fun syncNorth() {
        north.removeAll()
        top?.let { north.next(it) }
        if (hasHeader()) north.next(header)
        if (content != null) north.fill(gap)
        north.revalidate()
        north.repaint()
    }

    private fun hasHeader() = icon.icon != null || headerText.isVisible || descriptionText.isVisible

    private fun syncInsets() {
        val side = UiStyle.Gap.pad()
        val innerLeft = if (padLeft) 0 else side
        val innerRight = if (padRight) 0 else side
        border = JBUI.Borders.empty(
            if (padTop) topInset else 0,
            if (padLeft) side else 0,
            if (padBottom) UiStyle.Gap.lg() else 0,
            if (padRight) side else 0,
        )
        north.border = JBUI.Borders.empty(0, innerLeft, 0, innerRight)
        footer.border = JBUI.Borders.empty(UiStyle.Gap.lg(), innerLeft, 0, innerRight)
    }

    private fun syncFooter() {
        val layout = footer.layout as BorderLayout
        val west = layout.getLayoutComponent(BorderLayout.WEST)
        val east = layout.getLayoutComponent(BorderLayout.EAST)
        if (actionLeft == null) {
            if (west != null) footer.remove(west)
        } else if (west == null) {
            footer.add(sideActions, BorderLayout.WEST)
        }
        if (actionOrder.isEmpty()) {
            if (east != null) footer.remove(east)
        } else if (east == null) {
            footer.add(mainActions, BorderLayout.EAST)
        }

        val root = this.layout as BorderLayout
        val attached = root.getLayoutComponent(BorderLayout.SOUTH) === footer
        val needed = actionLeft != null || actionOrder.isNotEmpty()
        if (needed && !attached) add(footer, BorderLayout.SOUTH)
        if (!needed && attached) remove(footer)
        footer.revalidate()
        footer.repaint()
        revalidate()
        repaint()
    }

    private fun makeText(value: String, color: Color, bold: Boolean): JBTextArea {
        val area = object : JBTextArea(value) {
            override fun getPreferredSize() =
                withWidth(super.getPreferredSize().height)

            override fun getMaximumSize(): Dimension {
                val size = preferredSize
                return Dimension(Int.MAX_VALUE, size.height)
            }

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
            caret.isSelectionVisible = false
            lineWrap = true
            wrapStyleWord = true
            foreground = color
            border = JBUI.Borders.empty()
            alignmentX = Component.LEFT_ALIGNMENT
        }
        tracked.add(area to bold)
        selection?.register(area)
        applyFont(area, bold)
        return area
    }

    private fun applyFont(area: JBTextArea, bold: Boolean) {
        val font = if (bold) style.headerFont else SessionUiStyle.Text.Secondary.font(style)
        if (area.font != font) area.font = font
    }

    private fun makeButton(id: String, text: String): JButton {
        // Standard platform buttons: primary uses DEFAULT_STYLE_KEY (accent), the rest render as
        // ordinary secondary buttons. DarculaButtonUI paints the rounded fill and border itself
        // via isContentAreaFilled, so the button must be non-opaque. If it stays opaque, Swing
        // first fills the rectangular bounds with the component background; in the Islands Light
        // theme that color differs from the card surface and leaks as a stray frame around the
        // rounded button (other themes happen to match, so they look fine).
        val btn = JButton(text)
        btn.isOpaque = false
        btn.addActionListener {
            actionHandlers[id]?.invoke()
            focus?.invoke()
        }
        return btn
    }
}
