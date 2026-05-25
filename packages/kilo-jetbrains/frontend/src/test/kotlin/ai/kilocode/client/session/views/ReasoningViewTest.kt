package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import javax.swing.ScrollPaneConstants

@Suppress("UnstableApiUsage")
class ReasoningViewTest : BasePlatformTestCase() {

    fun `test completed reasoning is collapsed by default`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"))

        assertFalse(view.isExpanded())
        assertEquals("Reasoning", view.headerText())
        assertEquals("one\ntwo\nthree\nfour", view.markdown())
        assertTrue(view.hasToggle())
        assertFalse(view.bodyVisible())
        assertTrue(view.bodyCreated())
    }

    fun `test short completed reasoning is collapsible`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree"))

        assertFalse(view.isExpanded())
        assertTrue(view.hasToggle())
        view.toggle()
        assertTrue(view.isExpanded())
        assertTrue(view.bodyVisible())
        assertTrue(view.bodyCreated())
    }

    fun `test streaming reasoning is collapsed by default`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one\ntwo\nthree\nfour"))

        assertFalse(view.isExpanded())
        assertTrue(view.hasToggle())
    }

    fun `test update to done preserves collapsed reasoning`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one\ntwo\nthree\nfour"))

        view.update(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"))

        assertFalse(view.isExpanded())
        assertEquals("one\ntwo\nthree\nfour", view.markdown())
    }

    fun `test toggle opens and closes reasoning`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"))

        view.toggle()
        assertTrue(view.isExpanded())
        view.toggle()
        assertFalse(view.isExpanded())
    }

    fun `test collapsed reasoning stays collapsed on update`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one\ntwo"))
        view.update(reasoning("p1", done = true, text = "one\ntwo\nthree"))

        assertFalse(view.isExpanded())
        assertEquals("one\ntwo\nthree", view.markdown())
    }

    fun `test appendDelta preserves markdown`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "a"))

        view.appendDelta("b")

        assertEquals("ab", view.markdown())
        assertFalse(view.isExpanded())
    }

    fun `test blank reasoning stays collapsed when delta arrives`() {
        val view = ReasoningView(reasoning("p1", done = false, text = ""))

        view.appendDelta("b")

        assertEquals("b", view.markdown())
        assertTrue(view.bodyCreated())
        assertFalse(view.bodyVisible())
        assertTrue(view.hasToggle())
    }

    fun `test collapsed append keeps eager reasoning body detached`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "a"))

        view.appendDelta("b")

        assertEquals("ab", view.markdown())
        assertTrue(view.bodyCreated())
        assertFalse(view.bodyVisible())
    }

    fun `test collapsed update keeps eager reasoning body detached`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "a"))

        view.update(reasoning("p1", done = false, text = "abc"))

        assertEquals("abc", view.markdown())
        assertTrue(view.bodyCreated())
        assertFalse(view.bodyVisible())
    }

    fun `test reasoning reuses eager markdown body`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one"))

        view.toggle()
        val component = view.md.component
        view.toggle()
        view.toggle()

        assertSame(component, view.md.component)
        assertTrue(view.bodyVisible())
    }

    fun `test blank reasoning has no toggle`() {
        val view = ReasoningView(reasoning("p1", done = true, text = ""))

        assertFalse(view.isExpanded())
        assertFalse(view.hasToggle())
    }

    fun `test reasoning markdown uses editor font settings`() {
        val style = SessionEditorStyle.current()
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"))

        assertSmallItalicSheet(view.md.overrideSheet(), style)
        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, view.horizontalPolicy())
    }

    fun `test reasoning header uses smaller editor-derived font`() {
        val style = SessionEditorStyle.current()
        val view = ReasoningView(reasoning("p1", done = true, text = "one"))
        val font = view.headerFont()

        assertEquals(style.editorFamily, font.name)
        assertTrue(font.size < style.editorSize)
    }

    fun `test applyStyle updates reasoning in place`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"))
        val component = view.md.component
        val style = SessionEditorStyle.create(family = "Courier New", size = 24)

        view.applyStyle(style)

        assertSame(component, view.md.component)
        assertSmallItalicSheet(view.md.overrideSheet(), style)
        assertEquals("Courier New", view.headerFont().name)
        assertTrue(view.headerFont().size < style.editorSize)
    }

    fun `test expanded reasoning body is capped to five rows`() {
        val view = ReasoningView(reasoning("p1", done = false, text = (1..20).joinToString("\n") { "line $it" }))
        view.toggle()

        assertEquals(5, view.bodyMaxRows())
        assertTrue(view.preferredSize.height > 0)
    }

    private fun assertEditorSheet(sheet: String, style: SessionEditorStyle) {
        assertTrue(sheet.contains(style.editorFamily))
        assertTrue(sheet.contains("${style.editorSize}pt"))
    }

    private fun assertSmallItalicSheet(sheet: String, style: SessionEditorStyle) {
        assertTrue(sheet.contains(style.editorFamily))
        assertFalse(sheet.contains("${style.editorSize}pt"))
        assertTrue(sheet.contains("font-style: italic"))
    }

    private fun reasoning(id: String, done: Boolean, text: String) = Reasoning(id).also {
        it.done = done
        it.content.append(text)
    }
}
