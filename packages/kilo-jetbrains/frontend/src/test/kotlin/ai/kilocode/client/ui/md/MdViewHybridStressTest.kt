package ai.kilocode.client.ui.md

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBHtmlPane
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.UIUtil
import javax.swing.Box
import javax.swing.JPanel

/**
 * Stress + leak coverage for the hybrid markdown renderer.
 *
 * These tests drive many updates through the public [MdView] API and inspect the real
 * Swing component tree to prove that:
 *  - retained component instances survive heavy streaming,
 *  - the component tree stays bounded (no per-update growth),
 *  - editors created for code blocks are released (no leak) after churn + clear.
 */
@Suppress("UnstableApiUsage")
class MdViewHybridStressTest : BasePlatformTestCase() {
    private lateinit var view: MdView
    private var disposed = false

    override fun setUp() {
        super.setUp()
        view = MdViewFactory.hybrid()
        disposed = false
    }

    override fun tearDown() {
        try {
            if (this::view.isInitialized && !disposed) Disposer.dispose(view)
        } finally {
            super.tearDown()
        }
    }

    fun `test streaming a large mixed document token by token stays consistent`() {
        val doc = buildString {
            append("# Heading\n\n")
            append("Intro paragraph with **bold** text.\n\n")
            append("- one\n- two\n- three\n\n")
            append("```kotlin\nval x = 1\n```\n\n")
            append("middle prose paragraph\n\n")
            append("```java\nclass A {}\n```\n\n")
            append("closing prose")
        }

        for (token in doc.chunked(3)) view.append(token)

        assertEquals(doc, view.markdown())
        assertEquals(3, htmls().size)
        assertEquals(2, scrolls().size)
        assertEquals(4, struts().size) // blocks - 1
        assertEquals(9, panel().componentCount) // 5 blocks + 4 struts = 2*5 - 1

        val html = view.html()
        assertTrue(html.contains("<h1>"))
        assertTrue(html.contains("<ul>"))
        assertTrue(html.contains("class A"))
        assertFalse(html.contains("<hr"))
    }

    fun `test trailing appends retain prefix html and code instances`() {
        view.set("intro\n\n```kotlin\nval x = 1\n```\n\ntail")
        val intro = htmls().first()
        val tail = htmls().last()
        val editor = editors().single()
        editor.getEditor(true)

        repeat(100) { i -> view.append(" more$i") }

        assertSame(intro, htmls().first())
        assertSame(tail, htmls().last())
        assertSame(editor, editors().single())
        assertEquals(2, htmls().size)
        assertEquals(1, scrolls().size)
        assertFalse(editor.getEditor(true)!!.isDisposed)
        assertTrue(view.markdown().contains("more99"))
    }

    fun `test repeated same structure set reuses single editor and stays bounded`() {
        repeat(150) { i ->
            view.set("```kotlin\nval x = $i\n```")
            editors().single().getEditor(true)
        }
        val editor = editors().single()

        repeat(50) { i -> view.set("```kotlin\nval y = $i\n```") }

        assertSame(editor, editors().single())
        assertEquals(1, scrolls().size)
        assertEquals(1, panel().componentCount)
        assertEquals("val y = 49", editor.text)
    }

    fun `test structural churn releases every editor after clear`() {
        val base = EditorFactory.getInstance().allEditors.size

        repeat(60) { i ->
            view.set("```kotlin\nval x = $i\n```")
            editors().single().getEditor(true)
            view.set("```java\nclass A$i {}\n```")
            editors().single().getEditor(true)
            view.set("plain prose $i")
        }

        view.clear()
        drainEdt()

        assertTrue(scrolls().isEmpty())
        assertTrue(htmls().isEmpty())
        assertEquals(0, panel().componentCount)
        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    fun `test streaming code body reuses one editor and keeps html in sync`() {
        view.append("```java\n")
        val pane = scrolls().single()
        val editor = editors().single()

        val body = StringBuilder()
        repeat(100) { i ->
            val line = "void m$i() {}\n"
            body.append(line)
            view.append(line)
        }

        assertSame(pane, scrolls().single())
        assertSame(editor, editors().single())
        assertEquals(body.toString().trimEnd('\n'), editor.text)
        assertTrue(view.html().contains("void m0()"))
        assertTrue(view.html().contains("void m99()"))

        view.append("```")

        assertSame(pane, scrolls().single())
        assertSame(editor, editors().single())
    }

    fun `test style changes during streaming do not rebuild components`() {
        view.append("intro\n\n```kotlin\nval x = 1\n```\n\n")
        val intro = htmls().first()
        val editor = editors().single()
        editor.getEditor(true)
        val styled = SessionEditorStyle.create(family = "Courier New", size = 18)
        val current = SessionEditorStyle.current()

        repeat(50) { i ->
            view.append("line $i ")
            view.applyStyle(if (i % 2 == 0) styled else current)
            if (i % 5 == 0) view.resetStyles()
        }

        assertSame(intro, htmls().first())
        assertSame(editor, editors().single())
        assertFalse(editor.getEditor(true)!!.isDisposed)
        assertEquals(2, htmls().size)
        assertEquals(1, scrolls().size)
        assertTrue(view.markdown().contains("line 49"))
    }

    fun `test repeated table set reuses single pane and stays bounded`() {
        repeat(150) { i -> view.set("| a | b |\n|---|---|\n| $i | ${i + 1} |") }
        val pane = scrolls().single()
        val inner = pane.viewport.view as JBHtmlPane

        repeat(50) { i -> view.set("| a | b |\n|---|---|\n| y$i | z$i |") }

        assertSame(pane, scrolls().single())
        assertSame(inner, scrolls().single().viewport.view)
        assertEquals(1, scrolls().size)
        assertEquals(0, htmls().size)
        assertEquals(1, panel().componentCount)
        assertTrue(inner.text.contains("y49"))
    }

    fun `test churn across prose code and table stays bounded and leak free`() {
        val base = EditorFactory.getInstance().allEditors.size

        repeat(60) { i ->
            view.set("prose $i")
            view.set("```kotlin\nval x = $i\n```")
            editors().single().getEditor(true)
            view.set("| a | b |\n|---|---|\n| $i | ${i + 1} |")
            assertEquals(1, scrolls().size)
            assertTrue(editors().isEmpty())
        }

        view.clear()
        drainEdt()

        assertTrue(scrolls().isEmpty())
        assertTrue(htmls().isEmpty())
        assertEquals(0, panel().componentCount)
        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    private fun panel(): JPanel = view.component as JPanel

    private fun scrolls(): List<JBScrollPane> = panel().components.filterIsInstance<JBScrollPane>()

    private fun htmls(): List<JBHtmlPane> = panel().components.filterIsInstance<JBHtmlPane>()

    private fun struts(): List<Box.Filler> = panel().components.filterIsInstance<Box.Filler>()

    private fun editors(): List<EditorTextField> = scrolls().mapNotNull { it.viewport.view as? EditorTextField }

    private fun drainEdt() {
        UIUtil.dispatchAllInvocationEvents()
    }
}
