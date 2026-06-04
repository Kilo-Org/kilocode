package ai.kilocode.client.session.scroll

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
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

    val component = JBScrollPane(body).apply {
        border = JBUI.Borders.empty()
        verticalScrollBarPolicy = JBScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED
        horizontalScrollBarPolicy = JBScrollPane.HORIZONTAL_SCROLLBAR_NEVER
    }

    internal val bar: JScrollBar get() = component.verticalScrollBar
    internal val jump: JBLabel
    val view: JComponent? get() = component.viewport.view as? JComponent

    private var style = SessionEditorStyle.current()
    private var tail = true
    private var auto = false
    private var opening = false
    private var stable = -1
    private var seq = 0
    private var user = false
    private var value = 0
    private var question = false
    private var restoring = false

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
        component.viewport.addChangeListener { onViewport() }
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
        val bar = component.verticalScrollBar
        return when {
            component.viewport.view !== messages -> tail
            bar.maximum <= bar.visibleAmount -> true
            else -> bar.value + bar.visibleAmount >= bar.maximum - JBUI.scale(THRESHOLD)
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
    fun following(): Boolean {
        return component.viewport.view === messages && tail
    }

    @RequiresEdt
    fun openBottom(done: () -> Unit) {
        opening = true
        stable = -1
        user = false
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
        component.background = SessionUiStyle.View.transcript()
        component.viewport.background = SessionUiStyle.View.transcript()
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
    private fun onViewport() {
        if (restoring || auto || opening || user || tail || component.viewport.view !== messages) return
        val y = value.coerceIn(0, bottom())
        if (component.viewport.viewPosition.y == y && bar.value == y) return
        restoring = true
        try {
            component.viewport.viewPosition = Point(0, y)
            bar.value = y
        } finally {
            restoring = false
        }
        updateJump()
    }

    @RequiresEdt
    private fun bottom(): Int {
        val bar = component.verticalScrollBar
        return (bar.maximum - bar.visibleAmount).coerceAtLeast(bar.minimum)
    }

    @RequiresEdt
    private fun onScroll() {
        val moved = bar.value != value
        syncValue()
        if (auto || opening) {
            updateJump()
            return
        }
        if (component.viewport.view === messages) {
            val bottom = atBottom()
            if (bottom) {
                tail = true
                user = false
                updateJump()
                return
            }
            if (tail && (!user || !moved)) {
                user = false
                followBottom(true)
                return
            }
            tail = false
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
