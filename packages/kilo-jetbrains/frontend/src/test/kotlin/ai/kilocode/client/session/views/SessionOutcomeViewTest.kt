package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Outcome
import ai.kilocode.client.session.model.OutcomeTone
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextArea
import java.awt.Container

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

    fun `test showOutcome renders interrupted copy and warning icon`() {
        edt {
            val view = SessionOutcomeView()
            view.showOutcome(Outcome.INTERRUPTED, OutcomeTone.WARNING)

            assertTrue(view.isVisible)
            assertNotNull(findText(view, KiloBundle.message("session.outcome.interrupted.title")))
            assertNotNull(findText(view, KiloBundle.message("session.outcome.interrupted.description")))
            assertTrue(findAll<JBLabel>(view).any { it.icon != null })
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

            val desc = findText(view, "Provider balance is too low")
            assertNotNull(desc)
            assertFalse(desc!!.font.name == "Courier New")
            assertEquals(SessionUiStyle.Text.Secondary.font(style), desc.font)
        }
    }

    private fun findText(root: Container, text: String) = findAll<JBTextArea>(root).firstOrNull { it.text == text }

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
