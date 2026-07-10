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
 * Both [ai.kilocode.client.session.views.question.QuestionView] and
 * [ai.kilocode.client.session.views.LoginRequiredView] use this as their
 * outer card shell so they share the same background, padding, and text
 * styling without duplicating the setup.
 *
 * The root uses BorderLayout regions: optional top and header in north,
 * optional view content in center, and optional action controls in south.
 * Call [setTopPanel], [setHeaderIcon], [setHeader], [setDescription],
 * [setContent], [setActions], or [setActionEnabled] to configure the card.
 */
class BaseQuestionView(
    private val selection: SessionSelection? = null,
    private val focus: (() -> Unit)? = null,
) : RoundedContentPanel(
    UiStyle.Gap.pad(),
    UiStyle.Gap.pad(),
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

    private val north = Stack.vertical()

    private val text = Stack.vertical()

    private val header = object : JPanel(BorderLayout(UiStyle.Gap.sm(), 0)) {
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

    private val headerText: JBTextArea = makeText("", UiStyle.Colors.fg(), bold = true)
    private val descriptionText: JBTextArea = makeText("", UiStyle.Colors.weak(), bold = false)

    private var top: JComponent? = null
    private var content: JComponent? = null
    private var actionLeft: JComponent? = null
    private var gap = UiStyle.Gap.lg()

    // action buttons keyed by id for retained updates
    private val actionButtons = mutableMapOf<String, JButton>()
    private val actionHandlers = mutableMapOf<String, () -> Unit>()
    private val actionOrder = mutableListOf<String>()

    private val mainActions = Stack.horizontal(gap = UiStyle.Gap.sm())

    private val sideActions = Stack.horizontal()

    private val footer = JPanel(BorderLayout()).apply {
        isOpaque = false
        border = JBUI.Borders.emptyTop(UiStyle.Gap.lg())
    }

    init {
        text.next(headerText).next(descriptionText)
        header.add(text, BorderLayout.CENTER)
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
        header.revalidate()
        header.repaint()
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

    @RequiresEdt
    fun setSpacing(top: Int, gap: Int) {
        this.gap = gap
        border = JBUI.Borders.empty(top, UiStyle.Gap.pad(), UiStyle.Gap.lg(), UiStyle.Gap.pad())
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

    /** Returns the retained action component for focus management, or this card when absent. */
    @RequiresEdt
    fun preferredActionComponent(id: String): JComponent = actionButtons[id] ?: this

    // ---- SessionEditorStyleTarget ----

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        for ((area, bold) in tracked) applyFont(area, bold)
    }

    // ---- contentColor override ----

    override fun contentColor(): Color = SessionUiStyle.View.Surface.bgColor()

    override fun outlineColor(): Color = SessionUiStyle.View.Outline.brightColor()

    // ---- private helpers ----

    private fun syncNorth() {
        north.removeAll()
        top?.let { north.next(it) }
        north.next(header)
        if (content != null) north.fill(gap)
        north.revalidate()
        north.repaint()
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
            override fun getPreferredSize() = withWidth(super.getPreferredSize().height)

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
        val font = if (bold) style.headerFont else style.hintFont
        if (area.font != font) area.font = font
    }

    private fun makeButton(id: String, text: String): JButton {
        val btn = object : JButton(text) {
            init {
                syncBackground()
            }

            override fun updateUI() {
                super.updateUI()
                syncBackground()
            }

            private fun syncBackground() {
                background = SessionUiStyle.View.Surface.bgColor()
            }
        }
        btn.addActionListener {
            actionHandlers[id]?.invoke()
            focus?.invoke()
        }
        return btn
    }
}
