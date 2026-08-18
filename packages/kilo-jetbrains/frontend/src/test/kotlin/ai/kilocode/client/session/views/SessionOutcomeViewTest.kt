package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Outcome
import ai.kilocode.client.session.model.OutcomeTone
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import java.awt.Container
import javax.swing.Icon
import javax.swing.ScrollPaneConstants

@Suppress("UnstableApiUsage")
class SessionOutcomeViewTest : BasePlatformTestCase() {

    fun `test view is initially hidden`() {
        edt {
            val view = SessionOutcomeView()
            assertFalse(view.isVisible)
        }
    }

    fun `test showError renders title and message`() {
        edt {
            val view = SessionOutcomeView()
            view.showError("OpenRouter balance is too low", "APIError")

            assertTrue(view.isVisible)
            assertNotNull(findText(view, KiloBundle.message("session.error.title")))
            assertNotNull(findText(view, "OpenRouter balance is too low"))
        }
    }

    fun `test showError renders message in five line scroll pane`() {
        edt {
            val view = SessionOutcomeView()
            val msg = (1..9).joinToString("\n") { idx -> "line $idx" }
            view.showError(msg, "APIError")

            val pane = errorScroll(view, msg)
            val area = pane.viewport.view as JBTextArea
            val line = area.getFontMetrics(area.font).height
            val chrome = pane.insets.top + pane.insets.bottom +
                (pane.viewportBorder?.getBorderInsets(pane)?.let { it.top + it.bottom } ?: 0) +
                area.insets.top + area.insets.bottom

            assertEquals(msg, area.text)
            assertFalse(area.isOpaque)
            assertFalse(pane.isOpaque)
            assertFalse(pane.viewport.isOpaque)
            assertEquals(0, area.insets.top)
            assertEquals(0, area.insets.bottom)
            assertEquals(UiStyle.Gap.pad(), area.insets.left)
            assertEquals(UiStyle.Gap.pad(), area.insets.right)
            assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, pane.horizontalScrollBarPolicy)
            assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED, pane.verticalScrollBarPolicy)
            assertTrue(pane.preferredSize.height <= line * SessionUiStyle.View.Outcome.ERROR_LINES + chrome)
            assertTrue(area.preferredSize.height > pane.preferredSize.height - chrome)
        }
    }

    fun `test showError shrinks scroll pane for short messages`() {
        edt {
            val view = SessionOutcomeView()
            val msg = "line 1\nline 2"
            view.showError(msg, "APIError")

            val pane = errorScroll(view, msg)
            val area = pane.viewport.view as JBTextArea
            val chrome = pane.insets.top + pane.insets.bottom +
                (pane.viewportBorder?.getBorderInsets(pane)?.let { it.top + it.bottom } ?: 0) +
                area.insets.top + area.insets.bottom

            assertEquals(area.preferredSize.height + chrome, pane.preferredSize.height)
        }
    }

    fun `test showOutcome renders interrupted copy and warning icon`() {
        edt {
            val view = SessionOutcomeView()
            view.showOutcome(Outcome.INTERRUPTED, OutcomeTone.WARNING)

            assertTrue(view.isVisible)
            assertNotNull(findText(view, KiloBundle.message("session.outcome.interrupted.title")))
            assertNotNull(findText(view, KiloBundle.message("session.outcome.interrupted.description")))
            assertIcons(view, AllIcons.General.Warning)
        }
    }

    fun `test showOutcome updates without stale text`() {
        edt {
            val view = SessionOutcomeView()
            view.showOutcome(Outcome.INTERRUPTED, OutcomeTone.WARNING)
            view.showOutcome(Outcome.FAILED, OutcomeTone.CRITICAL)

            assertNotNull(findText(view, KiloBundle.message("session.outcome.failed.title")))
            assertNotNull(findText(view, KiloBundle.message("session.outcome.failed.description")))
            assertNull(findText(view, KiloBundle.message("session.outcome.interrupted.description")))
            assertIcons(view, AllIcons.General.Error)
        }
    }

    fun `test showOutcome removes stale error content`() {
        edt {
            val view = SessionOutcomeView()
            view.showError("Provider balance is too low", "APIError")
            view.showOutcome(Outcome.INTERRUPTED, OutcomeTone.WARNING)

            assertNull(findText(view, "Provider balance is too low"))
            assertNull(findErrorScroll(view, "Provider balance is too low"))
            assertNotNull(findText(view, KiloBundle.message("session.outcome.interrupted.description")))
        }
    }

    fun `test hideView makes view invisible`() {
        edt {
            val view = SessionOutcomeView()
            view.showError("Request failed", "APIError")
            view.hideView()

            assertFalse(view.isVisible)
        }
    }

    fun `test description uses secondary font not editor font family`() {
        edt {
            val view = SessionOutcomeView()
            view.showError("Provider balance is too low", "APIError")
            val style = SessionEditorStyle.create(family = "Courier New", size = 20)
            view.applyStyle(style)

            val body = errorScroll(view, "Provider balance is too low").viewport.view as JBTextArea
            assertEquals("Provider balance is too low", body.text)
            assertFalse(body.font.name == "Courier New")
            assertEquals(style.transcriptFont, body.font)
        }
    }

    fun `test error content extends to card side edges`() {
        edt {
            val view = SessionOutcomeView()
            view.showError("Provider balance is too low", "APIError")

            val ins = view.border.getBorderInsets(view)
            assertEquals(0, ins.left)
            assertEquals(0, ins.right)
            assertEquals(UiStyle.Gap.lg(), ins.bottom)
            assertEquals(UiStyle.Gap.pad(), headerBorder(view).left)
        }
    }

    private fun findText(root: Container, text: String) = findAll<JBTextArea>(root).firstOrNull { it.text == text }

    private fun headerBorder(root: SessionOutcomeView) = ((root.layout as java.awt.BorderLayout).getLayoutComponent(java.awt.BorderLayout.NORTH) as Container)
        .let { (it as javax.swing.JPanel).border.getBorderInsets(it) }

    private fun assertIcons(root: Container, icon: Icon) {
        val icons = findAll<JBLabel>(root).mapNotNull { it.icon }
        assertTrue(icons.isNotEmpty())
        assertTrue(icons.all { it == icon })
    }

    private fun errorScroll(root: Container, text: String) = findErrorScroll(root, text)!!

    private fun findErrorScroll(root: Container, text: String) = findAll<JBScrollPane>(root).firstOrNull { pane ->
        (pane.viewport.view as? JBTextArea)?.text == text
    }

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private inline fun <reified T> findAll(root: Container): List<T> = findAllCls(root, T::class.java)

    private fun <T> findAllCls(root: Container, cls: Class<T>): List<T> {
        val result = mutableListOf<T>()
        if (cls.isInstance(root)) result.add(cls.cast(root))
        for (child in root.components) {
            if (cls.isInstance(child)) result.add(cls.cast(child))
            if (child is Container) result.addAll(findAllCls(child, cls))
        }
        return result
    }
}
