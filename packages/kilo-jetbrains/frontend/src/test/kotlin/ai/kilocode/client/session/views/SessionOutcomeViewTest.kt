package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Outcome
import ai.kilocode.client.session.ui.SessionLayout
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
import java.awt.Dimension
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import javax.swing.Icon
import javax.swing.JButton
import javax.swing.JPanel
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

    fun `test showOutcome renders interrupted note without icon`() {
        edt {
            val view = SessionOutcomeView()
            view.showOutcome(Outcome.INTERRUPTED)

            assertTrue(view.isVisible)
            assertNotNull(findText(view, KiloBundle.message("session.outcome.interrupted.note")))
            assertTrue(findAll<JBLabel>(view).none { it.icon != null && it.isVisible })
        }
    }

    fun `test showOutcome updates without stale text`() {
        edt {
            val view = SessionOutcomeView()
            view.showOutcome(Outcome.INTERRUPTED)
            view.showOutcome(Outcome.FAILED)

            assertNotNull(findText(view, KiloBundle.message("session.outcome.failed.title")))
            assertNotNull(findText(view, KiloBundle.message("session.outcome.failed.description")))
            assertNull(findText(view, KiloBundle.message("session.outcome.interrupted.note")))
            assertIcons(view, AllIcons.General.Error)
        }
    }

    fun `test showOutcome removes stale error content`() {
        edt {
            val view = SessionOutcomeView()
            view.showError("Provider balance is too low", "APIError")
            view.showOutcome(Outcome.INTERRUPTED)

            assertNull(findText(view, "Provider balance is too low"))
            assertNull(findErrorScroll(view, "Provider balance is too low"))
            assertNotNull(findText(view, KiloBundle.message("session.outcome.interrupted.note")))
        }
    }

    fun `test showError surfaces error kind`() {
        edt {
            val view = SessionOutcomeView()
            view.showError("Provider balance is too low", "APIError")

            assertNotNull(findText(view, "APIError"))
        }
    }

    // ------ retry action ------

    fun `test error card offers retry`() {
        edt {
            var clicked = 0
            val view = SessionOutcomeView(retry = { clicked++ })
            view.showError("Provider balance is too low", "APIError")

            val button = retryButton(view)
            assertNotNull("Error card should offer Retry", button)
            button!!.doClick()
            assertEquals(1, clicked)
        }
    }

    fun `test failed outcome offers retry`() {
        edt {
            val view = SessionOutcomeView(retry = {})
            view.showOutcome(Outcome.FAILED)

            assertNotNull("Failed outcome should offer Retry", retryButton(view))
        }
    }

    fun `test interrupted note offers no retry`() {
        edt {
            val view = SessionOutcomeView(retry = {})
            view.showOutcome(Outcome.INTERRUPTED)

            assertNull("A user stop is not a failure and must not offer Retry", retryButton(view))
        }
    }

    fun `test readonly outcome view offers no retry`() {
        edt {
            val view = SessionOutcomeView(retry = null)
            view.showError("Provider balance is too low", "APIError")

            assertNull("Readonly sessions cannot retry", retryButton(view))
        }
    }

    fun `test error card hides retry when the transcript has nothing to replay`() {
        edt {
            val view = SessionOutcomeView(retry = {}, retryable = { false })
            view.showError("invalid kilo.json", "UnknownError")

            assertNull("A dead Retry must not be painted", retryButton(view))
        }
    }

    fun `test failed outcome hides retry when the transcript has nothing to replay`() {
        edt {
            val view = SessionOutcomeView(retry = {}, retryable = { false })
            view.showOutcome(Outcome.FAILED)

            assertNull(retryButton(view))
        }
    }

    fun `test retry appears once the transcript becomes replayable`() {
        edt {
            var replayable = false
            val view = SessionOutcomeView(retry = {}, retryable = { replayable })
            view.showError("Provider balance is too low", "APIError")
            assertNull(retryButton(view))

            replayable = true
            view.showError("Provider balance is too low", "APIError")

            val buttons = findAll<JButton>(view).filter { it.text == KiloBundle.message("session.outcome.retry") }
            assertEquals("Exactly one live Retry button", 1, buttons.size)
        }
    }

    fun `test toggling outcomes does not accumulate retry buttons`() {
        edt {
            var clicked = 0
            val view = SessionOutcomeView(retry = { clicked++ })
            repeat(3) {
                view.showOutcome(Outcome.FAILED)
                view.showOutcome(Outcome.INTERRUPTED)
            }
            assertNull("The note detaches the footer entirely", retryButton(view))
            view.showOutcome(Outcome.FAILED)

            val buttons = findAll<JButton>(view).filter { it.text == KiloBundle.message("session.outcome.retry") }
            assertEquals("Exactly one live Retry button", 1, buttons.size)
            buttons.single().doClick()
            assertEquals("The live button is wired to the current handler", 1, clicked)
        }
    }

    private fun retryButton(root: Container) =
        findAll<JButton>(root).firstOrNull { it.text == KiloBundle.message("session.outcome.retry") }

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

    fun `test realized error body preferred size does not resize text area`() {
        edt {
            val msg = "OpenRouter balance is too low. ".repeat(20)
            val view = realized(msg)
            val pane = errorScroll(view, msg)
            val area = pane.viewport.view as JBTextArea
            val size = Dimension(area.size)

            area.preferredSize
            pane.preferredSize

            assertEquals(size, area.size)
        }
    }

    fun `test realized error body does not fire resize events while measuring`() {
        edt {
            val msg = "OpenRouter balance is too low. ".repeat(20)
            val view = realized(msg)
            val pane = errorScroll(view, msg)
            val area = pane.viewport.view as JBTextArea
            var count = 0
            area.addComponentListener(object : ComponentAdapter() {
                override fun componentResized(e: ComponentEvent) {
                    count++
                }
            })

            repeat(4) {
                area.preferredSize
                pane.preferredSize
                view.doLayout()
                pane.doLayout()
                pane.viewport.doLayout()
            }

            assertEquals(0, count)
        }
    }

    fun `test realized error card caps height at five text lines`() {
        edt {
            val msg = (1..12).joinToString("\n") { idx -> "line $idx" }
            val view = realized(msg)
            val pane = errorScroll(view, msg)
            val area = pane.viewport.view as JBTextArea
            val line = area.getFontMetrics(area.font).height
            val chrome = chrome(pane, area)

            assertEquals(line * SessionUiStyle.View.Outcome.ERROR_LINES + chrome, pane.height)
            assertTrue(area.preferredSize.height > pane.viewport.extentSize.height)
        }
    }

    fun `test realized error card shrinks for short messages`() {
        edt {
            val msg = "line 1\nline 2"
            val view = realized(msg)
            val pane = errorScroll(view, msg)
            val area = pane.viewport.view as JBTextArea
            val chrome = chrome(pane, area)

            assertEquals(area.preferredSize.height + chrome, pane.height)
        }
    }

    fun `test long single-line error wraps at card width`() {
        edt {
            val msg = "OpenRouter balance is too low. ".repeat(20)
            val view = realized(msg, 260, 600)
            val pane = errorScroll(view, msg)
            val area = pane.viewport.view as JBTextArea
            val line = area.getFontMetrics(area.font).height

            assertTrue(area.preferredSize.height > line + area.insets.top + area.insets.bottom)
        }
    }

    private fun findText(root: Container, text: String) = findAll<JBTextArea>(root).firstOrNull { it.text == text }

    private fun realized(text: String, width: Int = 640, height: Int = 480): SessionOutcomeView {
        val view = SessionOutcomeView()
        view.showError(text, "APIError")
        val root = JPanel(SessionLayout())
        root.setSize(width, height)
        root.add(view)
        root.addNotify()
        repeat(4) {
            layoutTree(root)
        }
        return view
    }

    private fun layoutTree(root: Container) {
        root.doLayout()
        for (child in root.components) {
            if (child is Container) layoutTree(child)
        }
    }

    private fun chrome(pane: JBScrollPane, area: JBTextArea): Int {
        val border = pane.viewportBorder?.getBorderInsets(pane)
        return pane.insets.top + pane.insets.bottom +
            (border?.let { it.top + it.bottom } ?: 0) +
            area.insets.top + area.insets.bottom
    }

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
        // Only recurse. Matching a child here as well would double-count any hit that is itself a
        // Container (every Swing component is), because the recursive call re-checks it as its own root.
        for (child in root.components) {
            if (child is Container) result.addAll(findAllCls(child, cls))
        }
        return result
    }
}
