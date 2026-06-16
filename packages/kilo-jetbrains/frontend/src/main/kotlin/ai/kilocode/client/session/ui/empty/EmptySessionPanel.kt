package ai.kilocode.client.session.ui.empty

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Align
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.rpc.dto.SessionDto
import com.intellij.icons.AllIcons
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.IconLoader
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.Centerizer
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import com.intellij.xml.util.XmlStringUtil
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.HierarchyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.Timer

/**
 * Empty-session panel.
 *
 * The content is a BorderLayout panel, wrapped in a
 * [Align] (exposed as [view]) so callers need not know about centering.
 */
class EmptySessionPanel(
    parent: Disposable,
    private val controller: SessionController,
    recents: List<SessionDto>,
    private val history: () -> Unit = {},
    private val activity: () -> Map<String, SessionActivityKind> = { emptyMap() },
    private val titles: () -> Map<String, String> = { emptyMap() },
    private val browse: (String) -> Unit = BrowserUtil::browse,
) : BorderLayoutPanel(), Disposable, SessionEditorStyleTarget {
    val view: Align = align(HAlign.CENTER, VAlign.CENTER)

    private val timer = Timer(ACTIVITY_MS) { syncActivity() }
    internal val recent = RecentsList(recents, controller)

    private val historyButton = ShowHistoryButton().apply {
        addActionListener { history() }
    }

    private val feedback = EmptySessionFeedback(browse)

    private val welcomeLabel = JBLabel(welcomeHtml()).apply {
        foreground = UIUtil.getContextHelpForeground()
        horizontalAlignment = JBLabel.CENTER
        setAllowAutoWrapping(true)
    }

    private val description = object : BorderLayoutPanel() {
        override fun getPreferredSize(): Dimension {
            val size = super.getPreferredSize()
            return Dimension(JBUI.scale(SessionUiStyle.RecentSessions.DESCRIPTION_WIDTH), size.height)
        }

        override fun getMaximumSize(): Dimension {
            val size = super.getMaximumSize()
            return Dimension(JBUI.scale(SessionUiStyle.RecentSessions.DESCRIPTION_WIDTH), size.height)
        }
    }.apply {
        isOpaque = false
        border = JBUI.Borders.empty(UiStyle.Gap.lg(), 0, UiStyle.Gap.lg(), 0)
        add(welcomeLabel, BorderLayout.CENTER)
    }

    init {
        Disposer.register(parent, this)
        Disposer.register(this, feedback)
        isOpaque = false
        applyStyle(SessionEditorStyle.current())
        addHierarchyListener { e ->
            if (e.changeFlags and HierarchyEvent.SHOWING_CHANGED.toLong() == 0L) return@addHierarchyListener
            if (isShowing) {
                syncActivity()
                timer.start()
                return@addHierarchyListener
            }
            timer.stop()
        }

        val gap = UiStyle.Gap.pad()
        layout = BorderLayout(0, gap)

        val logo = JBLabel(
            IconLoader.getIcon("/icons/kilo-content.svg", EmptySessionPanel::class.java),
        ).apply {
            horizontalAlignment = JBLabel.CENTER
        }
        val header = BorderLayoutPanel(0, gap).apply {
            isOpaque = false
            add(logo, BorderLayout.NORTH)
            add(description.align(HAlign.CENTER, VAlign.CENTER), BorderLayout.CENTER)
        }

        val south = BorderLayoutPanel().apply {
            isOpaque = false
            add(Stack.vertical(gap = UiStyle.Gap.lg())
                .next(Centerizer(historyButton, Centerizer.TYPE.HORIZONTAL))
                .next(Centerizer(feedback.button, Centerizer.TYPE.HORIZONTAL)), BorderLayout.CENTER)
        }

        add(header, BorderLayout.NORTH)
        if (recent.hasSessions()) add(recent, BorderLayout.CENTER)
        add(south, BorderLayout.SOUTH)
    }

    internal fun recentCount() = recent.count()

    internal fun selectRecent(index: Int) {
        recent.select(index)
    }

    internal fun selectedRecent() = recent.selected()

    internal fun clickRecent(index: Int) {
        recent.click(index)
    }

    internal fun clickShowHistory() {
        historyButton.doClick()
    }

    internal fun showHistoryText() = historyButton.text

    internal fun feedbackText() = KiloBundle.message("feedback.button")

    internal fun feedbackCursor() = feedback.button.cursor.type

    internal fun feedbackIcon() = feedback.button.icon

    internal fun feedbackBorderPainted() = feedback.button.isBorderPainted

    internal fun feedbackContent(open: (String) -> Unit = {}): JComponent = EmptySessionFeedback.content(open)

    internal fun feedbackUrls() = EmptySessionFeedback.urls()

    internal fun showHistoryBorderPainted() = historyButton.isBorderPainted

    internal fun showHistoryCursor() = historyButton.cursor.type

    internal fun recentVisible() = recent.hasSessions()

    internal fun explanationText() = KiloBundle.message("session.empty.welcome")

    internal fun welcomeLabelAlignment() = welcomeLabel.horizontalAlignment

    internal fun descriptionPreferredSize() = description.preferredSize

    internal fun descriptionMaximumSize() = description.maximumSize

    internal fun historyButtonPreferredWidth() = historyButton.preferredSize.width

    internal fun initialized() = true

    internal fun loadingVisible() = false

    internal fun activeView() = getComponent(0)

    internal fun text(session: SessionDto, now: Long = System.currentTimeMillis()) =
        recent.text(session, now)

    internal fun rendererComponent(
        session: SessionDto,
        selected: Boolean = false,
        hover: Boolean = false,
    ): Component {
        return recent.renderer(session, selected, hover)
    }

    @RequiresEdt
    internal fun syncActivity() {
        recent.sync(activity(), titles())
    }

    internal open class ShowHistoryButton(
        text: String = KiloBundle.message("session.showHistory"),
        icon: javax.swing.Icon = AllIcons.Vcs.History,
    ) : JButton(text, icon) {
        private var over = false

        init {
            isFocusable = false
            setRequestFocusEnabled(false)
            isContentAreaFilled = false
            isBorderPainted = false
            isOpaque = false
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            addMouseListener(object : MouseAdapter() {
                override fun mouseEntered(e: MouseEvent) {
                    sync(true)
                }

                override fun mouseExited(e: MouseEvent) {
                    sync(false)
                }
            })
        }

        override fun paintComponent(g: Graphics) {
            if (isEnabled && over) {
                val g2 = g.create() as Graphics2D
                try {
                    g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                    g2.color = JBUI.CurrentTheme.ActionButton.hoverBackground()
                    val arc = JBUI.scale(JBUI.getInt("Button.arc", 6))
                    g2.fillRoundRect(0, 0, width, height, arc, arc)
                } finally {
                    g2.dispose()
                }
            }
            super.paintComponent(g)
        }

        private fun sync(value: Boolean) {
            if (over == value) return
            over = value
            repaint()
        }
    }

    override fun dispose() {
        timer.stop()
    }

    override fun applyStyle(style: SessionEditorStyle) {
        welcomeLabel.font = style.regularFont
        recent.applyStyle(style)
        revalidate()
        repaint()
    }

    private fun welcomeHtml() = XmlStringUtil.wrapInHtml(
        "<div style='text-align:center'>${XmlStringUtil.escapeString(KiloBundle.message("session.empty.welcome"))}</div>"
    )

    private companion object {
        const val ACTIVITY_MS = 3_000
    }
}
