package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.update.SessionController
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.md.MdView
import ai.kilocode.rpc.dto.SessionDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.util.ui.Centerizer
import com.intellij.util.ui.JBDimension
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Dimension
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.event.MouseMotionAdapter
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.DefaultListModel
import javax.swing.JList
import javax.swing.ListCellRenderer
import javax.swing.ListSelectionModel
import kotlin.math.abs

/**
 * Centered empty-session panel.
 */
class EmptySessionPanel(
    parent: Disposable,
    private val controller: SessionController,
    recents: List<SessionDto>,
) : BorderLayoutPanel(), Disposable, SessionStyleTarget {

    companion object {
        internal val LIMIT = UiStyle.Size.LIMIT
        internal val MAX_WIDTH = UiStyle.Size.WIDTH
        private const val SECOND_MS_LIMIT = 10_000_000_000L
        private const val MINUTE = 60_000L
        private const val HOUR = 60 * MINUTE
        private const val DAY = 24 * HOUR
    }

    private val model = DefaultListModel<SessionDto>()
    private var hover = -1
    private var style = SessionStyle.current()
    private val recentTitle = JBLabel(KiloBundle.message("session.empty.recent")).apply {
        foreground = UIUtil.getContextHelpForeground()
        border = JBUI.Borders.emptyLeft(UiStyle.Space.LG)
    }

    private val list = JBList(model).apply {
        // Blend the recent-session list into the centered empty-state surface.
        isOpaque = false
        selectionMode = ListSelectionModel.SINGLE_SELECTION
        visibleRowCount = LIMIT
        cellRenderer = SessionRenderer()
        emptyText.clear()
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                val index = row(e)
                if (index < 0) return
                selectedIndex = index
                controller.openSession(model.getElementAt(index))
            }

            override fun mouseExited(e: MouseEvent) {
                hover = -1
                repaint()
            }
        })
        addMouseMotionListener(object : MouseMotionAdapter() {
            override fun mouseMoved(e: MouseEvent) {
                val index = row(e)
                if (hover == index) return
                hover = index
                repaint()
            }
        })
    }
    private val md = MdView.html().apply {
        // MdView uses an HTML component; transparency keeps the centered panel seamless.
        opaque = false
        foreground = UIUtil.getContextHelpForeground()
        set(KiloBundle.message("session.empty.welcome"))
    }
    private val content = createContent()

    init {
        Disposer.register(parent, this)
        // The empty state floats on the tool-window background.
        isOpaque = false
        border = UiStyle.Insets.empty()
        applyStyle(SessionStyle.current())
        setSessions(recents)
        add(Centerizer(content, Centerizer.TYPE.BOTH), BorderLayout.CENTER)
    }

    private fun setSessions(sessions: List<SessionDto>) {
        model.clear()
        sessions.take(LIMIT).forEach(model::addElement)
        revalidate()
        repaint()
    }

    private fun createContent(): BorderLayoutPanel {
        val logo = JBLabel(
            IconLoader.getIcon("/icons/kilo-content.svg", EmptySessionPanel::class.java),
        ).apply {
            alignmentX = CENTER_ALIGNMENT
        }
        val intro = BorderLayoutPanel().apply {
            alignmentX = CENTER_ALIGNMENT
            add(md.component, BorderLayout.CENTER)
            border = JBUI.Borders.empty(0, UiStyle.Space.PAD, 0, UiStyle.Space.PAD)
        }
        val recent = BorderLayoutPanel().apply {
            alignmentX = CENTER_ALIGNMENT
            add(recentTitle, BorderLayout.NORTH)
            add(list, BorderLayout.CENTER)
        }
        val stack = BorderLayoutPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            add(logo)
            add(Box.createVerticalStrut(JBUI.scale(UiStyle.Space.LOGO)))
            add(intro)
            add(Box.createVerticalStrut(JBUI.scale(UiStyle.Space.RECENT)))
            add(recent)
        }
        return object : BorderLayoutPanel() {
            override fun getPreferredSize(): Dimension {
                val size = super.getPreferredSize()
                return JBDimension(JBUI.scale(MAX_WIDTH), size.height)
            }
        }.apply {
            add(stack, BorderLayout.NORTH)
        }
    }

    internal fun recentCount() = model.size()

    internal fun selectRecent(index: Int) {
        list.selectedIndex = index
    }

    internal fun selectedRecent() = list.selectedIndex

    internal fun clickRecent(index: Int) {
        list.selectedIndex = index
        controller.openSession(model.getElementAt(index))
    }

    internal fun recentVisible() = true

    internal fun explanationMarkdown() = md.markdown()

    internal fun contentPreferredSize() = content.preferredSize

    internal fun initialized() = true

    internal fun loadingVisible() = false

    internal fun activeView() = getComponent(0)

    internal fun text(session: SessionDto, now: Long = System.currentTimeMillis()) = time(session, now)

    internal fun normalize(value: Double): Long {
        val raw = value.toLong()
        if (abs(raw) < SECOND_MS_LIMIT) return raw * 1000
        return raw
    }

    internal fun rendererComponent(
        session: SessionDto,
        selected: Boolean = false,
        hover: Boolean = false,
    ): Component {
        val old = this.hover
        this.hover = if (hover) 0 else -1
        return list.cellRenderer.getListCellRendererComponent(list, session, 0, selected, false).also {
            this.hover = old
        }
    }

    private fun row(e: MouseEvent): Int {
        val index = list.locationToIndex(e.point)
        if (index < 0) return -1
        val box = list.getCellBounds(index, index) ?: return -1
        if (!box.contains(e.point)) return -1
        return index
    }

    private inner class SessionRenderer : BorderLayoutPanel(), ListCellRenderer<SessionDto> {
        private val title = JBLabel()
        private val time = JBLabel()

        init {
            border = JBUI.Borders.empty(UiStyle.Space.LG, UiStyle.Space.LG, UiStyle.Space.LG, UiStyle.Space.LG)
            add(title, BorderLayout.CENTER)
            add(time, BorderLayout.EAST)
        }

        override fun getListCellRendererComponent(
            list: JList<out SessionDto>,
            value: SessionDto?,
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
            time.text = value?.let { time(it) } ?: ""
            return this
        }
    }

    private fun title(session: SessionDto) =
        session.title.takeIf { it.isNotBlank() } ?: KiloBundle.message("session.tab.untitled")

    private fun time(session: SessionDto, now: Long = System.currentTimeMillis()): String {
        val ms = normalize(session.time.updated)
        val diff = (now - ms).coerceAtLeast(0)
        if (diff < MINUTE) return KiloBundle.message("session.empty.time.moments")
        if (diff < HOUR) return KiloBundle.message("session.empty.time.minutes", (diff / MINUTE).coerceAtLeast(1))
        if (diff < DAY) return KiloBundle.message("session.empty.time.hours", (diff / HOUR).coerceAtLeast(1))
        return KiloBundle.message("session.empty.time.days", (diff / DAY).coerceAtLeast(1))
    }

    override fun dispose() {
        // no-op
    }

    override fun applyStyle(style: SessionStyle) {
        this.style = style
        md.font = style.uiFont
        recentTitle.font = style.smallUiFont
        revalidate()
        repaint()
    }
}
