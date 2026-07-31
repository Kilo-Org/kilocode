package ai.kilocode.client.session.ui

import ai.kilocode.client.actions.KiloActionPlaces
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.session.controller.SessionControllerEvent
import ai.kilocode.client.session.controller.SessionControllerListener
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import com.intellij.ide.DataManager
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
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
) : BorderLayoutPanel(), SessionControllerListener, Disposable, SessionEditorStyleTarget {

    companion object {
        internal const val CLI_GROUP_ID = "Kilo.CliGroup"
        private const val DETAILS_LINES = 10
        private const val CHROME = 2
    }

    private val click = object : MouseAdapter() {
        override fun mouseClicked(e: MouseEvent) {
            flip()
        }
    }

    private val header = BorderLayoutPanel().apply {
        border = JBUI.Borders.empty(UiStyle.Gap.sm(), UiStyle.Gap.lg(), UiStyle.Gap.sm(), UiStyle.Gap.lg())
    }

    private val left = BorderLayoutPanel().apply {
        layout = BorderLayout(UiStyle.Gap.sm(), 0)
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
        showRecoveryPopup()
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
        border = detailsBorder()
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
        applyStyle(SessionEditorStyle.current())
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

            is SessionControllerEvent.ConnectionChanged.ShowDownloading -> showDownloading(event.percent, event.version, event.platform)

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

    private fun showDownloading(percent: Int, version: String?, platform: String?) {
        label.foreground = UiStyle.Colors.weak()
        val pct = percent.coerceIn(0, 100)
        label.text = if (version != null && platform != null) {
            KiloBundle.message("session.connection.downloading.version", version, platform, pct)
        } else {
            KiloBundle.message("session.connection.downloading", pct)
        }
        detail = null
        expanded = false
        toggle.isVisible = false
        retry.isVisible = false
        renderDetails()
        showPanel()
    }

    private fun showError(text: String, detail: String?) {
        label.foreground = UiStyle.Colors.errorLabelForeground()
        label.text = text
        retry.isVisible = true
        this.detail = detail?.takeIf { it.isNotBlank() }
        expanded = false
        toggle.isVisible = this.detail != null
        renderDetails()
    }

    private fun showWarning(text: String, detail: String?) {
        label.foreground = UiStyle.Colors.warningLabelForeground()
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

    private fun showRecoveryPopup() {
        JBPopupFactory.getInstance()
            .createActionGroupPopup(
                null,
                recoveryGroup(),
                DataManager.getInstance().getDataContext(retry),
                JBPopupFactory.ActionSelectionAid.SPEEDSEARCH,
                true,
                KiloActionPlaces.connectionRetryPopup(),
            )
            .showUnderneathOf(retry)
    }

    private fun recoveryGroup(): ActionGroup {
        val group = DefaultActionGroup()
        group.add(object : DumbAwareAction(KiloBundle.message("session.connection.retry")) {
            override fun actionPerformed(e: AnActionEvent) {
                controller.retryConnection()
            }
        })
        group.addSeparator()
        ActionManager.getInstance().getAction("Kilo.Restart")?.let { group.add(it) }
        ActionManager.getInstance().getAction("Kilo.Reinstall")?.let { group.add(it) }
        return group
    }

    override fun dispose() {
        // no-op
    }

    override fun applyStyle(style: SessionEditorStyle) {
        background = style.editorScheme.defaultBackground
        scroll.border = detailsBorder()
        revalidate()
        repaint()
    }

    private fun detailsBorder() = JBUI.Borders.compound(
        JBUI.Borders.customLineTop(SessionUiStyle.View.Prompt.separator()),
        JBUI.Borders.empty(UiStyle.Gap.sm(), UiStyle.Gap.lg(), UiStyle.Gap.sm(), 0),
    )!!

    override fun getPreferredSize(): Dimension {
        val size = super.getPreferredSize()
        if (!scroll.isVisible) return size
        // header/scroll heights are already scaled px; assign with plain Dimension so IDE
        // zoom does not scale them a second time via the user scale factor.
        return Dimension(size.width, header.preferredSize.height + scrollHeight())
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

    internal fun hasSeparator() = border != null

    internal fun maxExpandedHeight() =
        header.preferredSize.height + details.getFontMetrics(details.font).height * DETAILS_LINES + scrollChrome()
}
