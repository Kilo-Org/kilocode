package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Component
import java.awt.Container
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

@Suppress("UnstableApiUsage")
class ReasoningViewTest : BasePlatformTestCase() {

    fun `test completed reasoning is collapsed by default`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"))
        val base: Any = view

        assertFalse(view.isExpanded())
        assertTrue(base is SecondarySessionPartView)
        assertEquals("Reasoning", view.headerText())
        assertEquals("one\ntwo\nthree\nfour", view.markdown())
        assertTrue(view.hasToggle())
        assertFalse(view.bodyVisible())
        assertFalse(view.bodyCreated())
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

    fun `test streaming reasoning is expanded by default`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one\ntwo\nthree\nfour"))

        assertTrue(view.isExpanded())
        assertTrue(view.hasToggle())
        assertTrue(view.bodyVisible())
    }

    fun `test update to done preserves collapsed reasoning`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"))

        view.update(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"))

        assertFalse(view.isExpanded())
        assertEquals("one\ntwo\nthree\nfour", view.markdown())
    }

    fun `test live reasoning stays expanded when marked done`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one\ntwo\nthree\nfour"))

        assertTrue(view.isExpanded())

        view.update(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"))

        assertTrue(view.isExpanded())
        assertTrue(view.bodyVisible())
        assertTrue(view.bodyCreated())
    }

    fun `test manually expanded finished reasoning stays open on update`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo"))

        view.toggle()
        view.update(reasoning("p1", done = true, text = "one\ntwo\nthree"))

        assertTrue(view.isExpanded())
        assertTrue(view.bodyVisible())
        assertEquals("one\ntwo\nthree", view.markdown())
    }

    fun `test toggle opens and closes reasoning`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"))

        view.toggle()
        assertTrue(view.isExpanded())
        view.toggle()
        assertFalse(view.isExpanded())
    }

    fun `test collapsed reasoning stays collapsed on update`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo"))
        view.update(reasoning("p1", done = true, text = "one\ntwo\nthree"))

        assertFalse(view.isExpanded())
        assertEquals("one\ntwo\nthree", view.markdown())
    }

    fun `test appendDelta preserves markdown`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "a"))

        view.appendDelta("b")

        assertEquals("ab", view.markdown())
        assertTrue(view.isExpanded())
    }

    fun `test blank streaming reasoning opens when delta arrives`() {
        val view = ReasoningView(reasoning("p1", done = false, text = ""))

        assertFalse(view.isVisible)
        view.appendDelta("b")

        assertEquals("b", view.markdown())
        assertTrue(view.isVisible)
        assertTrue(view.bodyCreated())
        assertTrue(view.bodyVisible())
        assertTrue(view.hasToggle())
    }

    fun `test collapsed completed append keeps lazy reasoning body uncreated`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "a"))

        view.appendDelta("b")

        assertEquals("ab", view.markdown())
        assertFalse(view.bodyCreated())
        assertFalse(view.bodyVisible())
    }

    fun `test collapsed completed update keeps lazy reasoning body uncreated`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "a"))

        view.update(reasoning("p1", done = true, text = "abc"))

        assertEquals("abc", view.markdown())
        assertFalse(view.bodyCreated())
        assertFalse(view.bodyVisible())
    }

    fun `test reasoning creates lazy markdown body once`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one"))

        view.toggle()
        val component = view.md.component
        view.toggle()
        view.toggle()

        assertSame(component, view.md.component)
        assertTrue(view.bodyVisible())
    }

    fun `test blank reasoning has no toggle`() {
        val view = ReasoningView(reasoning("p1", done = true, text = ""))

        assertFalse(view.isVisible)
        assertFalse(view.isExpanded())
        assertFalse(view.hasToggle())
    }

    fun `test reasoning markdown uses ui font with editor-derived size`() {
        val style = SessionEditorStyle.current()
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"))
        view.toggle()

        assertSmallItalicSheet(view.md.overrideSheet(), style)
        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, view.horizontalPolicy())
    }

    fun `test reasoning header uses smaller ui font with editor-derived size`() {
        val style = SessionEditorStyle.current()
        val view = ReasoningView(reasoning("p1", done = true, text = "one"))
        val font = view.headerFont()

        assertEquals(style.smallEditorFont.name, font.name)
        assertTrue(font.size < style.editorSize)
    }

    fun `test applyStyle updates reasoning in place`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"))
        val component = view.md.component
        val style = SessionEditorStyle.create(family = "Courier New", size = 24)

        view.applyStyle(style)

        assertSame(component, view.md.component)
        assertSmallItalicSheet(view.md.overrideSheet(), style)
        assertEquals(style.smallEditorFont.name, view.headerFont().name)
        assertTrue(view.headerFont().size < style.editorSize)
    }

    fun `test expanded reasoning body is capped to five rows`() {
        val view = ReasoningView(reasoning("p1", done = false, text = (1..20).joinToString("\n") { "line $it" }))
        val taller = ReasoningView(reasoning("p2", done = false, text = (1..200).joinToString("\n") { "line $it" }))

        assertEquals(5, view.bodyMaxRows())
        assertTrue(view.preferredSize.height > 0)
        assertEquals(view.preferredSize.height, taller.preferredSize.height)
    }

    fun `test appended reasoning scrolls nested body to bottom`() {
        val view = ReasoningView(reasoning("p1", done = false, text = (1..20).joinToString("\n") { "line $it" }))
        view.setSize(300, 80)
        view.doLayout()

        view.appendDelta("\nline 21\nline 22")
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(view.bodyScrollBottom(), view.bodyScrollValue())
    }

    fun `test appended reasoning does not yank user scrolled above tail`() {
        val view = ReasoningView(reasoning("p1", done = false, text = (1..40).joinToString("\n") { "line $it" }))
        view.setSize(300, 80)
        view.doLayout()
        UIUtil.dispatchAllInvocationEvents()
        val scroll = scroll(view)
        scroll.verticalScrollBar.value = 0

        view.appendDelta("\nline 41\nline 42")
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(0, scroll.verticalScrollBar.value)
    }

    fun `test reasoning block uses vertical separator`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one"))

        assertEquals(1, view.border!!.getBorderInsets(view).left)

        view.toggle()

        val insets = view.border!!.getBorderInsets(view)
        assertEquals(0, insets.top)
        assertEquals(1, insets.left)
        assertEquals(0, insets.bottom)
        assertEquals(0, insets.right)
        assertEquals(SessionUiStyle.View.Reasoning.BODY_LINES, view.bodyMaxRows())
    }

    fun `test reasoning toggle uses shared right rail`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one"))
        val row = view.components.single() as JPanel
        val insets = row.border.getBorderInsets(row)

        assertEquals(JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING), insets.left)
        assertEquals(JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING), insets.right)
    }

    fun `test link opens url callback`() {
        val urls = mutableListOf<String>()
        val view = ReasoningView(reasoning("p1", done = true, text = "[docs](https://kilocode.ai/docs)"), openUrl = {
            urls.add(it)
        })

        view.md.simulateLink("https://kilocode.ai/docs")

        assertEquals(listOf("https://kilocode.ai/docs"), urls)
    }

    private fun assertEditorSheet(sheet: String, style: SessionEditorStyle) {
        assertTrue(sheet.contains(style.editorFamily))
        assertTrue(sheet.contains("${style.editorSize}pt"))
    }

    private fun assertSmallItalicSheet(sheet: String, style: SessionEditorStyle) {
        assertTrue(sheet.contains(style.smallEditorFont.name))
        assertFalse(sheet.contains("${style.editorSize}pt"))
        assertTrue(sheet.contains("font-style: italic"))
    }

    private fun reasoning(id: String, done: Boolean, text: String) = Reasoning(id).also {
        it.done = done
        it.content.append(text)
    }

    private fun scroll(component: Component): JBScrollPane {
        if (component is JBScrollPane) return component
        if (component is Container) {
            component.components.forEach { child ->
                val scroll = runCatching { scroll(child) }.getOrNull()
                if (scroll != null) return scroll
            }
        }
        error("scroll not found")
    }
}
