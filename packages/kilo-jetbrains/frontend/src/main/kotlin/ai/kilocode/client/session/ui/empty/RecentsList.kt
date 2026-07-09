package ai.kilocode.client.session.ui.empty

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.session.history.HistoryActivitySnapshot
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.session.history.LocalHistoryItem
import ai.kilocode.client.session.history.itemAt
import ai.kilocode.client.session.history.title
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.SessionDto
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Cursor
import java.awt.FlowLayout
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.event.MouseMotionAdapter
import javax.swing.DefaultListModel
import javax.swing.JList
import javax.swing.ListCellRenderer
import javax.swing.ListSelectionModel

internal class RecentsList(
    sessions: List<SessionDto>,
    private val controller: SessionController,
) : BorderLayoutPanel(), SessionEditorStyleTarget {
    private val model = DefaultListModel<LocalHistoryItem>()
    private var hover = -1
    private var snapshot = HistoryActivitySnapshot()

    private val title = JBLabel(KiloBundle.message("session.empty.recent")).apply {
        foreground = UIUtil.getContextHelpForeground()
    }

    internal val list = JBList(model).apply {
        isOpaque = false
        selectionMode = ListSelectionModel.SINGLE_SELECTION
        visibleRowCount = SessionUiStyle.RecentSessions.LIMIT
        cellRenderer = Renderer()
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

    init {
        isOpaque = false
        add(title, BorderLayout.NORTH)
        add(list, BorderLayout.CENTER)
        setSessions(sessions)
    }

    fun count() = model.size()

    fun hasSessions() = model.size() > 0

    fun select(index: Int) {
        list.selectedIndex = index
    }

    fun selected() = list.selectedIndex

    fun click(index: Int) {
        list.selectedIndex = index
        controller.openSession(SessionRef.Local(model.getElementAt(index).session))
    }

    fun text(session: SessionDto, now: Long = System.currentTimeMillis()) =
        HistoryTime.relative(LocalHistoryItem(session), now)

    fun renderer(
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

    @RequiresEdt
    fun sync(activity: Map<String, SessionActivityKind>, titles: Map<String, String>) {
        val next = HistoryActivitySnapshot(activity, titles)
        val changed = snapshot.changed(next)
        snapshot = next
        repaintRows(changed)
    }

    override fun applyStyle(style: SessionEditorStyle) {
        title.font = style.smallFont
        revalidate()
        repaint()
    }

    private fun setSessions(sessions: List<SessionDto>) {
        model.clear()
        sessions.take(SessionUiStyle.RecentSessions.LIMIT).map(::LocalHistoryItem).forEach(model::addElement)
        revalidate()
        repaint()
    }

    private fun repaintRows(ids: Set<String>) {
        if (ids.isEmpty()) return
        repeat(model.size()) { index ->
            if (model.getElementAt(index).id !in ids) return@repeat
            list.getCellBounds(index, index)?.let(list::repaint)
        }
    }

    private fun index(e: MouseEvent): Int {
        val idx = list.locationToIndex(e.point)
        if (idx < 0) return -1
        val box = list.getCellBounds(idx, idx) ?: return -1
        if (!box.contains(e.point)) return -1
        return idx
    }

    private inner class Renderer : BorderLayoutPanel(), ListCellRenderer<LocalHistoryItem> {
        private val title = JBLabel()
        private val badge = JBLabel().apply {
            border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())
        }
        private val time = JBLabel()
        private val head = BorderLayoutPanel().apply {
            add(BorderLayoutPanel().apply {
                layout = FlowLayout(FlowLayout.LEFT, 0, 0)
                isOpaque = false
                add(title)
                add(badge)
            }, BorderLayout.CENTER)
        }

        init {
            layout = BorderLayout(UiStyle.Gap.pad(), 0)
            border = JBUI.Borders.empty(UiStyle.Gap.lg(), UiStyle.Gap.lg(), UiStyle.Gap.lg(), UiStyle.Gap.lg())
            head.isOpaque = false
            add(head, BorderLayout.CENTER)
            add(time, BorderLayout.EAST)
        }

        override fun getListCellRendererComponent(
            list: JList<out LocalHistoryItem>,
            value: LocalHistoryItem?,
            index: Int,
            selected: Boolean,
            focus: Boolean,
        ): Component {
            val over = selected || hover == index
            isOpaque = over
            background = if (over) list.selectionBackground else list.background
            title.foreground = if (over) list.selectionForeground else UIUtil.getLabelForeground()
            time.foreground = if (over) list.selectionForeground else UIUtil.getContextHelpForeground()
            title.text = value?.let { snapshot.titles[it.id] ?: title(it) } ?: ""
            time.text = value?.let(HistoryTime::relative) ?: ""
            setBadge(value?.id?.let(snapshot.activity::get))
            return this
        }

        private fun setBadge(kind: SessionActivityKind?) {
            badge.isVisible = kind != null
            badge.icon = kind?.let { FilledBadgeIcon(it.label(), it.style()) }
        }
    }
}

private fun Map<String, String>.changed(next: Map<String, String>) = (keys + next.keys).filterTo(mutableSetOf()) {
    this[it] != next[it]
}
