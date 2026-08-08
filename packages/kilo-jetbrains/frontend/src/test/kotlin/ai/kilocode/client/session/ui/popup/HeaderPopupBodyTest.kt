package ai.kilocode.client.session.ui.popup

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
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
