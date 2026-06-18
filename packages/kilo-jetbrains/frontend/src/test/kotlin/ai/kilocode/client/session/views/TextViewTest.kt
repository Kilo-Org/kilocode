package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.util.ui.JBUI
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.BorderLayout
import java.awt.datatransfer.DataFlavor
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.RepaintManager

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

    fun `test appendDelta empty string does not repaint or change markdown`() {
        val view = TextView(Text("p1").also { it.content.append("keep") })
        val repaint = TrackingRepaintManager(view)
        val old = RepaintManager.currentManager(view)

        try {
            RepaintManager.setCurrentManager(repaint)

            view.appendDelta("")

            assertEquals("keep", view.markdown())
            assertEquals(0, repaint.dirty)
            assertEquals(0, repaint.invalid)
        } finally {
            RepaintManager.setCurrentManager(old)
        }
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

    fun `test copy toolbar is retained below markdown component`() {
        val view = TextView(Text("p1").also { it.content.append(" hello ") })

        view.setCopyToolbar(true)

        val layout = view.layout as BorderLayout
        assertSame(view.md.component, layout.getLayoutComponent(BorderLayout.CENTER))
        val bar = layout.getLayoutComponent(BorderLayout.SOUTH) as MessageToolbar
        val buttons = bar.layout as BorderLayout
        assertSame(view.copyButton(), buttons.getLayoutComponent(BorderLayout.LINE_START))
        assertTrue(view.hasCopyToolbar())
    }

    fun `test assistant copy button copies current trimmed markdown`() {
        val view = TextView(Text("p1").also { it.content.append(" hello ") })
        view.setCopyToolbar(true)

        view.copyButton().doClick()

        assertEquals("hello", clipboard())
    }

    fun `test copy confirmation hides when mouse exits button`() {
        val view = TextView(Text("p1").also { it.content.append("hello") })
        view.setCopyToolbar(true)

        view.copyButton().doClick()
        view.copyButton().dispatchEvent(MouseEvent(
            view.copyButton(),
            MouseEvent.MOUSE_EXITED,
            System.currentTimeMillis(),
            0,
            1,
            1,
            0,
            false,
        ))

        assertEquals("hello", clipboard())
    }

    fun `test copy toolbar reflects update and delta without replacing components`() {
        val view = TextView(Text("p1").also { it.content.append(" first ") })
        view.setCopyToolbar(true)
        val comp = view.md.component
        val bar = (view.layout as BorderLayout).getLayoutComponent(BorderLayout.SOUTH)

        view.update(Text("p1").also { it.content.append(" second ") })
        view.appendDelta(" third ")
        view.copyButton().doClick()

        assertSame(comp, view.md.component)
        assertSame(bar, (view.layout as BorderLayout).getLayoutComponent(BorderLayout.SOUTH))
        assertEquals("second  third", clipboard())
    }

    fun `test text view can copy untrimmed markdown`() {
        val view = PromptView(Text("p1").also { it.content.append(" hello ") })
        view.setCopyToolbar(true, trim = false)

        view.copyButton().doClick()

        assertEquals(" hello ", clipboard())
    }

    fun `test blank copy toolbar is hidden until content appears`() {
        val view = TextView(Text("p1"))
        view.setCopyToolbar(true)

        assertFalse(view.hasCopyToolbar())

        view.appendDelta("hello")

        assertTrue(view.hasCopyToolbar())
    }

    fun `test markdown uses ui family with editor size`() {
        val style = SessionEditorStyle.current()
        val view = TextView(Text("p1"))
        val sheet = view.md.overrideSheet()

        assertTrue(sheet.contains(style.transcriptFont.name))
        assertTrue(sheet.contains("${style.editorSize}pt"))
    }

    fun `test applyStyle updates markdown in place`() {
        val view = TextView(Text("p1"))
        val component = view.md.component
        val style = SessionEditorStyle.create(family = "Courier New", size = 23)

        view.applyStyle(style)
        val sheet = view.md.overrideSheet()

        assertSame(component, view.md.component)
        assertTrue(sheet.contains(style.transcriptFont.name))
        assertTrue(sheet.contains("Courier New"))
        assertTrue(sheet.contains("23pt"))
        assertEquals(style.editorForeground, view.md.foreground)
    }

    fun `test prompt view uses editor font and background`() {
        val style = SessionEditorStyle.create(family = "Courier New", size = 23)
        val view = PromptView(Text("p1"))

        view.applyStyle(style)

        assertEquals(style.editorFont, view.md.font)
        assertEquals(style.editorBackground, view.md.background)
        assertFalse(view.contentOpaque())
    }

    fun `test prompt view uses input shell padding`() {
        val view = PromptView(Text("p1"))
        val ins = view.border.getBorderInsets(view)

        assertEquals(JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING), ins.top)
        assertEquals(JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING), ins.bottom)
        assertEquals(JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING), ins.left)
        assertEquals(JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING), ins.right)
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

    fun `test link opens url callback`() {
        val urls = mutableListOf<String>()
        val view = TextView(Text("p1"), openUrl = { urls.add(it) })

        view.md.simulateLink("https://kilocode.ai/docs")

        assertEquals(listOf("https://kilocode.ai/docs"), urls)
    }

    private class TrackingRepaintManager(private val watched: JComponent) : RepaintManager() {
        var dirty = 0
        var invalid = 0

        override fun addDirtyRegion(c: JComponent, x: Int, y: Int, w: Int, h: Int) {
            if (c === watched) dirty++
            super.addDirtyRegion(c, x, y, w, h)
        }

        override fun addInvalidComponent(invalidComponent: JComponent) {
            if (invalidComponent === watched) invalid++
            super.addInvalidComponent(invalidComponent)
        }
    }

    private fun clipboard() = CopyPasteManager.getInstance()
        .contents
        ?.getTransferData(DataFlavor.stringFlavor) as String
}
