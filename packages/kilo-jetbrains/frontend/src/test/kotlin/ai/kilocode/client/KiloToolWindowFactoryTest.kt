package ai.kilocode.client

import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.SidePanelMode
import ai.kilocode.client.agentManager.applySidePanelMode
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.util.edtWait
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.content.ContentFactory
import javax.swing.JPanel

class KiloToolWindowFactoryTest : BasePlatformTestCase() {
    fun `test content labels are short`() {
        assertEquals("Chat", KiloBundle.message("sidePanel.mode.branch"))
        assertEquals("Agents", KiloBundle.message("sidePanel.mode.agentManager"))
    }

    fun `test content records side panel mode`() = edtWait {
        val content = ContentFactory.getInstance().createContent(JPanel(), "Chat", false)

        content.applySidePanelMode(SidePanelMode.CHAT)

        assertEquals(SidePanelMode.CHAT, content.getUserData(SidePanelKeys.CONTENT_MODE))
    }
}
