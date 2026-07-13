package ai.kilocode.client.session.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBLabel
import java.awt.Container

@Suppress("UnstableApiUsage")
class RevertProgressTest : BasePlatformTestCase() {

    fun `test text update retains label`() {
        val view = RevertProgress {}
        val label = label(view)

        view.setText("Rolling back...")
        assertEquals("Rolling back...", label.text)

        view.setText("Redoing...")
        assertEquals("Redoing...", label.text)
        assertSame(label, label(view))
    }

    fun `test cancel invokes callback`() {
        var done = false
        val view = RevertProgress { done = true }

        cancel(view).doClick()

        assertTrue(done)
    }

    private fun label(root: Container): JBLabel {
        for (child in root.components) {
            if (child is JBLabel && child.icon == null) return child
            if (child is Container) {
                val found = runCatching { label(child) }.getOrNull()
                if (found != null) return found
            }
        }
        error("missing label")
    }

    private fun cancel(root: Container): ActionLink {
        for (child in root.components) {
            if (child is ActionLink) return child
            if (child is Container) {
                val found = runCatching { cancel(child) }.getOrNull()
                if (found != null) return found
            }
        }
        error("missing cancel")
    }
}
