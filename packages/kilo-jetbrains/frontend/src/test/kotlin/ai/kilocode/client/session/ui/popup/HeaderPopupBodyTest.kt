package ai.kilocode.client.session.ui.popup

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import javax.swing.JPanel

class HeaderPopupBodyTest : BasePlatformTestCase() {

    fun `test tall popup content scrolls and caps height`() {
        val tall = JPanel().apply {
            preferredSize = Dimension(JBUI.scale(200), JBUI.scale(SessionUiStyle.View.Popup.MAX_HEIGHT * 3))
        }
        val owner = Disposer.newDisposable("popup body")
        Disposer.register(testRootDisposable, owner)
        val body = HeaderPopupBody(tall, owner, UIUtil.getPanelBackground())

        val scroll = descendants(body.component).filterIsInstance<JBScrollPane>().single()
        assertSame(tall, scroll.viewport.view)
        assertEquals(JBUI.scale(SessionUiStyle.View.Popup.MAX_HEIGHT), body.component.preferredSize.height)
    }

    fun `test short popup content is not capped`() {
        val short = JPanel().apply {
            preferredSize = Dimension(JBUI.scale(200), JBUI.scale(40))
        }
        val owner = Disposer.newDisposable("popup body")
        Disposer.register(testRootDisposable, owner)
        val body = HeaderPopupBody(short, owner, UIUtil.getPanelBackground())

        assertEquals(JBUI.scale(40), body.component.preferredSize.height)
    }

    fun `test fitWithin caps the body to the space beside the chat`() {
        val wide = JPanel().apply {
            preferredSize = Dimension(
                JBUI.scale(SessionUiStyle.View.Popup.MAX_WIDTH),
                JBUI.scale(SessionUiStyle.View.Popup.MAX_HEIGHT),
            )
        }
        val body = HeaderPopupBody(wide, owner(), UIUtil.getPanelBackground())

        body.fitWithin(JBUI.scale(120), JBUI.scale(90))

        assertEquals(JBUI.scale(120), body.component.preferredSize.width)
        assertEquals(JBUI.scale(90), body.component.preferredSize.height)
    }

    fun `test fitWithin wins over the opt-in floor width`() {
        val wide = JPanel().apply {
            preferredSize = Dimension(JBUI.scale(SessionUiStyle.View.Popup.MAX_WIDTH), JBUI.scale(80))
        }
        // A body that asks for a floor width still has to fit its side, otherwise the balloon would
        // re-point above or below the chat.
        val body = HeaderPopupBody(wide, owner(), UIUtil.getPanelBackground(), minWidth = JBUI.scale(300))

        body.fitWithin(JBUI.scale(100), JBUI.scale(400))

        assertEquals(JBUI.scale(100), body.component.preferredSize.width)
    }

    fun `test a row body asks for the width its children need side by side, up to the max`() {
        val row = BorderLayoutPanel().apply {
            addToLeft(box(60))
            addToCenter(box(200))
            addToRight(box(40))
        }

        // A header line carries a state pill, a title, and a toolbar: the widest child (200) is not the
        // width it needs, and a body measured that way clips its own title.
        assertEquals(JBUI.scale(300), HeaderPopupBody(row, owner(), UIUtil.getPanelBackground(), maxWidth = 600).component.preferredSize.width)
        // The cap is still the ceiling, whichever way the width was measured.
        assertEquals(JBUI.scale(120), HeaderPopupBody(row, owner(), UIUtil.getPanelBackground(), maxWidth = 120).component.preferredSize.width)
    }

    fun `test a sideways scrolling body reserves the bar and a band around it`() {
        val wide = JPanel().apply { preferredSize = Dimension(JBUI.scale(900), JBUI.scale(80)) }
        val plain = HeaderPopupBody(wide, owner(), UIUtil.getPanelBackground(), maxWidth = 300)
        val body = HeaderPopupBody(wide, owner(), UIUtil.getPanelBackground(), maxWidth = 300, horizontal = true)
        val scroll = descendants(body.component).filterIsInstance<JBScrollPane>().single()

        val pad = JBUI.scale(SessionUiStyle.View.Popup.SCROLL_PADDING) * 2
        val bar = scroll.horizontalScrollBar.preferredSize.height
        // The content is wider than the cap, so the bar shows: the body claims its row plus the band, or
        // the viewport shrinks under it and the popup grows a vertical scrollbar it does not need.
        assertEquals(JBUI.scale(80) + pad + bar, body.component.preferredSize.height)
        // Popups that never scroll sideways keep their exact content height.
        assertEquals(JBUI.scale(80), plain.component.preferredSize.height)
    }

    fun `test a body that fits reserves the band but no bar row`() {
        val narrow = JPanel().apply { preferredSize = Dimension(JBUI.scale(200), JBUI.scale(80)) }
        val body = HeaderPopupBody(narrow, owner(), UIUtil.getPanelBackground(), maxWidth = 300, horizontal = true)

        // Nothing to scroll to, so the space stays symmetric instead of leaving a gap for a bar that
        // never appears.
        assertEquals(JBUI.scale(80) + JBUI.scale(SessionUiStyle.View.Popup.SCROLL_PADDING) * 2, body.component.preferredSize.height)
    }

    private fun box(width: Int) = JPanel().apply { preferredSize = Dimension(JBUI.scale(width), JBUI.scale(20)) }

    private fun owner() = Disposer.newDisposable("popup body").also { Disposer.register(testRootDisposable, it) }

    private fun descendants(root: Component): List<Component> {
        val out = mutableListOf<Component>()
        fun visit(node: Component) {
            out.add(node)
            if (node is Container) node.components.forEach(::visit)
        }
        visit(root)
        return out
    }
}
