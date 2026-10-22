package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.SessionState
import com.intellij.testFramework.fixtures.BasePlatformTestCase
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

    fun `test long retry wraps and stays centered in narrow panel`() {
        val panel = LoadingPanel()
        panel.setState(SessionState.Retry(
            "The request limited providers for this model and they are currently at capacity. Add more providers to continue.",
            attempt = 0,
            next = 0L,
        ))

        panel.setSize(800, 300)
        layout(panel)
        val wide = label(panel).preferredSize.height
        panel.setSize(180, 300)
        layout(panel)
        val narrow = label(panel).preferredSize.height

        assertTrue("narrow loading status should use more than one line", narrow > wide)
        assertEquals(180, label(panel).width)
        assertTrue(label(panel).text.contains("text-align:center"))
    }

    fun `test status html escapes provider text and preserves line breaks`() {
        val panel = LoadingPanel()
        val text = "The <model> route is at A&B capacity\nAdd another provider"

        panel.setState(SessionState.Offline(text, requestId = "req1"))

        assertEquals(text, panel.labelText())
        assertTrue(label(panel).isAllowAutoWrapping)
        assertTrue(label(panel).text.contains("&lt;model&gt;"))
        assertTrue(label(panel).text.contains("A&amp;B"))
        assertTrue(label(panel).text.contains("<br"))
    }

    private fun label(root: Container): StatusLabel {
        for (child in root.components) {
            if (child is StatusLabel) return child
            if (child is Container) {
                val found = runCatching { label(child) }.getOrNull()
                if (found != null) return found
            }
        }
        error("missing label")
    }

    private fun layout(root: Container) {
        root.doLayout()
        for (child in root.components) {
            if (child is Container) layout(child)
        }
    }
}
