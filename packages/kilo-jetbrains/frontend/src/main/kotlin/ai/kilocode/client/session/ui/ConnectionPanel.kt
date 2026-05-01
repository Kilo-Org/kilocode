package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.update.SessionController
import ai.kilocode.client.session.update.SessionControllerEvent
import ai.kilocode.client.session.update.SessionControllerListener
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.JBColor
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Cursor
import java.awt.Dimension
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.UIManager

class ConnectionPanel(
    parent: Disposable,
    private val controller: SessionController,
) : JPanel(BorderLayout()), SessionControllerListener, Disposable {

    companion object {
        private const val DETAILS_LINES = 10
        private val ERROR = JBColor.namedColor("Label.errorForeground", UIUtil.getErrorForeground())
        private val WARNING = JBColor.lazy {
            UIManager.getColor("Component.warningFocusColor")
                ?: UIManager.getColor("Label.warningForeground")
                ?: UIUtil.getContextHelpForeground()
        }
    }

    private val click = object : MouseAdapter() {
        override fun mouseClicked(e: MouseEvent) {
            flip()
        }
    }

    private val header = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty(4, 8, 0, 8)
        isOpaque = false
    }

    private val left = JPanel(BorderLayout(JBUI.scale(4), 0)).apply {
        isOpaque = false
        addMouseListener(click)
    }

    private val toggle = JBLabel().apply {
        isVisible = false
        addMouseListener(click)
    }

    private val label = JBLabel().apply {
        foreground = UIUtil.getContextHelpForeground()
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
        isOpaque = false
        lineWrap = true
        wrapStyleWord = true
        foreground = UIUtil.getLabelForeground()
    }

    private val scroll = JBScrollPane(details).apply {
        border = JBUI.Borders.empty(0, 8, 4, 0)
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
        isOpaque = true
        background = UIUtil.getPanelBackground()
        border = JBUI.Borders.customLine(UIUtil.getBoundsColor(), 1, 0, 0, 0)
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
        label.foreground = UIUtil.getContextHelpForeground()
        label.text = KiloBundle.message("session.connection.connecting")
        detail = null
        expanded = false
        toggle.isVisible = false
        retry.isVisible = false
        renderDetails()
        showPanel()
    }

    private fun showError(text: String, detail: String?) {
        label.foreground = ERROR
        label.text = text
        retry.isVisible = true
        this.detail = detail?.takeIf { it.isNotBlank() }
        expanded = false
        toggle.isVisible = this.detail != null
        renderDetails()
    }

    private fun showWarning(text: String, detail: String?) {
        label.foreground = WARNING
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
        return Dimension(size.width, header.preferredSize.height + scrollHeight())
    }

    private fun scrollHeight(): Int {
        val rows = details.text.lineSequence().count().coerceIn(1, DETAILS_LINES)
        return details.getFontMetrics(details.font).height * rows + scrollChrome()
    }

    private fun scrollChrome() = scroll.insets.top + scroll.insets.bottom + JBUI.scale(2)

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
