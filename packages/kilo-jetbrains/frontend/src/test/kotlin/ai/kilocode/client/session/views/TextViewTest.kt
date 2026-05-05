package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.ui.SessionStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Tests for [TextView].
 *
 * Uses [BasePlatformTestCase] so that [JBHtmlPane] (inside MdView) initialises
 * correctly with a real IntelliJ Application.
 */
@Suppress("UnstableApiUsage")
class TextViewTest : BasePlatformTestCase() {

    // ---- creation ------

    fun `test empty Text creates view with empty markdown`() {
        val view = TextView(Text("p1"))
        assertEquals("", view.markdown())
    }

    fun `test Text with content sets initial markdown`() {
        val text = Text("p1").also { it.content.append("hello **world**") }
        val view = TextView(text)
        assertEquals("hello **world**", view.markdown())
    }

    // ---- update ------

    fun `test update replaces markdown content`() {
        val text = Text("p1").also { it.content.append("initial") }
        val view = TextView(text)

        val updated = Text("p1").also { it.content.append("updated") }
        view.update(updated)

        assertEquals("updated", view.markdown())
    }

    fun `test update with different content type is ignored`() {
        val view = TextView(Text("p1").also { it.content.append("keep") })
        view.update(ai.kilocode.client.session.model.Reasoning("p1"))
        assertEquals("keep", view.markdown())
    }

    // ---- appendDelta ------

    fun `test appendDelta accumulates content`() {
        val view = TextView(Text("p1"))
        view.appendDelta("hello ")
        view.appendDelta("**world**")

        assertEquals("hello **world**", view.markdown())
    }

    fun `test appendDelta after update extends content`() {
        val text = Text("p1").also { it.content.append("first ") }
        val view = TextView(text)

        view.appendDelta("second")

        assertEquals("first second", view.markdown())
    }

    // ---- contentId ------

    fun `test contentId matches Text id`() {
        val view = TextView(Text("part42"))
        assertEquals("part42", view.contentId)
    }

    // ---- component ------

    fun `test component is non-null and is the MdView component`() {
        val view = TextView(Text("p1"))
        assertNotNull(view.md.component)
    }

    fun `test markdown uses editor font settings`() {
        val style = SessionStyle.current()
        val view = TextView(Text("p1"))
        val sheet = view.md.overrideSheet()

        assertTrue(sheet.contains(style.editorFamily))
        assertTrue(sheet.contains("${style.editorSize}pt"))
    }

    fun `test applyStyle updates markdown in place`() {
        val view = TextView(Text("p1"))
        val component = view.md.component
        val style = SessionStyle.create(family = "Courier New", size = 23)

        view.applyStyle(style)
        val sheet = view.md.overrideSheet()

        assertSame(component, view.md.component)
        assertTrue(sheet.contains("Courier New"))
        assertTrue(sheet.contains("23pt"))
    }

    // ---- markdown is rendered ------

    fun `test update with bold text produces html with strong tag`() {
        val view = TextView(Text("p1"))
        view.update(Text("p1").also { it.content.append("**bold**") })
        assertTrue(view.md.html().contains("<strong>"))
    }

    fun `test streaming bold across two deltas`() {
        val view = TextView(Text("p1"))
        view.appendDelta("**bold")
        view.appendDelta("**")
        assertTrue(view.md.html().contains("<strong>"))
    }
}
