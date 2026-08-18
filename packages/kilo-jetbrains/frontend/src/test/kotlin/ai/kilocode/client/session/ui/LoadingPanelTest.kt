package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.SessionState
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import java.awt.Container

@Suppress("UnstableApiUsage")
class LoadingPanelTest : BasePlatformTestCase() {

    fun `test loading retry and offline update retained label`() {
        val panel = LoadingPanel()
        val label = label(panel)

        panel.setState(SessionState.Loading)
        assertEquals(KiloBundle.message("session.empty.loading"), panel.labelText())

        panel.setState(SessionState.Retry("Rate limited", attempt = 1, next = 0L))
        assertEquals("Rate limited", panel.labelText())

        panel.setState(SessionState.Offline("Computer appears offline", requestId = "req1"))
        assertEquals("Computer appears offline", panel.labelText())
        assertSame(label, label(panel))
    }

    fun `test blank retry and offline use fallback text`() {
        val panel = LoadingPanel()

        panel.setState(SessionState.Retry("", attempt = 0, next = 0L))
        assertEquals(KiloBundle.message("session.status.retry"), panel.labelText())

        panel.setState(SessionState.Offline("", requestId = "req1"))
        assertEquals(KiloBundle.message("session.status.offline"), panel.labelText())
    }

    private fun label(root: Container): JBLabel {
        for (child in root.components) {
            if (child is JBLabel) return child
            if (child is Container) {
                val found = runCatching { label(child) }.getOrNull()
                if (found != null) return found
            }
        }
        error("missing label")
    }
}
