package ai.kilocode.client.session.scroll

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.application.ApplicationManager
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Cursor
import java.awt.Point
import java.awt.Rectangle
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.event.MouseWheelListener
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.JScrollBar
import javax.swing.SwingUtilities

internal class SessionScroll(
    private val root: SessionRootPanel,
    private val host: JPanel,
    private val messages: SessionMessageListPanel,
    body: JPanel,
) {
    companion object {
        private const val THRESHOLD = 32
        private const val OPEN_PASSES = 12
        private const val FOLLOW_PASSES = 6
    }

    private var style = SessionEditorStyle.current()

    val component = JBScrollPane(body).apply {
        border = JBUI.Borders.empty()
        verticalScrollBarPolicy = JBScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED
        horizontalScrollBarPolicy = JBScrollPane.HORIZONTAL_SCROLLBAR_NEVER
    }

    internal val bar: JScrollBar get() = component.verticalScrollBar
    internal val jump: JBLabel
    val view: JComponent? get() = component.viewport.view as? JComponent
    var onScroll: (() -> Unit)? = null

    private var tail = true
    private var auto = false
    private var opening = false
    private var stable = -1
    private var seq = 0
    private var pause = false
    private var user = false
    private var value = 0
    private var question = false

    init {
        jump = JBLabel(ScrollButtonIcon.create()).apply {
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            toolTipText = KiloBundle.message("session.scroll.bottom")
            isVisible = false
            addMouseListener(object : MouseAdapter() {
                override fun mouseClicked(e: MouseEvent) {
                    jumpBottom()
                }
            })
        }
        component.addMouseWheelListener(MouseWheelListener { user = true })
        component.verticalScrollBar.addMouseListener(object : MouseAdapter() {
            override fun mousePressed(e: MouseEvent) {
                user = true
            }
        })
        component.verticalScrollBar.addAdjustmentListener { onScroll() }
        root.addOverlay(jump) { _, child ->
            val size = child.preferredSize
            val gap = UiStyle.Gap.pad()
            Rectangle(
                host.x + host.width - size.width - gap,
                host.y + host.height - size.height - gap,
                size.width,
                size.height,
            )
        }
    }

    @RequiresEdt
    fun show(panel: JPanel) {
        if (component.viewport.view === panel) return
        (panel as? SessionEditorStyleTarget)?.applyStyle(style)
        component.viewport.setView(panel)
        component.repaint()
        updateJump()
    }

    @RequiresEdt
    fun atBottom(): Boolean {
        return when {
            component.viewport.view !== messages -> tail
            !tail -> false
            else -> near()
        }
    }

    @RequiresEdt
    fun followBottom(follow: Boolean) {
        if (!follow) {
            seq++
            updateJump()
            return
        }
        user = false
        pause = false
        tail = true
        stable = -1
        auto = true
        show(messages)
        auto = false
        val id = ++seq
        if (SwingUtilities.isEventDispatchThread()) {
            followPass(id, FOLLOW_PASSES)
            return
        }
        ApplicationManager.getApplication().invokeLater {
            followPass(id, FOLLOW_PASSES)
        }
    }

    @RequiresEdt
    fun followTail() {
        followBottom(component.viewport.view === messages && tail)
    }

    @RequiresEdt
    fun scrollMessageBottom(id: String): Boolean {
        val target = messages.findMessage(id) ?: return false
        if (!target.isVisible) return false
        user = false
        pause = false
        stable = -1
        auto = true
        show(messages)
        auto = false
        val gen = ++seq
        if (SwingUtilities.isEventDispatchThread()) {
            messagePass(gen, id, FOLLOW_PASSES)
            return true
        }
        ApplicationManager.getApplication().invokeLater {
            messagePass(gen, id, FOLLOW_PASSES)
        }
        return true
    }

    @RequiresEdt
    fun following(): Boolean {
        return component.viewport.view === messages && tail
    }

    @RequiresEdt
    fun preserve(anchor: JComponent, action: () -> Unit) {
        if (component.viewport.view !== messages) {
            action()
            return
        }
        val pos = SwingUtilities.convertPoint(anchor, Point(0, 0), messages)
        val delta = pos.y - component.viewport.viewPosition.y
        seq++
        stable = -1
        user = false
        pause = false
        auto = true
        try {
            action()
            layoutScroll()
            val next = SwingUtilities.convertPoint(anchor, Point(0, 0), messages)
            val y = (next.y - delta).coerceIn(0, bottom())
            component.viewport.viewPosition = Point(0, y)
            bar.value = y
        } finally {
            auto = false
        }
        tail = atBottom()
        syncValue()
        updateJump()
        if (tail) {
            stable = -1
            seq++
        }
    }

    @RequiresEdt
    fun openBottom(done: () -> Unit) {
        opening = true
        stable = -1
        user = false
        pause = false
        tail = true
        auto = true
        show(messages)
        auto = false
        val id = ++seq
        ApplicationManager.getApplication().invokeLater {
            openPass(id, OPEN_PASSES, done)
        }
    }

    @RequiresEdt
    fun refresh() {
        updateJump()
    }

    @RequiresEdt
    fun setQuestionPending(value: Boolean) {
        if (question == value) return
        question = value
        syncIcon()
    }

    @RequiresEdt
    fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        component.background = style.editorBackground
        component.viewport.background = style.editorBackground
        syncIcon()
        messages.applyStyle(style)
        val view = component.viewport.view
        if (view !== messages) (view as? SessionEditorStyleTarget)?.applyStyle(style)
        refresh()
    }

    @RequiresEdt
    private fun syncIcon() {
        jump.icon = ScrollButtonIcon.create(question)
        jump.toolTipText = KiloBundle.message(if (question) "session.scroll.question" else "session.scroll.bottom")
    }

    @RequiresEdt
    private fun jumpBottom() {
        opening = false
        stable = -1
        user = false
        pause = false
        tail = true
        auto = true
        show(messages)
        auto = false
        val id = ++seq
        ApplicationManager.getApplication().invokeLater {
            followPass(id, FOLLOW_PASSES)
        }
    }

    @RequiresEdt
    private fun followPass(id: Int, remaining: Int) {
        if (id != seq || !tail) return
        auto = true
        val prev = bottom()
        try {
            layoutScroll()
            scrollToBottom()
            updateJump()
        } finally {
            auto = false
        }
        syncValue()
        if (remaining <= 0) {
            stable = -1
            return
        }
        val next = bottom()
        val left = if (next == prev && next == stable) remaining - 1 else FOLLOW_PASSES
        stable = next
        ApplicationManager.getApplication().invokeLater {
            followPass(id, left)
        }
    }

    @RequiresEdt
    private fun openPass(id: Int, remaining: Int, done: () -> Unit) {
        if (id != seq) {
            opening = false
            stable = -1
            return
        }
        auto = true
        val prev = bottom()
        try {
            tail = true
            layoutScroll()
            scrollToBottom()
            updateJump()
        } finally {
            auto = false
        }
        syncValue()
        if (remaining <= 0) {
            opening = false
            stable = -1
            done()
            return
        }
        val next = bottom()
        val left = if (next == prev && next == stable) remaining - 1 else OPEN_PASSES
        stable = next
        ApplicationManager.getApplication().invokeLater {
            openPass(id, left, done)
        }
    }

    @RequiresEdt
    private fun messagePass(id: Int, message: String, remaining: Int) {
        if (id != seq) return
        val target = messages.findMessage(message)
        if (target == null || !target.isVisible) {
            stable = -1
            updateJump()
            return
        }
        auto = true
        try {
            layoutScroll()
            val y = messageBottom(target)
            component.viewport.viewPosition = Point(0, y)
            bar.value = y
            tail = near()
            updateJump()
        } finally {
            auto = false
        }
        syncValue()
        if (remaining <= 0) {
            stable = -1
            return
        }
        val next = messageBottom(target)
        val left = if (next == stable) remaining - 1 else FOLLOW_PASSES
        stable = next
        ApplicationManager.getApplication().invokeLater {
            messagePass(id, message, left)
        }
    }

    @RequiresEdt
    private fun layoutScroll() {
        root.validate()
    }

    @RequiresEdt
    private fun scrollToBottom() {
        val view = component.viewport.view ?: return
        val y = (view.height - component.viewport.extentSize.height).coerceAtLeast(0)
        component.viewport.viewPosition = Point(0, y)
        (view as? JComponent)?.scrollRectToVisible(Rectangle(0, view.height.coerceAtLeast(1) - 1, 1, 1))
        val bar = component.verticalScrollBar
        bar.value = bottom()
    }

    @RequiresEdt
    private fun messageBottom(target: JComponent): Int {
        val point = SwingUtilities.convertPoint(target, Point(0, target.height.coerceAtLeast(1)), messages)
        val extent = component.viewport.extentSize.height
        return (point.y - extent).coerceIn(0, bottom())
    }

    @RequiresEdt
    private fun bottom(): Int {
        val bar = component.verticalScrollBar
        return (bar.maximum - bar.visibleAmount).coerceAtLeast(bar.minimum)
    }

    @RequiresEdt
    private fun near(): Boolean {
        val bar = component.verticalScrollBar
        return bar.maximum <= bar.visibleAmount || bar.value + bar.visibleAmount >= bar.maximum - JBUI.scale(THRESHOLD)
    }

    @RequiresEdt
    private fun onScroll() {
        val prev = value
        val moved = bar.value != value
        val down = bar.value > value
        syncValue()
        if (moved) onScroll?.invoke()
        if (auto || opening) {
            updateJump()
            return
        }
        if (component.viewport.view === messages) {
            val bottom = near()
            if (bottom) {
                if (user && moved && !down) {
                    tail = false
                    pause = true
                } else if (!tail && !user) {
                    if (moved) {
                        auto = true
                        try {
                            bar.value = prev.coerceIn(bar.minimum, bottom())
                        } finally {
                            auto = false
                        }
                        syncValue()
                    }
                    tail = false
                } else if (pause && !user) {
                    tail = false
                } else {
                    tail = true
                    pause = false
                }
                user = false
                updateJump()
                return
            }
            if (tail && !user && !moved) {
                user = false
                followBottom(true)
                return
            }
            tail = false
            pause = false
            user = false
            seq++
        }
        updateJump()
    }

    @RequiresEdt
    private fun updateJump() {
        val visible = component.viewport.view === messages && !atBottom()
        if (jump.isVisible == visible) return
        jump.isVisible = visible
        root.overlay.revalidate()
        root.overlay.repaint()
    }

    @RequiresEdt
    private fun syncValue() {
        value = bar.value
    }
}
