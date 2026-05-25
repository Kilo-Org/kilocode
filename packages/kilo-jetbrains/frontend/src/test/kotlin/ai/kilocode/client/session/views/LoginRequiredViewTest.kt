package ai.kilocode.client.session.views

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBTextArea
import java.awt.Container

@Suppress("UnstableApiUsage")
class LoginRequiredViewTest : BasePlatformTestCase() {

    // ------ title and message rendering ------

    fun `test header title text is in the component tree`() {
        edt {
            val view = LoginRequiredView(openProfile = {}, dismiss = {})
            view.show("Sign in required.")
            val title = findAll<JBTextArea>(view).firstOrNull { it.text.isNotEmpty() && it.font.isBold }
            assertNotNull("Header title text area should be present", title)
        }
    }

    fun `test description message text is in the component tree after show`() {
        edt {
            val view = LoginRequiredView(openProfile = {}, dismiss = {})
            view.show("Sign in required.")
            val desc = findAll<JBTextArea>(view).firstOrNull { it.text == "Sign in required." }
            assertNotNull("Description text area should contain the show message", desc)
        }
    }

    fun `test show updates description without recreating title`() {
        edt {
            val view = LoginRequiredView(openProfile = {}, dismiss = {})
            view.show("First message.")
            val before = findAll<JBTextArea>(view).firstOrNull { it.text == "First message." }
            assertNotNull(before)

            view.show("Second message.")
            val after = findAll<JBTextArea>(view).firstOrNull { it.text == "Second message." }
            assertNotNull("Description should update to second message", after)
            val stale = findAll<JBTextArea>(view).firstOrNull { it.text == "First message." }
            assertNull("Old description text should not remain", stale)
        }
    }

    // ------ open profile button style ------

    fun `test open profile button is primary`() {
        edt {
            val view = LoginRequiredView(openProfile = {}, dismiss = {})
            view.show("Sign in required.")
            val btn = view.openProfileButton()
            assertEquals(true, btn.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY))
        }
    }

    fun `test open profile button uses question surface background`() {
        edt {
            val view = LoginRequiredView(openProfile = {}, dismiss = {})
            view.show("Sign in required.")
            val btn = view.openProfileButton()
            assertEquals(SessionUiStyle.View.surface(), btn.background)
        }
    }

    // ------ dismiss button style ------

    fun `test dismiss button does not have default style key`() {
        edt {
            val view = LoginRequiredView(openProfile = {}, dismiss = {})
            view.show("Sign in required.")
            val btn = view.dismissButton()
            val key = btn.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY)
            assertTrue("Dismiss should not be primary", key == null || key == false)
        }
    }

    fun `test login action buttons share right-aligned footer group`() {
        edt {
            val view = LoginRequiredView(openProfile = {}, dismiss = {})
            view.show("Sign in required.")

            val dismiss = view.dismissButton()
            val open = view.openProfileButton()
            assertSame("Dismiss and open profile should be in the same right-aligned group", dismiss.parent, open.parent)
            assertTrue("Dismiss should appear before open profile", dismiss.parent.components.indexOf(dismiss) < open.parent.components.indexOf(open))
        }
    }

    // ------ callbacks ------

    fun `test open profile button click invokes openProfile callback`() {
        var called = false
        edt {
            val view = LoginRequiredView(openProfile = { called = true }, dismiss = {})
            view.show("Sign in required.")
            view.openProfileButton().doClick()
        }
        assertTrue("openProfile should have been called", called)
    }

    fun `test dismiss button click invokes dismiss callback`() {
        var called = false
        edt {
            val view = LoginRequiredView(openProfile = {}, dismiss = { called = true })
            view.show("Sign in required.")
            view.dismissButton().doClick()
        }
        assertTrue("dismiss should have been called", called)
    }

    // ------ visibility ------

    fun `test view is initially hidden`() {
        edt {
            val view = LoginRequiredView(openProfile = {}, dismiss = {})
            assertFalse(view.isVisible)
        }
    }

    fun `test show makes view visible`() {
        edt {
            val view = LoginRequiredView(openProfile = {}, dismiss = {})
            view.show("Sign in required.")
            assertTrue(view.isVisible)
        }
    }

    fun `test hideView makes view invisible`() {
        edt {
            val view = LoginRequiredView(openProfile = {}, dismiss = {})
            view.show("Sign in required.")
            view.hideView()
            assertFalse(view.isVisible)
        }
    }

    fun `test hideView is idempotent when already hidden`() {
        edt {
            val view = LoginRequiredView(openProfile = {}, dismiss = {})
            view.hideView()
            assertFalse(view.isVisible)
        }
    }

    // ------ fonts: standard UI family, not editor ------

    fun `test header uses headerFont not editor font family`() {
        edt {
            val view = LoginRequiredView(openProfile = {}, dismiss = {})
            view.show("Sign in required.")
            val style = SessionEditorStyle.create(family = "Courier New", size = 20)
            view.applyStyle(style)

            val title = findAll<JBTextArea>(view).firstOrNull { it.font.isBold }
            assertNotNull("Bold title text area should be present", title)
            assertFalse(
                "Title font should not use editor font family",
                title!!.font.name == "Courier New",
            )
            assertEquals("Title font should equal headerFont", style.headerFont, title.font)
        }
    }

    fun `test description uses hintFont not editor font family`() {
        edt {
            val view = LoginRequiredView(openProfile = {}, dismiss = {})
            view.show("Sign in required.")
            val style = SessionEditorStyle.create(family = "Courier New", size = 20)
            view.applyStyle(style)

            val desc = findAll<JBTextArea>(view).firstOrNull { it.text == "Sign in required." }
            assertNotNull("Description text area should be present", desc)
            assertFalse(
                "Description font should not use editor font family",
                desc!!.font.name == "Courier New",
            )
            assertEquals("Description font should equal hintFont", style.hintFont, desc.font)
        }
    }

    // ------ helpers ------

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private inline fun <reified T> findAll(root: Container): List<T> =
        findAllCls(root, T::class.java)

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
