package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.settings.ReasoningDisplay
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Container
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

@Suppress("UnstableApiUsage")
class ReasoningViewTest : BasePlatformTestCase() {

    override fun tearDown() {
        try {
            KiloPluginSettings.unsetReasoningDisplay()
        } finally {
            super.tearDown()
        }
    }

    // -- Expanded mode (the default: full text inline, opens whenever content is non-blank, never auto-collapses) --

    fun `test expanded mode opens completed reasoning by default`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"), mode = ReasoningDisplay.EXPANDED)

        assertTrue(view.isExpanded())
        assertEquals("Reasoning", view.headerText())
        assertEquals("one\ntwo\nthree\nfour", view.markdown())
        assertTrue(view.hasToggle())
        assertTrue(view.bodyVisible())
        assertTrue(view.bodyCreated())
    }

    fun `test expanded mode opens streaming reasoning by default`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one\ntwo\nthree\nfour"), mode = ReasoningDisplay.EXPANDED)

        assertTrue(view.isExpanded())
        assertTrue(view.hasToggle())
        assertTrue(view.bodyVisible())
    }

    fun `test expanded mode never auto-collapses when marked done`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one\ntwo\nthree\nfour"), mode = ReasoningDisplay.EXPANDED)

        assertTrue(view.isExpanded())
        assertTrue(view.bodyCreated())

        view.update(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"))

        assertTrue(view.isExpanded())
        assertTrue(view.bodyVisible())
        assertTrue(view.bodyCreated())
        assertEquals("one\ntwo\nthree\nfour", view.markdown())
    }

    fun `test expanded mode collapsed by the user stays collapsed on update`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one\ntwo"), mode = ReasoningDisplay.EXPANDED)

        view.toggle()
        view.update(reasoning("p1", done = true, text = "one\ntwo\nthree"))

        assertFalse(view.isExpanded())
        assertFalse(view.bodyVisible())
        assertEquals("one\ntwo\nthree", view.markdown())
    }

    fun `test expanded mode collapsed by the user stays collapsed on appended deltas`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one"), mode = ReasoningDisplay.EXPANDED)

        view.toggle()
        assertFalse(view.isExpanded())

        view.appendDelta("\ntwo")

        assertFalse("a manual collapse is pinned and is not undone by new content", view.isExpanded())
        assertEquals("one\ntwo", view.markdown())
    }

    fun `test live setting collapses untouched reasoning`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one"), mode = ReasoningDisplay.EXPANDED)
        KiloPluginSettings.setReasoningDisplay(ReasoningDisplay.HEADLINE)

        assertTrue(view.syncTranscriptDisplay())

        assertFalse(view.isExpanded())
        assertFalse(view.bodyCreated())
    }

    fun `test live setting skips manually expanded reasoning`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one"), mode = ReasoningDisplay.PREVIEW)
        view.toggle()
        KiloPluginSettings.setReasoningDisplay(ReasoningDisplay.HEADLINE)

        assertFalse(view.syncTranscriptDisplay())

        assertTrue(view.isExpanded())
    }

    // -- Preview mode (height-capped auto-scrolling body while streaming; auto-collapses + releases body when done) --

    fun `test preview mode collapses completed reasoning by default`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"), mode = ReasoningDisplay.PREVIEW)

        assertFalse(view.isExpanded())
        assertTrue(view.hasToggle())
        assertFalse(view.bodyVisible())
        assertFalse(view.bodyCreated())
    }

    fun `test preview mode expands streaming reasoning by default`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one\ntwo\nthree\nfour"), mode = ReasoningDisplay.PREVIEW)

        assertTrue(view.isExpanded())
        assertTrue(view.hasToggle())
        assertTrue(view.bodyVisible())
    }

    fun `test preview mode auto-collapses and releases body when marked done`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one\ntwo\nthree\nfour"), mode = ReasoningDisplay.PREVIEW)

        assertTrue(view.isExpanded())
        assertTrue(view.bodyCreated())

        view.update(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"))

        assertFalse(view.isExpanded())
        assertFalse(view.bodyVisible())
        assertFalse(view.bodyCreated())

        view.toggle()

        assertTrue(view.isExpanded())
        assertTrue(view.bodyVisible())
        assertTrue(view.bodyCreated())
        assertEquals("one\ntwo\nthree\nfour", view.markdown())
    }

    fun `test preview mode auto-collapse releases streaming reasoning editors`() {
        val base = EditorFactory.getInstance().allEditors.size

        repeat(20) { i ->
            val view = ReasoningView(reasoning("p$i", done = false, text = "```kotlin\nval x = $i\n```"), mode = ReasoningDisplay.PREVIEW)
            popupEditors(view.md.component).forEach { it.getEditor(true) }
            view.update(reasoning("p$i", done = true, text = "```kotlin\nval x = $i\n```"))
        }
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    fun `test preview mode manually expanded finished reasoning stays open on update`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo"), mode = ReasoningDisplay.PREVIEW)

        view.toggle()
        view.update(reasoning("p1", done = true, text = "one\ntwo\nthree"))

        assertTrue(view.isExpanded())
        assertTrue(view.bodyVisible())
        assertEquals("one\ntwo\nthree", view.markdown())
    }

    fun `test preview mode toggle opens and closes reasoning`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"), mode = ReasoningDisplay.PREVIEW)

        view.toggle()
        assertTrue(view.isExpanded())
        view.toggle()
        assertFalse(view.isExpanded())
    }

    fun `test preview mode manual collapse during stream stays collapsed when marked done`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one\ntwo"), mode = ReasoningDisplay.PREVIEW)

        view.toggle()
        view.update(reasoning("p1", done = true, text = "one\ntwo\nthree"))

        assertFalse(view.isExpanded())
        assertFalse(view.bodyVisible())
        assertEquals("one\ntwo\nthree", view.markdown())
    }

    fun `test preview mode manual expand during stream stays open when marked done`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one\ntwo"), mode = ReasoningDisplay.PREVIEW)

        view.toggle()
        view.toggle()
        view.update(reasoning("p1", done = true, text = "one\ntwo\nthree"))

        assertTrue(view.isExpanded())
        assertTrue(view.bodyVisible())
        assertEquals("one\ntwo\nthree", view.markdown())
    }

    fun `test preview mode unpinned appended reasoning auto-collapses when marked done`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one"), mode = ReasoningDisplay.PREVIEW)

        view.appendDelta("\ntwo")
        view.update(reasoning("p1", done = true, text = "one\ntwo"))

        assertFalse(view.isExpanded())
        assertFalse(view.bodyVisible())
    }

    fun `test preview mode collapsed reasoning stays collapsed on update`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo"), mode = ReasoningDisplay.PREVIEW)
        view.update(reasoning("p1", done = true, text = "one\ntwo\nthree"))

        assertFalse(view.isExpanded())
        assertEquals("one\ntwo\nthree", view.markdown())
    }

    fun `test preview mode collapsed completed append keeps lazy reasoning body uncreated`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "a"), mode = ReasoningDisplay.PREVIEW)

        view.appendDelta("b")

        assertEquals("ab", view.markdown())
        assertFalse(view.bodyCreated())
        assertFalse(view.bodyVisible())
    }

    fun `test preview mode collapsed completed update keeps lazy reasoning body uncreated`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "a"), mode = ReasoningDisplay.PREVIEW)

        view.update(reasoning("p1", done = true, text = "abc"))

        assertEquals("abc", view.markdown())
        assertFalse(view.bodyCreated())
        assertFalse(view.bodyVisible())
    }

    fun `test preview mode body is capped to configured rows`() {
        val view = ReasoningView(reasoning("p1", done = false, text = (1..20).joinToString("\n") { "line $it" }), mode = ReasoningDisplay.PREVIEW)
        val taller = ReasoningView(reasoning("p2", done = false, text = (1..200).joinToString("\n") { "line $it" }), mode = ReasoningDisplay.PREVIEW)

        assertEquals(SessionUiStyle.View.Reasoning.BODY_LINES, view.bodyMaxRows())
        assertTrue(view.preferredSize.height > 0)
        assertEquals(view.preferredSize.height, taller.preferredSize.height)
    }

    // -- Headline mode (never auto-opens; header only until the user expands it) --

    fun `test headline mode never auto-opens streaming reasoning`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one\ntwo\nthree"), mode = ReasoningDisplay.HEADLINE)

        assertFalse(view.isExpanded())
        assertTrue(view.hasToggle())
        assertFalse(view.bodyVisible())
        assertFalse(view.bodyCreated())
    }

    fun `test headline mode never auto-opens completed reasoning`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree"), mode = ReasoningDisplay.HEADLINE)

        assertFalse(view.isExpanded())
        assertFalse(view.bodyVisible())
    }

    fun `test headline mode does not open on appended deltas`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one"), mode = ReasoningDisplay.HEADLINE)

        view.appendDelta("\ntwo")
        view.update(reasoning("p1", done = true, text = "one\ntwo"))

        assertFalse(view.isExpanded())
        assertEquals("one\ntwo", view.markdown())
    }

    fun `test headline mode user expand stays open on update`() {
        val view = ReasoningView(reasoning("p1", done = false, text = "one"), mode = ReasoningDisplay.HEADLINE)

        view.toggle()
        assertTrue(view.isExpanded())

        view.update(reasoning("p1", done = true, text = "one\ntwo"))

        assertTrue(view.isExpanded())
        assertTrue(view.bodyVisible())
        assertEquals("one\ntwo", view.markdown())
    }

    // -- Mode-independent behavior --

    fun `test blank streaming reasoning opens when delta arrives`() {
        val view = ReasoningView(reasoning("p1", done = false, text = ""), mode = ReasoningDisplay.EXPANDED)

        assertFalse(view.isVisible)
        view.appendDelta("b")

        assertEquals("b", view.markdown())
        assertTrue(view.isVisible)
        assertTrue(view.bodyCreated())
        assertTrue(view.bodyVisible())
        assertTrue(view.hasToggle())
    }

    fun `test reasoning creates lazy markdown body once`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one"), mode = ReasoningDisplay.PREVIEW)

        view.toggle()
        val component = view.md.component
        view.toggle()
        view.toggle()

        assertSame(component, view.md.component)
        assertTrue(view.bodyVisible())
    }

    fun `test blank reasoning has no toggle`() {
        val view = ReasoningView(reasoning("p1", done = true, text = ""), mode = ReasoningDisplay.EXPANDED)

        assertFalse(view.isVisible)
        assertFalse(view.isExpanded())
        assertFalse(view.hasToggle())
    }

    fun `test reasoning markdown uses ui font with editor-derived size`() {
        val style = SessionEditorStyle.current()
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"), mode = ReasoningDisplay.PREVIEW)
        view.toggle()

        assertSmallItalicSheet(view.md.overrideSheet(), style)
        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, view.horizontalPolicy())
    }

    fun `test reasoning header uses smaller ui font with editor-derived size`() {
        val style = SessionEditorStyle.current()
        val view = ReasoningView(reasoning("p1", done = true, text = "one"), mode = ReasoningDisplay.PREVIEW)
        val font = view.headerFont()

        assertEquals(style.smallEditorFont.name, font.name)
        assertTrue(font.size < style.editorSize)
    }

    fun `test reasoning header uses brain icon`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one"), mode = ReasoningDisplay.PREVIEW)
        val icons = icons(view)

        assertTrue(icons.contains(SessionViewIcons.brain))
        assertFalse(icons.contains(SessionViewIcons.eye))
    }

    fun `test applyStyle updates reasoning in place`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one\ntwo\nthree\nfour"), mode = ReasoningDisplay.EXPANDED)
        val component = view.md.component
        val style = SessionEditorStyle.create(family = "Courier New", size = 24)

        view.applyStyle(style)

        assertSame(component, view.md.component)
        assertSmallItalicSheet(view.md.overrideSheet(), style)
        assertEquals(style.smallEditorFont.name, view.headerFont().name)
        assertTrue(view.headerFont().size < style.editorSize)
    }

    fun `test reasoning header popup is available only when collapsed with content`() {
        val expanded = ReasoningView(reasoning("p1", done = false, text = "one"), mode = ReasoningDisplay.PREVIEW)
        val blank = ReasoningView(reasoning("p2", done = true, text = ""), mode = ReasoningDisplay.PREVIEW)
        val collapsed = ReasoningView(reasoning("p3", done = true, text = "one\ntwo"), mode = ReasoningDisplay.PREVIEW)

        assertNull(expanded.headerPopup())
        assertNull(blank.headerPopup())
        assertNotNull(collapsed.headerPopup())

        collapsed.toggle()

        assertNull(collapsed.headerPopup())
    }

    fun `test reasoning header popup body is capped to popup size`() {
        val text = (1..400).joinToString(" ") { "reasoning" }
        val view = ReasoningView(reasoning("p1", done = true, text = text), mode = ReasoningDisplay.PREVIEW)
        val body = view.headerPopup()!!.build()

        try {
            val scroll = popupScrollPanes(body.component).first()
            val panel = scroll.viewport.view as JPanel

            assertEquals(1, panel.components.filterIsInstance<JComponent>().size)
            assertTrue(body.component.preferredSize.width in 1..JBUI.scale(SessionUiStyle.View.Popup.MAX_WIDTH))
            assertEquals(JBUI.scale(SessionUiStyle.View.Popup.MAX_HEIGHT), body.component.preferredSize.height)
        } finally {
            Disposer.dispose(body.disposable)
        }
    }

    fun `test reasoning header popup editors are disposed after churn`() {
        val base = EditorFactory.getInstance().allEditors.size
        val view = ReasoningView(reasoning("p1", done = true, text = "```kotlin\nprintln(1)\n```"), mode = ReasoningDisplay.PREVIEW)

        repeat(20) {
            val body = view.headerPopup()!!.build()
            popupEditors(body.component).forEach { it.getEditor(true) }
            Disposer.dispose(body.disposable)
        }
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    fun `test appended reasoning scrolls nested body to bottom`() {
        val view = ReasoningView(reasoning("p1", done = false, text = (1..20).joinToString("\n") { "line $it" }), mode = ReasoningDisplay.PREVIEW)
        view.setSize(300, 80)
        view.doLayout()

        view.appendDelta("\nline 21\nline 22")
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(view.bodyScrollBottom(), view.bodyScrollValue())
    }

    fun `test appended reasoning does not yank user scrolled above tail`() {
        val view = ReasoningView(reasoning("p1", done = false, text = (1..40).joinToString("\n") { "line $it" }), mode = ReasoningDisplay.PREVIEW)
        view.setSize(300, 80)
        view.doLayout()
        UIUtil.dispatchAllInvocationEvents()
        val scroll = scroll(view)
        scroll.verticalScrollBar.value = 0

        view.appendDelta("\nline 41\nline 42")
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(0, scroll.verticalScrollBar.value)
    }

    fun `test reasoning draws no separator and gaps the body`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one"), mode = ReasoningDisplay.PREVIEW)

        assertNull("collapsed reasoning draws no separator", view.border)

        view.toggle()

        assertNull("expanded reasoning draws no separator", view.border)
        assertEquals(SessionUiStyle.View.contentGap(), (view.layout as BorderLayout).vgap)
        assertEquals(SessionUiStyle.View.Reasoning.BODY_LINES, view.bodyMaxRows())
    }

    fun `test reasoning toggle uses shared right rail`() {
        val view = ReasoningView(reasoning("p1", done = true, text = "one"), mode = ReasoningDisplay.PREVIEW)
        val row = view.components.single() as JPanel
        val insets = row.border.getBorderInsets(row)

        assertEquals(JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING), insets.left)
        assertEquals(JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING), insets.right)
    }

    fun `test link opens url callback`() {
        val urls = mutableListOf<String>()
        val view = ReasoningView(
            reasoning("p1", done = true, text = "[docs](https://kilocode.ai/docs)"),
            openUrl = { urls.add(it) },
            mode = ReasoningDisplay.PREVIEW,
        )

        view.md.simulateLink("https://kilocode.ai/docs")

        assertEquals(listOf("https://kilocode.ai/docs"), urls)
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

    private fun icons(component: Component): List<Icon> {
        val found = mutableListOf<Icon>()
        collect(component, found)
        return found
    }

    private fun popupScrollPanes(root: JComponent): List<JBScrollPane> {
        val found = mutableListOf<JBScrollPane>()
        fun visit(component: JComponent) {
            if (component is JBScrollPane) found.add(component)
            component.components.filterIsInstance<JComponent>().forEach(::visit)
        }
        visit(root)
        return found
    }

    private fun collect(component: Component, found: MutableList<Icon>) {
        if (component is JLabel) component.icon?.let(found::add)
        if (component is Container) component.components.forEach { collect(it, found) }
    }
}
