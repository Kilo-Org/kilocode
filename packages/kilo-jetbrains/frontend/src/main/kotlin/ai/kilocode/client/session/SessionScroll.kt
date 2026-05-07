package ai.kilocode.client.session

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.SessionStyle
import ai.kilocode.client.session.ui.SessionStyleTarget
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.icons.CachedImageIcon
import com.intellij.ui.svg.SvgAttributePatcher
import com.intellij.util.SVGLoader
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Cursor
import java.awt.Point
import java.awt.Rectangle
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.JScrollBar

private const val ICON_DIGEST = 0x5c011b0bb17L
private const val OPAQUE_ALPHA = 255

internal class SessionScroll(
    private val root: SessionRootPanel,
    private val host: JPanel,
    private val messages: SessionMessageListPanel,
    body: JPanel,
) {
    companion object {
        private val ICON = IconLoader.getIcon("/icons/scroll-bottom.svg", SessionScroll::class.java)
        private const val THRESHOLD = 32
        private const val OPEN_PASSES = 12
    }

    val component = JBScrollPane(body).apply {
        border = JBUI.Borders.empty()
        verticalScrollBarPolicy = JBScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED
        horizontalScrollBarPolicy = JBScrollPane.HORIZONTAL_SCROLLBAR_NEVER
    }

    internal val bar: JScrollBar get() = component.verticalScrollBar
    internal val jump: JBLabel
    val view: JComponent? get() = component.viewport.view as? JComponent

    private var style = SessionStyle.current()
    private var tail = true
    private var auto = false
    private var opening = false
    private var stable = -1
    private var seq = 0

    init {
        jump = JBLabel(patchedIcon(ICON)).apply {
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            toolTipText = KiloBundle.message("session.scroll.bottom")
            isVisible = false
            addMouseListener(object : MouseAdapter() {
                override fun mouseClicked(e: MouseEvent) {
                    jumpBottom()
                }
            })
        }
        component.verticalScrollBar.addAdjustmentListener { onScroll() }
        root.addOverlay(jump) { _, child ->
            val size = child.preferredSize
            val gap = JBUI.scale(UiStyle.Space.PAD)
            Rectangle(
                host.x + host.width - size.width - gap,
                host.y + host.height - size.height - gap,
                size.width,
                size.height,
            )
        }
    }

    fun show(panel: JPanel) {
        if (component.viewport.view === panel) return
        (panel as? SessionStyleTarget)?.applyStyle(style)
        component.viewport.setView(panel)
        component.repaint()
        updateJump()
    }

    fun atBottom(): Boolean {
        val bar = component.verticalScrollBar
        return when {
            component.viewport.view !== messages -> tail
            bar.maximum <= bar.visibleAmount -> true
            else -> bar.value + bar.visibleAmount >= bar.maximum - JBUI.scale(THRESHOLD)
        }
    }

    fun followBottom(follow: Boolean) {
        if (!follow) {
            seq++
            updateJump()
            return
        }
        tail = true
        auto = true
        show(messages)
        auto = false
        followPass(++seq, 2)
    }

    fun openBottom(done: () -> Unit) {
        opening = true
        stable = -1
        tail = true
        auto = true
        show(messages)
        auto = false
        val id = ++seq
        ApplicationManager.getApplication().invokeLater {
            openPass(id, OPEN_PASSES, done)
        }
    }

    fun refresh() {
        updateJump()
    }

    fun applyStyle(style: SessionStyle) {
        this.style = style
        jump.icon = patchedIcon(ICON)
        messages.applyStyle(style)
        val view = component.viewport.view
        if (view !== messages) (view as? SessionStyleTarget)?.applyStyle(style)
        refresh()
    }

    private fun jumpBottom() {
        opening = false
        stable = -1
        tail = true
        auto = true
        show(messages)
        auto = false
        followPass(++seq, 2)
    }

    private fun followPass(id: Int, remaining: Int) {
        if (id != seq || !tail) return
        auto = true
        try {
            layoutScroll()
            scrollToBottom()
            updateJump()
        } finally {
            auto = false
        }
        if (remaining <= 0) return
        ApplicationManager.getApplication().invokeLater {
            followPass(id, remaining - 1)
        }
    }

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

    private fun layoutScroll() {
        root.validate()
    }

    private fun scrollToBottom() {
        val view = component.viewport.view ?: return
        val y = (view.height - component.viewport.extentSize.height).coerceAtLeast(0)
        component.viewport.viewPosition = Point(0, y)
        (view as? JComponent)?.scrollRectToVisible(Rectangle(0, view.height.coerceAtLeast(1) - 1, 1, 1))
        val bar = component.verticalScrollBar
        bar.value = bottom()
    }

    private fun bottom(): Int {
        val bar = component.verticalScrollBar
        return (bar.maximum - bar.visibleAmount).coerceAtLeast(bar.minimum)
    }

    private fun onScroll() {
        if (auto || opening) {
            updateJump()
            return
        }
        if (component.viewport.view === messages) {
            tail = atBottom()
            if (!tail) seq++
        }
        updateJump()
    }

    private fun updateJump() {
        val visible = component.viewport.view === messages && !atBottom()
        if (jump.isVisible == visible) return
        jump.isVisible = visible
        root.overlay.revalidate()
        root.overlay.repaint()
    }
}

private fun patchedIcon(icon: Icon): Icon {
    val cached = icon as? CachedImageIcon ?: return icon
    return cached.createWithPatcher(object : SVGLoader.SvgElementColorPatcherProvider, SvgAttributePatcher {
        override fun digest(): LongArray {
            val bg = JBUI.CurrentTheme.Button.defaultButtonColorStart().rgb.toLong()
            val fg = JBUI.CurrentTheme.Button.defaultButtonForeground().rgb.toLong()
            return longArrayOf(bg, fg, ICON_DIGEST)
        }

        override fun attributeForPath(path: String) = this

        override fun patchColors(attributes: MutableMap<String, String>) {
            when (attributes["id"]) {
                "ScrollButton.Background" ->
                    set(attributes, "fill", JBUI.CurrentTheme.Button.defaultButtonColorStart())

                "ScrollButton.Foreground" ->
                    set(attributes, "stroke", JBUI.CurrentTheme.Button.defaultButtonForeground())
            }
        }

        private fun set(attributes: MutableMap<String, String>, key: String, color: Color) {
            if (!attributes.containsKey(key) || attributes[key] == "none") return
            attributes[key] = "rgb(${color.red},${color.green},${color.blue})"
            if (color.alpha != OPAQUE_ALPHA) {
                attributes["$key-opacity"] = "${color.alpha / OPAQUE_ALPHA.toFloat()}"
            }
        }
    })
}
