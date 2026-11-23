package ai.kilocode.client.session.board

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.HoverArea
import ai.kilocode.client.ui.PlainLabel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import ai.kilocode.client.ui.md.MdViewFactory
import ai.kilocode.rpc.dto.BoardMessageDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.SwingTextTrimmer
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.Rectangle
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.Scrollable
import javax.swing.SwingConstants

/**
 * Width-tracking board body that retains one Markdown view per explicitly loaded message.
 *
 * Retaining deep pages is deliberate: paging is a user action in batches of 20, the CLI caps a
 * board at 1,000 messages, and evicting an already loaded row would make backward paging lossy.
 * The dialog is short-lived and [dispose] releases every Markdown editor when it closes.
 */
internal class BoardMessagesView @RequiresEdt constructor(
    private val avatars: BoardAvatars,
    private val open: (String, String?) -> Unit,
) : JPanel(BorderLayout()), Scrollable, Disposable {
    private val empty = JBLabel(KiloBundle.message("session.board.empty"), SwingConstants.CENTER)
    private val stack = Stack.vertical(UiStyle.Gap.pad())
    private var rows = linkedMapOf<String, BoardMessageView>()

    init {
        add(empty, BorderLayout.CENTER)
        add(stack, BorderLayout.NORTH)
        sync(emptyList())
    }

    @RequiresEdt
    fun sync(items: List<BoardMessageDto>) {
        val next = LinkedHashMap<String, BoardMessageView>()
        val seen = HashSet<String>()
        for (item in items) {
            if (!seen.add(item.id)) continue
            val row = rows.remove(item.id) ?: BoardMessageView(avatars, open)
            row.update(item)
            row.separated = next.isNotEmpty()
            next[item.id] = row
        }
        rows.values.forEach(Disposer::dispose)
        rows = next

        stack.removeAll()
        rows.values.forEach { stack.add(it) }
        empty.isVisible = rows.isEmpty()
        stack.isVisible = rows.isNotEmpty()
        revalidate()
        repaint()
    }

    @RequiresEdt
    override fun updateUI() {
        super.updateUI()
        border = JBUI.Borders.empty(0, UiStyle.Gap.PAD, UiStyle.Gap.PAD, UiStyle.Gap.PAD)
    }

    override fun getScrollableTracksViewportWidth() = true

    override fun getScrollableTracksViewportHeight() = rows.isEmpty()

    override fun getPreferredScrollableViewportSize(): Dimension = preferredSize

    override fun getScrollableUnitIncrement(
        visibleRect: Rectangle,
        orientation: Int,
        direction: Int,
    ) = UiStyle.Gap.pad()

    override fun getScrollableBlockIncrement(
        visibleRect: Rectangle,
        orientation: Int,
        direction: Int,
    ) = visibleRect.height

    @RequiresEdt
    override fun dispose() {
        rows.values.forEach(Disposer::dispose)
        rows.clear()
        stack.removeAll()
    }
}

/** One board message: a participant route followed by the original Markdown body. */
internal class BoardMessageView @RequiresEdt constructor(
    avatars: BoardAvatars,
    open: (String, String?) -> Unit,
) : Stack(StackAxis.VERTICAL, UiStyle.Gap.sm()), Disposable {
    private val style = SessionEditorStyle.current()
    private val sender = RouteMember(avatars, open)
    private val recipient = RouteMember(avatars, open)
    private val label = PlainLabel().apply {
        font = style.smallFont
        foreground = UiStyle.Colors.weak()
        putClientProperty(SwingTextTrimmer.KEY, SwingTextTrimmer.ELLIPSIS_AT_RIGHT)
    }
    private val route = JPanel(BorderLayout(UiStyle.Gap.md(), 0)).apply {
        isOpaque = false
        add(sender.component, BorderLayout.WEST)
        add(label, BorderLayout.CENTER)
        add(recipient.component, BorderLayout.EAST)
    }
    private val md = MdViewFactory.create(style).apply {
        opaque = false
        font = style.transcriptFont
        foreground = UiStyle.Colors.fg()
    }

    var separated = false
        set(value) {
            if (field == value) return
            field = value
            syncBorder()
        }

    init {
        Disposer.register(this, md)
        next(route)
        next(md.component)
        syncBorder()
    }

    @RequiresEdt
    fun update(message: BoardMessageDto) {
        sender.update(message.from, message.fromLabel)
        recipient.update(message.to, message.toLabel)
        val from = message.fromLabel ?: message.from
        val to = message.toLabel ?: message.to
        label.text = "$from \u2192 $to"
        route.accessibleContext.accessibleName = label.text
        if (md.markdown() != message.body) md.set(message.body)
    }

    @RequiresEdt
    override fun updateUI() {
        super.updateUI()
        syncBorder()
    }

    @RequiresEdt
    private fun syncBorder() {
        border = if (separated) {
            JBUI.Borders.compound(
                JBUI.Borders.customLineTop(UiStyle.Colors.contentBorder()),
                JBUI.Borders.emptyTop(UiStyle.Gap.PAD),
            )
        } else {
            JBUI.Borders.empty()
        }
    }

    override fun getMaximumSize() = Dimension(Int.MAX_VALUE, super.getMaximumSize().height)

    override fun dispose() = Unit
}

private class RouteMember @RequiresEdt constructor(
    private val avatars: BoardAvatars,
    private val open: (String, String?) -> Unit,
) {
    private val active = JBLabel()
    private val plain = JBLabel()
    private val area = HoverArea(active)
    private val root = JPanel(BorderLayout()).apply { isOpaque = false }
    val component: JComponent get() = root

    @RequiresEdt
    fun update(id: String, label: String?) {
        val title = label ?: id
        val icon = avatars.icon(id)
        active.icon = icon
        plain.icon = icon
        val tip = if (title == id) title else "$title ($id)"
        val target = id.takeIf(::isSubagent)
        val child = if (target == null) plain else area
        if (child.parent !== root) {
            root.removeAll()
            root.add(child, BorderLayout.CENTER)
            root.revalidate()
            root.repaint()
        }
        if (target == null) {
            area.action = null
            area.tooltip(null)
            plain.toolTipText = tip
            plain.accessibleContext.accessibleName = title
            return
        }
        plain.toolTipText = null
        area.action = { open(target, label) }
        area.tooltip(tip, title)
    }
}

private fun isSubagent(id: String): Boolean = id != "main" && id != "ALL"
