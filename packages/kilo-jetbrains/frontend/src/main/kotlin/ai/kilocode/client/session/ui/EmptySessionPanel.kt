package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.session.history.LocalHistoryItem
import ai.kilocode.client.session.history.itemAt
import ai.kilocode.client.session.history.title
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.ui.CenterShrinkPanel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.SessionDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
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
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.event.MouseMotionAdapter
import javax.swing.DefaultListModel
import javax.swing.JButton
import javax.swing.JList
import javax.swing.ListCellRenderer
import javax.swing.ListSelectionModel

/**
 * Empty-session panel.
 *
 * The content is a BorderLayout panel, wrapped in a
 * [CenterShrinkPanel] (exposed as [view]) so callers need not know about centering.
 */
class EmptySessionPanel(
    parent: Disposable,
    private val controller: SessionController,
    recents: List<SessionDto>,
    private val history: () -> Unit = {},
) : BorderLayoutPanel(), Disposable, SessionEditorStyleTarget {
    val view: CenterShrinkPanel = CenterShrinkPanel(this)

    private val model = DefaultListModel<LocalHistoryItem>()
    private var hover = -1
    private var style = SessionEditorStyle.current()

    private val recentTitle = JBLabel(KiloBundle.message("session.empty.recent")).apply {
        foreground = UIUtil.getContextHelpForeground()
    }

    private val list = JBList(model).apply {
        isOpaque = false
        selectionMode = ListSelectionModel.SINGLE_SELECTION
        visibleRowCount = SessionUiStyle.RecentSessions.LIMIT
        cellRenderer = SessionRenderer()
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        emptyText.clear()
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                val item = itemAt(this@apply, e) ?: return
                controller.openSession(SessionRef.Local(item.session))
            }

            override fun mouseExited(e: MouseEvent) {
                hover = -1
                repaint()
            }
        })
        addMouseMotionListener(object : MouseMotionAdapter() {
            override fun mouseMoved(e: MouseEvent) {
                val index = index(e)
                if (hover == index) return
                hover = index
                repaint()
            }
        })
    }

    private val historyButton = ShowHistoryButton().apply {
        addActionListener { history() }
    }

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
        isOpaque = false
        applyStyle(SessionEditorStyle.current())
        setSessions(recents)

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
            add(CenterShrinkPanel(description), BorderLayout.CENTER)
        }

        val recent = BorderLayoutPanel().apply {
            isOpaque = false
            add(recentTitle, BorderLayout.NORTH)
            add(list, BorderLayout.CENTER)
        }

        val south = BorderLayoutPanel().apply {
            isOpaque = false
            add(Centerizer(historyButton, Centerizer.TYPE.HORIZONTAL), BorderLayout.CENTER)
        }

        add(header, BorderLayout.NORTH)
        add(recent, BorderLayout.CENTER)
        add(south, BorderLayout.SOUTH)
    }

    private fun setSessions(sessions: List<SessionDto>) {
        model.clear()
        sessions.take(SessionUiStyle.RecentSessions.LIMIT).map(::LocalHistoryItem).forEach(model::addElement)
        revalidate()
        repaint()
    }

    internal fun recentCount() = model.size()

    internal fun selectRecent(index: Int) {
        list.selectedIndex = index
    }

    internal fun selectedRecent() = list.selectedIndex

    internal fun clickRecent(index: Int) {
        list.selectedIndex = index
        controller.openSession(SessionRef.Local(model.getElementAt(index).session))
    }

    internal fun clickShowHistory() {
        historyButton.doClick()
    }

    internal fun showHistoryText() = historyButton.text

    internal fun showHistoryBorderPainted() = historyButton.isBorderPainted

    internal fun showHistoryCursor() = historyButton.cursor.type

    internal fun recentCursor() = list.cursor.type

    internal fun recentVisible() = true

    internal fun explanationText() = KiloBundle.message("session.empty.welcome")

    internal fun welcomeLabelAlignment() = welcomeLabel.horizontalAlignment

    internal fun descriptionPreferredSize() = description.preferredSize

    internal fun descriptionMaximumSize() = description.maximumSize

    internal fun historyButtonPreferredWidth() = historyButton.preferredSize.width

    internal fun initialized() = true

    internal fun loadingVisible() = false

    internal fun activeView() = getComponent(0)

    internal fun text(session: SessionDto, now: Long = System.currentTimeMillis()) =
        HistoryTime.relative(LocalHistoryItem(session), now)

    internal fun rendererComponent(
        session: SessionDto,
        selected: Boolean = false,
        hover: Boolean = false,
    ): Component {
        val old = this.hover
        this.hover = if (hover) 0 else -1
        return list.cellRenderer.getListCellRendererComponent(list, LocalHistoryItem(session), 0, selected, false).also {
            this.hover = old
        }
    }

    private fun index(e: MouseEvent): Int {
        val idx = list.locationToIndex(e.point)
        if (idx < 0) return -1
        val box = list.getCellBounds(idx, idx) ?: return -1
        if (!box.contains(e.point)) return -1
        return idx
    }

    private inner class SessionRenderer : BorderLayoutPanel(), ListCellRenderer<LocalHistoryItem> {
        private val title = JBLabel()
        private val time = JBLabel()

        init {
            layout = BorderLayout(UiStyle.Gap.pad(), 0)
            border = JBUI.Borders.empty(UiStyle.Gap.lg(), UiStyle.Gap.lg(), UiStyle.Gap.lg(), UiStyle.Gap.lg())
            add(title, BorderLayout.CENTER)
            add(time, BorderLayout.EAST)
        }

        override fun getListCellRendererComponent(
            list: JList<out LocalHistoryItem>,
            value: LocalHistoryItem?,
            index: Int,
            selected: Boolean,
            focus: Boolean,
        ): Component {
            val active = selected || hover == index
            isOpaque = active
            background = if (active) list.selectionBackground else list.background
            title.foreground = if (active) list.selectionForeground else UIUtil.getLabelForeground()
            time.foreground = if (active) list.selectionForeground else UIUtil.getContextHelpForeground()
            title.text = value?.let(::title) ?: ""
            time.text = value?.let(HistoryTime::relative) ?: ""
            return this
        }
    }

    private inner class ShowHistoryButton : JButton(KiloBundle.message("session.showHistory"), AllIcons.Vcs.History) {
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
        // no-op
    }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        welcomeLabel.font = style.uiFont
        recentTitle.font = style.smallUiFont
        revalidate()
        repaint()
    }

    private fun welcomeHtml() = XmlStringUtil.wrapInHtml(
        "<div style='text-align:center'>${XmlStringUtil.escapeString(KiloBundle.message("session.empty.welcome"))}</div>"
    )
}
