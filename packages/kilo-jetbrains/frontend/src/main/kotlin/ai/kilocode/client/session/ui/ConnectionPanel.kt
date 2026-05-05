package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.update.SessionController
import ai.kilocode.client.session.update.SessionControllerEvent
import ai.kilocode.client.session.update.SessionControllerListener
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBDimension
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Cursor
import java.awt.Dimension
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.ScrollPaneConstants

class ConnectionPanel(
    parent: Disposable,
    private val controller: SessionController,
) : BorderLayoutPanel(), SessionControllerListener, Disposable {

    companion object {
        private const val DETAILS_LINES = 10
        private const val CHROME = 2
    }

    private val click = object : MouseAdapter() {
        override fun mouseClicked(e: MouseEvent) {
            flip()
        }
    }

    private val header = BorderLayoutPanel().apply {
        border = JBUI.Borders.empty(UiStyle.Space.SM, UiStyle.Space.LG, 0, UiStyle.Space.LG)
    }

    private val left = BorderLayoutPanel().apply {
        layout = UiStyle.Gap.layout(UiStyle.Space.SM)
        addMouseListener(click)
    }

    private val toggle = JBLabel().apply {
        isVisible = false
        addMouseListener(click)
    }

    private val label = JBLabel().apply {
        foreground = UiStyle.Colors.weak()
        addMouseListener(click)
    }

    private val retry = ActionLink(KiloBundle.message("session.connection.retry")) {
        controller.retryConnection()
    }.apply {
        isVisible = false
        horizontalAlignment = JBLabel.RIGHT
        isFocusable = false
        setRequestFocusEnabled(false)
    }

    private val details = JBTextArea().apply {
        isEditable = false
        // Details should read as inline expandable text, not a nested text box.
        isOpaque = false
        lineWrap = true
        wrapStyleWord = true
        foreground = UiStyle.Colors.fg()
    }

    private val scroll = JBScrollPane(details).apply {
        border = JBUI.Borders.empty(0, UiStyle.Space.LG, UiStyle.Space.SM, 0)
        // Match the banner background while retaining platform scroll behavior.
        isOpaque = false
        viewport.isOpaque = false
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        isVisible = false
    }

    private var detail: String? = null
    private var expanded = false

    init {
        Disposer.register(parent, this)
        // Keep the banner solid so expanded details cover transcript content beneath it.
        isOpaque = true
        background = UiStyle.Colors.bg()
        border = JBUI.Borders.customLine(UiStyle.Colors.line(), 1, 0, 0, 0)
        left.add(toggle, BorderLayout.WEST)
        left.add(label, BorderLayout.CENTER)
        header.add(left, BorderLayout.CENTER)
        header.add(retry, BorderLayout.EAST)
        add(header, BorderLayout.NORTH)
        controller.addListener(this, this)
        hidePanel()
    }

    override fun onEvent(event: SessionControllerEvent) {
        when (event) {
            is SessionControllerEvent.ConnectionChanged.Hide -> hidePanel()

            is SessionControllerEvent.ConnectionChanged.ShowConnecting -> showConnecting()

            is SessionControllerEvent.ConnectionChanged.ShowError -> {
                showError(event.summary, event.detail)
                showPanel()
            }

            is SessionControllerEvent.ConnectionChanged.ShowWarning -> {
                showWarning(event.summary, event.detail)
                showPanel()
            }

            else -> Unit
        }
    }

    private fun showConnecting() {
        label.foreground = UiStyle.Colors.weak()
        label.text = KiloBundle.message("session.connection.connecting")
        detail = null
        expanded = false
        toggle.isVisible = false
        retry.isVisible = false
        renderDetails()
        showPanel()
    }

    private fun showError(text: String, detail: String?) {
        label.foreground = UiStyle.Colors.error()
        label.text = text
        retry.isVisible = true
        this.detail = detail?.takeIf { it.isNotBlank() }
        expanded = false
        toggle.isVisible = this.detail != null
        renderDetails()
    }

    private fun showWarning(text: String, detail: String?) {
        label.foreground = UiStyle.Colors.warning()
        label.text = text
        retry.isVisible = true
        this.detail = detail?.takeIf { it.isNotBlank() }
        expanded = false
        toggle.isVisible = this.detail != null
        renderDetails()
    }

    private fun renderDetails() {
        val text = detail
        val show = expanded && text != null
        val cursor = if (text != null) Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) else Cursor.getDefaultCursor()
        toggle.icon = if (expanded) AllIcons.General.ArrowDown else AllIcons.General.ArrowRight
        left.cursor = cursor
        label.cursor = cursor
        toggle.cursor = cursor
        details.text = text ?: ""
        scroll.isVisible = show
        if (show) add(scroll, BorderLayout.CENTER)
        else remove(scroll)
    }

    private fun flip() {
        if (!toggle.isVisible) return
        expanded = !expanded
        renderDetails()
        refresh()
    }

    private fun showPanel() {
        if (!isVisible) {
            isVisible = true
            refresh()
            return
        }
        refresh()
    }

    private fun hidePanel() {
        if (isVisible) {
            isVisible = false
            refresh()
            return
        }
        refresh()
    }

    private fun refresh() {
        parent?.revalidate()
        parent?.repaint()
        revalidate()
        repaint()
    }

    override fun dispose() {
        // no-op
    }

    override fun getPreferredSize(): Dimension {
        val size = super.getPreferredSize()
        if (!scroll.isVisible) return size
        return JBDimension(size.width, header.preferredSize.height + scrollHeight())
    }

    private fun scrollHeight(): Int {
        val rows = details.text.lineSequence().count().coerceIn(1, DETAILS_LINES)
        return details.getFontMetrics(details.font).height * rows + scrollChrome()
    }

    private fun scrollChrome() = scroll.insets.top + scroll.insets.bottom + JBUI.scale(CHROME)

    internal fun summaryText() = label.text

    internal fun summaryColor() = label.foreground

    internal fun detailsText() = details.text

    internal fun detailsColor() = details.foreground

    internal fun retryVisible() = retry.isVisible

    internal fun retryText() = retry.text

    internal fun detailsVisible() = scroll.isVisible

    internal fun toggleVisible() = toggle.isVisible

    internal fun toggleExpanded() = expanded

    internal fun clickToggle() {
        if (!toggle.isVisible) return
        toggle.mouseListeners.firstOrNull()?.mouseClicked(
            MouseEvent(toggle, MouseEvent.MOUSE_CLICKED, 0, 0, 0, 0, 1, false)
        )
    }

    internal fun clickSummary() {
        label.mouseListeners.firstOrNull()?.mouseClicked(
            MouseEvent(label, MouseEvent.MOUSE_CLICKED, 0, 0, 0, 0, 1, false)
        )
    }

    internal fun retryFocusable() = retry.isFocusable

    internal fun clickRetry() = retry.doClick()

    internal fun hasSeparator() = border != null

    internal fun maxExpandedHeight() =
        header.preferredSize.height + details.getFontMetrics(details.font).height * DETAILS_LINES + scrollChrome()
}
