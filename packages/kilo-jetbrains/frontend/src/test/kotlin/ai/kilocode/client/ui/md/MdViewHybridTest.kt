package ai.kilocode.client.ui.md

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.fileTypes.FileTypeRegistry
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.fileTypes.UnknownFileType
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBHtmlPane
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Color
import javax.swing.Box
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

@Suppress("UnstableApiUsage")
class MdViewHybridTest : BasePlatformTestCase() {
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

    fun `test set stores source`() {
        view.set("hello **world**")
        assertEquals("hello **world**", view.markdown())
    }

    fun `test append renders accumulated source`() {
        view.append("hello ")
        view.append("**world**")
        assertEquals("hello **world**", view.markdown())
        assertTrue(view.html().contains("<strong>"))
    }

    fun `test fenced code block shows horizontal scrollbar as needed`() {
        view.set("```kotlin\nval value = 1\n```")
        val pane = scrolls().single()

        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED, pane.horizontalScrollBarPolicy)
        assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER, pane.verticalScrollBarPolicy)
        assertTrue(pane.isWheelScrollingEnabled)
        assertTrue(pane.horizontalScrollBar.preferredSize.height > 0)
        assertTrue(pane.horizontalScrollBar.isOpaque)
        assertFalse(pane.isOverlappingScrollBar)
        assertEquals(0, pane.verticalScrollBar.preferredSize.width)
    }

    fun `test fenced code block preserves multiline editor text and height`() {
        view.set("```kotlin\nval one = 1\nval two = 2\nval three = 3\n```")
        val pane = scrolls().single()
        val editor = editors().single()
        val line = editor.getFontMetrics(editor.font).height
        val ins = pane.insets
        val pad = pane.viewportBorder.getBorderInsets(pane)
        val bar = pane.horizontalScrollBar.preferredSize.height

        assertEquals("val one = 1\nval two = 2\nval three = 3", editor.text)
        assertEquals(editor.preferredSize.height + ins.top + ins.bottom + pad.top + pad.bottom + bar, pane.preferredSize.height)
        assertTrue(pane.preferredSize.height >= line * 3)
    }

    fun `test fenced code block horizontal scrollbar has no bottom padding`() {
        view.set("```kotlin\n${"x".repeat(500)}\n```")
        val pane = scrolls().single()
        val pad = pane.viewportBorder.getBorderInsets(pane)

        assertEquals(SessionUiStyle.View.Code.VIEWPORT_BOTTOM_PADDING, pad.bottom)
        assertTrue(pane.horizontalScrollBar.preferredSize.height > 0)
    }

    fun `test short code block top padding balances hidden scrollbar space`() {
        view.set("```text\n[ALICE, ANNA]\n```")
        val pane = scrolls().single()
        val pad = pane.viewportBorder.getBorderInsets(pane)

        assertTrue(pad.top > pane.horizontalScrollBar.preferredSize.height)
        assertEquals(SessionUiStyle.View.Code.VIEWPORT_BOTTOM_PADDING, pad.bottom)
    }

    fun `test fenced code block height is not capped`() {
        val code = (1..24).joinToString("\n") { "val value$it = $it" }
        view.set("```kotlin\n$code\n```")
        val pane = scrolls().single()
        val editor = editors().single()
        val line = editor.getFontMetrics(editor.font).height

        assertTrue(pane.preferredSize.height >= line * 24)
    }

    fun `test fenced code block lays out to full editor height`() {
        val code = (1..30).joinToString("\n") { "val value$it = $it" }
        view.set("```kotlin\n$code\n```")
        val pane = scrolls().single()
        val editor = editors().single()

        layout(width = 420)

        assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER, pane.verticalScrollBarPolicy)
        assertTrue("scroll pane should use its full preferred height", pane.height >= pane.preferredSize.height)
        assertTrue("editor should not be clipped vertically", editor.height >= editor.preferredSize.height)
    }

    fun `test streaming fenced code block grows to full height`() {
        view.append("```java\nclass Example {\n")
        val initial = scrolls().single().preferredSize.height

        view.append((1..20).joinToString("\n", postfix = "\n") { "void method$it() {}" })
        view.append("}\n```")
        val pane = scrolls().single()
        val editor = editors().single()
        layout(width = 420)

        assertTrue("code block should grow after streamed lines", pane.preferredSize.height > initial)
        assertTrue("streamed editor should not be clipped vertically", editor.height >= editor.preferredSize.height)
    }

    fun `test consecutive prose blocks coalesce into one html pane`() {
        view.set("# Title\n\npara one\n\n- a\n- b")

        val pane = htmls().single()
        assertTrue(pane.text.contains("<h1>"))
        assertTrue(pane.text.contains("<p>"))
        assertTrue(pane.text.contains("<ul>"))
        assertTrue(pane.text.contains("<li>"))
    }

    fun `test code block separates surrounding prose runs`() {
        view.set("intro\n\n```kotlin\nval x = 1\n```\n\noutro")

        val html = htmls()
        assertEquals(2, html.size)
        assertEquals(1, scrolls().size)
        assertTrue(html[0].text.contains("intro"))
        assertTrue(html[1].text.contains("outro"))
    }

    fun `test indented code block separates prose and renders as editor`() {
        view.set("before\n\n    code line\n\nafter")

        val html = htmls()
        assertEquals(2, html.size)
        assertEquals(1, editors().size)
        assertTrue(html[0].text.contains("before"))
        assertEquals("code line", editors().single().text)
        assertTrue(html[1].text.contains("after"))
    }

    fun `test coalesced prose has no inter block struts`() {
        view.set("first\n\nsecond\n\n- third")

        assertEquals(1, htmls().size)
        assertTrue(struts().isEmpty())
    }

    fun `test thematic break after code block is filtered`() {
        view.set("```kotlin\nval x = 1\n```\n\n---\n\n# Next")

        val pane = htmls().single()

        assertEquals(1, scrolls().size)
        assertTrue(pane.text.contains("<h1>"))
        assertFalse(pane.text.contains("<hr"))
        assertFalse(view.html().contains("<hr"))
    }

    fun `test prose thematic break is filtered from coalesced pane`() {
        view.set("first\n\n---\n\nsecond\n\n- third")

        val pane = htmls().single()

        assertTrue(struts().isEmpty())
        assertTrue(pane.text.contains("first"))
        assertTrue(pane.text.contains("second"))
        assertTrue(pane.text.contains("<ul>"))
        assertFalse(pane.text.contains("<hr"))
        assertFalse(view.html().contains("<hr"))
    }

    fun `test prose and code boundaries keep struts`() {
        view.set("intro\n\n```kotlin\nval x = 1\n```\n\noutro")

        assertEquals(2, htmls().size)
        assertEquals(1, scrolls().size)
        assertEquals(2, struts().size)
    }

    fun `test streaming prose append reuses coalesced pane`() {
        view.append("first paragraph")
        val pane = htmls().single()

        view.append("\n\nsecond paragraph")

        val html = htmls().single()

        assertSame(pane, html)
        assertTrue(html.text.contains("first paragraph"))
        assertTrue(html.text.contains("second paragraph"))
    }

    fun `test alternating prose and code keeps expected component counts`() {
        view.set("before\n\n```kotlin\nval a = 1\n```\n\nmiddle\n\n```java\nclass A {}\n```\n\nafter")

        assertEquals(3, htmls().size)
        assertEquals(2, scrolls().size)
        assertEquals(4, struts().size)
    }

    fun `test appending later html block preserves earlier block component`() {
        view.set("first\n\nsecond")
        val first = htmls().first()

        view.append(" more")

        assertSame(first, htmls().first())
        assertTrue(view.html().contains("second more"))
    }

    fun `test streaming fenced code block preserves editor component`() {
        view.append("```java\nclass Example {\n")
        val pane = scrolls().single()
        val editor = editors().single()
        val initial = pane.preferredSize.height

        view.append("void method() {}\n}\n```")

        assertSame(pane, scrolls().single())
        assertSame(editor, editors().single())
        assertEquals("class Example {\nvoid method() {}\n}", editor.text)
        assertTrue(scrolls().single().preferredSize.height >= initial)
    }

    fun `test streaming code body append reuses editor and stays correct`() {
        view.append("```java\nclass A {\n")
        val pane = scrolls().single()
        val editor = editors().single()

        view.append("    void run() {\n")
        view.append("    }\n")

        assertSame(pane, scrolls().single())
        assertSame(editor, editors().single())
        assertEquals("class A {\n    void run() {\n    }", editor.text)
        assertEquals("```java\nclass A {\n    void run() {\n    }\n", view.markdown())
        assertTrue(view.html().contains("class A"))

        view.append("}\n```")

        assertSame(pane, scrolls().single())
        assertSame(editor, editors().single())
        assertEquals("class A {\n    void run() {\n    }\n}", editor.text)
        assertEquals("```java\nclass A {\n    void run() {\n    }\n}\n```", view.markdown())
    }

    fun `test streaming code body append keeps html in sync`() {
        view.append("```java\n")
        view.append("if (a < b) {\n")

        assertTrue(view.html().contains("a &lt; b"))
        assertEquals("if (a < b) {", editors().single().text)
    }

    fun `test streaming partial fence opener renders code block without raw marker`() {
        view.append("`")

        val pane = scrolls().single()
        val editor = editors().single()

        assertEquals("", editor.text)
        assertFalse(view.html().contains("`"))

        view.append("`")

        assertSame(pane, scrolls().single())
        assertSame(editor, editors().single())
        assertEquals("", editor.text)
        assertFalse(view.html().contains("``"))
    }

    fun `test streaming language prefix stays out of code text`() {
        view.append("```")
        view.append("p")
        view.append("ython\nprint(1)\n")

        assertEquals("print(1)", editors().single().text)
        assertFalse(view.html().contains("```"))
        assertFalse(view.html().contains("python"))
    }

    fun `test streaming partial closing fence stays out of code text`() {
        view.append("```python\nprint(1)\n")
        val pane = scrolls().single()
        val editor = editors().single()

        view.append("`")

        assertSame(pane, scrolls().single())
        assertSame(editor, editors().single())
        assertEquals("print(1)", editor.text)

        view.append("`")

        assertSame(pane, scrolls().single())
        assertSame(editor, editors().single())
        assertEquals("print(1)", editor.text)
    }

    fun `test completed closing fence preserves code block and renders following markdown`() {
        view.append("```python\nprint(1)\n``")
        val pane = scrolls().single()
        val editor = editors().single()

        view.append("`\n\nafter")

        assertSame(pane, scrolls().single())
        assertSame(editor, editors().single())
        assertEquals("print(1)", editor.text)
        assertEquals(1, scrolls().size)
        assertEquals(1, htmls().size)
        assertTrue(view.html().contains("after"))
    }

    fun `test appending new block preserves existing code block component`() {
        view.set("```kotlin\nval value = 1\n```")
        val pane = scrolls().single()
        val editor = editors().single()

        view.append("\n\nhello")

        assertSame(pane, scrolls().single())
        assertSame(editor, editors().single())
        assertEquals(1, scrolls().size)
        assertEquals(1, htmls().size)
    }

    fun `test incompatible suffix replacement preserves prefix block`() {
        view.set("before\n\n```kotlin\nval value = 1\n```")
        val prefix = htmls().single()
        val editor = editors().single().getEditor(true)!!

        view.set("before\n\nafter")
        drainEdt()

        assertSame(prefix, htmls().first())
        assertTrue(editor.isDisposed)
        assertTrue(scrolls().isEmpty())
    }

    fun `test java code block with blank lines fits vertically`() {
        val code = """
            import java.util.List;
            import java.util.stream.Collectors;

            public class StreamsExample {
                public static void main(String[] args) {
                    List<String> names = List.of("Alice", "Bob", "Charlie", "David", "Anna");

                    List<String> result = names.stream()
                            .filter(name -> name.startsWith("A"))
                            .map(String::toUpperCase)
                            .collect(Collectors.toList());

                    System.out.println(result);
                }
            }
        """.trimIndent()
        view.set("```java\n$code\n```")
        val pane = scrolls().single()
        val editor = editors().single()

        layout(width = 420)

        val line = editor.getFontMetrics(editor.font).height
        val rows = editor.text.lineSequence().count()
        assertTrue("java editor should reserve every document line", editor.preferredSize.height >= line * rows)
        assertTrue("java editor should not be clipped vertically", editor.height >= editor.preferredSize.height)
        assertTrue("java code block should not clip vertically", pane.height >= pane.preferredSize.height)
    }

    fun `test fenced code block resolves existing language aliases`() {
        view.set("```javascript\nconst value = 1\n```")

        assertSame(type("js"), editors().single().fileType)
    }

    fun `test fenced code block ignores whitespace metadata`() {
        view.set("```json title=\"sample.json\"\n{\"value\":1}\n```")

        assertSame(type("json"), editors().single().fileType)
    }

    fun `test fenced code block resolves new aliases when available`() {
        view.set("```yaml\nvalue: 1\n```")

        assertSame(type("yaml"), editors().single().fileType)
    }

    fun `test unknown fenced code language uses plain text`() {
        view.set("```definitely-not-a-language\nvalue\n```")

        assertSame(PlainTextFileType.INSTANCE, editors().single().fileType)
    }

    fun `test code block without language uses plain text`() {
        view.set("```\nvalue\n```")

        assertSame(PlainTextFileType.INSTANCE, editors().single().fileType)
    }

    fun `test fenced code block width is bounded and boxed`() {
        view.set("```kotlin\n${"x".repeat(500)}\n```")
        val pane = scrolls().single()
        val editor = editors().single()
        val ins = pane.border.getBorderInsets(pane)

        assertEquals(0, pane.preferredSize.width)
        assertTrue(editor.preferredSize.width > pane.preferredSize.width)
        assertTrue(pane.maximumSize.width > 1000)
        assertTrue(ins.top > 0)
        assertTrue(ins.left > 0)
        assertEquals(pane.background, pane.viewport.background)
    }

    fun `test clear resets source and components`() {
        view.set("```\ncode\n```")
        view.clear()

        assertEquals("", view.markdown())
        assertTrue(scrolls().isEmpty())
    }

    fun `test rerender disposes previous code block editor`() {
        view.set("```kotlin\nval value = 1\n```")
        val editor = editors().single().getEditor(true)!!

        view.set("plain text")
        drainEdt()

        assertTrue(editor.isDisposed)
        assertTrue(scrolls().isEmpty())
    }

    fun `test clear disposes code block editor`() {
        view.set("```kotlin\nval value = 1\n```")
        val editor = editors().single().getEditor(true)!!

        view.clear()
        drainEdt()

        assertTrue(editor.isDisposed)
    }

    fun `test dispose disposes code block editor`() {
        view.set("```kotlin\nval value = 1\n```")
        val editor = editors().single().getEditor(true)!!

        Disposer.dispose(view)
        disposed = true
        drainEdt()

        assertTrue(editor.isDisposed)
        assertTrue(scrolls().isEmpty())
    }

    fun `test applyStyle updates current and future blocks`() {
        val style = SessionEditorStyle.create(family = "Courier New", size = 21)

        view.applyStyle(style)
        view.set("hello")

        assertFalse(view.font.name == "Courier New")
        assertEquals(21, view.font.size)
        assertTrue(view.overrideSheet().contains(style.transcriptFont.name))
        assertTrue(view.overrideSheet().contains("Courier New"))
        assertTrue(view.overrideSheet().contains("21pt"))
    }

    fun `test applyStyle updates retained html block`() {
        view.set("hello")
        val pane = htmls().single()
        val style = SessionEditorStyle.create(family = "Courier New", size = 21)

        view.applyStyle(style)

        assertSame(pane, htmls().single())
        assertTrue(view.overrideSheet().contains(style.transcriptFont.name))
        assertTrue(view.overrideSheet().contains("Courier New"))
        assertTrue(view.overrideSheet().contains("21pt"))
    }

    fun `test applyStyle reapplies same style to retained html block`() {
        view.set("hello")
        val pane = htmls().single()
        pane.background = Color.RED
        val style = SessionEditorStyle.current()

        view.applyStyle(style)

        assertSame(pane, htmls().single())
        assertEquals(view.background, pane.background)
        assertTrue(pane.text.contains("hello"))
    }

    fun `test resetStyles keeps content rendered`() {
        view.set("hello **world**")
        view.font = view.font.deriveFont(25f)

        view.resetStyles()

        assertEquals("hello **world**", view.markdown())
        assertTrue(view.html().contains("<strong>"))
    }

    fun `test link listener receives simulated link`() {
        val received = mutableListOf<MdView.LinkEvent>()
        view.addLinkListener { received.add(it) }

        view.simulateLink("https://example.com")

        assertEquals("https://example.com", received.single().href)
    }

    private fun scrolls(): List<JBScrollPane> = (view.component as JPanel).components.filterIsInstance<JBScrollPane>()

    private fun htmls(): List<JBHtmlPane> = (view.component as JPanel).components.filterIsInstance<JBHtmlPane>()

    private fun struts(): List<Box.Filler> = (view.component as JPanel).components.filterIsInstance<Box.Filler>()

    private fun editors(): List<EditorTextField> = scrolls().mapNotNull { it.viewport.view as? EditorTextField }

    private fun type(ext: String): FileType {
        val type = FileTypeRegistry.getInstance().getFileTypeByExtension(ext)
        if (type == UnknownFileType.INSTANCE) return PlainTextFileType.INSTANCE
        return type
    }

    private fun layout(width: Int) {
        val host = JPanel(BorderLayout())
        host.add(view.component, BorderLayout.CENTER)
        host.setSize(width, view.component.preferredSize.height)
        host.doLayout()
        view.component.doLayout()
        scrolls().forEach { it.doLayout() }
    }

    private fun drainEdt() {
        UIUtil.dispatchAllInvocationEvents()
    }
}
