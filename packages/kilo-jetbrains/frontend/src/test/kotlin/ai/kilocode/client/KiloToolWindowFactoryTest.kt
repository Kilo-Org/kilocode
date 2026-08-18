package ai.kilocode.client

import ai.kilocode.client.util.edtWait
import com.intellij.icons.AllIcons
import com.intellij.openapi.wm.ToolWindow
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.content.Content
import com.intellij.ui.content.ContentFactory
import java.awt.ComponentOrientation
import javax.swing.JPanel

class KiloToolWindowFactoryTest : BasePlatformTestCase() {
    fun `test agent manager content uses beta badge metadata`() = edtWait {
        val content = ContentFactory.getInstance().createContent(JPanel(), "Agent Manager", false)

        content.applyAgentManagerBetaBadge()

        assertSame(AllIcons.General.Beta, content.icon)
        assertEquals("Agent Manager (Beta)", content.description)
        assertEquals(true, content.getUserData(ToolWindow.SHOW_CONTENT_ICON))
        assertEquals(ComponentOrientation.RIGHT_TO_LEFT, content.getUserData(Content.TAB_LABEL_ORIENTATION_KEY))
    }
}
