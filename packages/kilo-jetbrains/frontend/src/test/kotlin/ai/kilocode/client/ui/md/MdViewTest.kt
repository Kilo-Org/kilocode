package ai.kilocode.client.ui.md

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Color
import java.awt.Font

/**
 * Tests for the hybrid markdown renderer's HTML and CSS output.
 *
 * Uses [BasePlatformTestCase] to get a real IntelliJ Application so that
 * JBHtmlPane initialisation works correctly.
 */
@Suppress("UnstableApiUsage")
class MdViewTest : BasePlatformTestCase() {

    private lateinit var view: MdView

    override fun setUp() {
        super.setUp()
        view = MdViewFactory.html()
    }

    override fun tearDown() {
        try {
            if (this::view.isInitialized) Disposer.dispose(view)
        } finally {
            super.tearDown()
        }
    }

    // ---- set ----

    fun `test set stores source`() {
        view.set("hello **world**")
        assertEquals("hello **world**", view.markdown())
    }

    fun `test set replaces previous content`() {
        view.set("first")
        view.set("second")
        assertEquals("second", view.markdown())
    }

    fun `test set renders bold`() {
        view.set("hello **world**")
        assertTrue(view.html().contains("<strong>"))
        assertTrue(view.html().contains("world"))
    }

    fun `test set renders italic`() {
        view.set("hello *world*")
        assertTrue(view.html().contains("<em>"))
    }

    fun `test set renders inline code`() {
        view.set("use `foo()` here")
        val color = MdCommon.hex(MdCommon.defaults(SessionEditorStyle.current()).inlineCodeFg)
        val html = view.html()

        assertTrue(html.contains("<code style=\"color: $color\">foo()</code>"))
        assertFalse(html.contains("<code style=\"background"))
    }

    fun `test set renders fenced code block`() {
        view.set("```kotlin\nval x = 1\n```")
        assertTrue(view.html().contains("<pre>"))
        assertTrue(view.html().contains("<code"))
    }

    fun `test set renders links`() {
        view.set("[click](https://example.com)")
        assertTrue(view.html().contains("<a"))
        assertTrue(view.html().contains("https://example.com"))
    }

    fun `test set renders prose file refs as underlined brown links`() {
        view.set("See packages/opencode/src/session/prompt.ts")
        val color = MdCommon.hex(SessionUiStyle.View.Markdown.string())
        val html = view.html()
        val sheet = view.overrideSheet()

        assertTrue(html.contains("<a class=\"kilo-file-ref\" href=\"packages/opencode/src/session/prompt.ts\">packages/opencode/src/session/prompt.ts</a>"))
        assertTrue(sheet.contains("a.kilo-file-ref, code a.kilo-file-ref { color: $color; font-family:"))
        assertTrue(sheet.contains("monospace; text-decoration: underline"))
    }

    fun `test inline code file refs keep code color and become file links`() {
        view.set("See `packages/opencode/src/session/prompt.ts`")
        val color = MdCommon.hex(SessionUiStyle.View.Markdown.string())
        val html = view.html()

        assertTrue(html.contains("<code style=\"color: $color\"><a class=\"kilo-file-ref\" href=\"packages/opencode/src/session/prompt.ts\">packages/opencode/src/session/prompt.ts</a></code>"))
        assertFalse(html.contains("background:"))
    }

    fun `test file refs keep line suffix and trailing punctuation outside link`() {
        view.set("See kilocode/session/prompt.ts:302 and native-plan-prompt.txt:37-38.")
        val html = view.html()

        assertTrue(html.contains("href=\"kilocode/session/prompt.ts:302\">kilocode/session/prompt.ts:302</a>"))
        assertTrue(html.contains("href=\"native-plan-prompt.txt:37-38\">native-plan-prompt.txt:37-38</a>."))
    }

    fun `test framework names are not file ref links`() {
        view.set("Next.js, Node.js, Vue.js, and Chart.js are framework names, not paths.")
        val html = view.html()

        assertFalse(html.contains("kilo-file-ref"))
    }

    fun `test existing markdown links are not file ref links`() {
        view.set("[prompt](packages/opencode/src/session/prompt.ts)")
        val html = view.html()

        assertTrue(html.contains("prompt"))
        assertFalse(html.contains("kilo-file-ref"))
    }

    fun `test fenced code file refs are not file ref links`() {
        view.set("```text\npackages/opencode/src/session/prompt.ts\n```")
        val html = view.html()

        assertTrue(html.contains("packages/opencode/src/session/prompt.ts"))
        assertFalse(html.contains("kilo-file-ref"))
    }

    fun `test set renders headings`() {
        view.set("# Title")
        assertTrue(view.html().contains("<h1>"))
    }

    fun `test set renders unordered list`() {
        view.set("- one\n- two\n- three")
        assertTrue(view.html().contains("<ul>"))
        assertTrue(view.html().contains("<li>"))
    }

    fun `test set renders ordered list`() {
        view.set("1. one\n2. two\n3. three")
        assertTrue(view.html().contains("<ol>"))
    }

    fun `test set renders blockquote`() {
        view.set("> quoted text")
        assertTrue(view.html().contains("<blockquote>"))
    }

    fun `test set renders strikethrough`() {
        view.set("~~deleted~~")
        assertTrue(view.html().contains("<del>"))
    }

    fun `test set renders table`() {
        view.set("| a | b |\n|---|---|\n| 1 | 2 |")
        assertTrue(view.html().contains("<table>"))
        assertTrue(view.html().contains("<th>"))
        assertTrue(view.html().contains("<td>"))
    }

    fun `test set renders autolink`() {
        view.set("Visit https://example.com for details")
        assertTrue(view.html().contains("<a"))
        assertTrue(view.html().contains("https://example.com"))
    }

    // ---- append ----

    fun `test append accumulates source`() {
        view.append("hello ")
        view.append("**world**")
        assertEquals("hello **world**", view.markdown())
    }

    fun `test append renders accumulated content`() {
        view.append("hello ")
        view.append("**world**")
        assertTrue(view.html().contains("<strong>"))
    }

    fun `test append after set extends content`() {
        view.set("first ")
        view.append("second")
        assertEquals("first second", view.markdown())
    }

    // ---- clear ----

    fun `test clear resets source`() {
        view.set("some content")
        view.clear()
        assertEquals("", view.markdown())
    }

    fun `test clear resets rendered html`() {
        view.set("some content")
        view.clear()
        assertFalse(view.html().contains("some content"))
    }

    // ---- link listener ----

    fun `test link listener receives event on activation`() {
        val received = mutableListOf<MdView.LinkEvent>()
        view.addLinkListener { received.add(it) }
        view.set("[click](https://example.com)")
        view.simulateLink("https://example.com")
        assertEquals(1, received.size)
        assertEquals("https://example.com", received[0].href)
    }

    fun `test multiple link listeners all receive event`() {
        val first = mutableListOf<MdView.LinkEvent>()
        val second = mutableListOf<MdView.LinkEvent>()
        view.addLinkListener { first.add(it) }
        view.addLinkListener { second.add(it) }
        view.simulateLink("https://a.com")
        assertEquals(1, first.size)
        assertEquals(1, second.size)
    }

    fun `test removed listener does not receive events`() {
        val received = mutableListOf<MdView.LinkEvent>()
        val listener = MdView.LinkListener { received.add(it) }
        view.addLinkListener(listener)
        view.removeLinkListener(listener)
        view.simulateLink("https://example.com")
        assertTrue(received.isEmpty())
    }

    // ---- component ----

    fun `test component is not null`() {
        assertNotNull(view.component)
    }

    // ---- complex markdown ----

    fun `test complex markdown with mixed elements`() {
        val md = """
            # Heading
            
            Some **bold** and *italic* text with `code`.
            
            - item one
            - item two
            
            ```
            code block
            ```
            
            > blockquote
            
            [link](https://example.com)
        """.trimIndent()

        view.set(md)
        val html = view.html()
        assertTrue(html.contains("<h1>"))
        assertTrue(html.contains("<strong>"))
        assertTrue(html.contains("<em>"))
        assertTrue(html.contains("<code style=\"color:"))
        assertTrue(html.contains("<ul>"))
        assertTrue(html.contains("<pre>"))
        assertTrue(html.contains("<blockquote>"))
        assertTrue(html.contains("<a"))
    }

    fun `test streaming simulation appends tokens`() {
        val tokens = listOf("Hello ", "**wor", "ld**", "\n\n", "Done.")
        for (token in tokens) view.append(token)
        assertEquals("Hello **world**\n\nDone.", view.markdown())
        assertTrue(view.html().contains("<strong>"))
        assertTrue(view.html().contains("Done."))
    }

    // ---- style overrides ----

    fun `test override sheet includes session style defaults`() {
        val style = SessionEditorStyle.current()

        assertTrue(view.overrideSheet().contains(style.editorFamily))
        assertTrue(view.overrideSheet().contains("${style.editorSize}pt"))
    }

    fun `test override sheet includes markdown role color rules`() {
        val sheet = view.overrideSheet()

        assertTrue(sheet.contains("h1, h2, h3, h4, h5, h6"))
        assertTrue(sheet.contains("strong, b"))
        assertTrue(sheet.contains("em, i"))
        assertTrue(sheet.contains("ul, ol"))
        assertTrue(sheet.contains("li { color:"))
        assertTrue(sheet.contains("blockquote"))
        assertTrue(sheet.contains("th, td"))
        assertTrue(sheet.contains("th { color:"))
        assertTrue(sheet.contains("hr {"))
        assertTrue(sheet.contains("pre code"))
    }

    fun `test override sheet separates table and code block borders`() {
        view.tableBorder = Color(0x12, 0x34, 0x56)
        val sheet = view.overrideSheet()
        val pre = sheet.substringAfter("pre {").substringBefore("} pre code")
        val cells = sheet.substringAfter("th, td {").substringBefore("}")

        assertTrue(cells.contains("#123456"))
        assertFalse(pre.contains("#123456"))
        assertTrue(pre.contains("border-color:"))
    }

    fun `test applyStyle derives markdown colors from editor scheme`() {
        val style = customStyle()
        val color = MdCommon.hex(SessionUiStyle.View.Markdown.string())
        val quote = "#445566"

        view.applyStyle(style)
        view.set("use `inline` code")
        val sheet = view.overrideSheet()
        val html = view.html()

        assertTrue(sheet.contains("a { color: #778899"))
        assertTrue(html.contains("<code style=\"color: $color\">inline</code>"))
        assertFalse(html.contains("background: #112233"))
        assertFalse(html.contains("#cc8866"))
        assertTrue(sheet.contains("pre { background: #445566; color: #ddeeff; border-color: #223344"))
        assertTrue(sheet.contains("blockquote { background:"))
        assertTrue(sheet.contains("border-left-color: #223344; color: $quote"))
        assertTrue(sheet.contains("blockquote p { color: $quote"))
        assertTrue(sheet.contains("th, td { border-color: #223344"))
    }

    // ---- style overrides appear in override sheet when set ----

    fun `test foreground override appears in override sheet`() {
        view.foreground = Color(0xAA, 0xBB, 0xCC)
        view.set("text")
        assertTrue(view.overrideSheet().contains("#aabbcc"))
    }

    fun `test link color override appears in override sheet`() {
        view.linkColor = Color(0xFF, 0x00, 0x77)
        view.set("[a](https://x.com)")
        assertTrue(view.overrideSheet().contains("#ff0077"))
    }

    fun `test code bg override does not add inline code background`() {
        view.codeBg = Color(0x10, 0x20, 0x30)
        view.set("`code`")
        assertFalse(view.overrideSheet().contains("#102030"))
        assertFalse(view.html().contains("#102030"))
    }

    fun `test pre bg and fg overrides appear in override sheet`() {
        view.preBg = Color(0x0A, 0x0B, 0x0C)
        view.preFg = Color(0xD0, 0xE0, 0xF0)
        view.set("```\ncode\n```")
        val sheet = view.overrideSheet()
        assertTrue(sheet.contains("#0a0b0c"))
        assertTrue(sheet.contains("pre {"))
        assertTrue(sheet.contains("#d0e0f0"))
    }

    fun `test code font override appears in override sheet`() {
        view.codeFont = "Fira Code"
        view.set("`x`")
        val sheet = view.overrideSheet()

        assertTrue(sheet.contains("tt, code, samp, pre, pre code { font-family: 'Fira Code', monospace"))
        assertTrue(sheet.contains("a.kilo-file-ref, code a.kilo-file-ref { color:"))
        assertTrue(sheet.contains("font-family: 'Fira Code', monospace; text-decoration: underline"))
    }

    fun `test prose keeps transcript font while inline code uses editor font`() {
        val style = SessionEditorStyle.create(family = "Courier New", size = 21)

        view.applyStyle(style)
        view.set("hello `code` packages/opencode/src/session/prompt.ts")
        val sheet = view.overrideSheet()

        assertTrue(sheet.contains("body { color:"))
        assertTrue(sheet.contains("font-family: '${style.transcriptFont.name}', sans-serif"))
        assertTrue(sheet.contains("tt, code, samp, pre, pre code { font-family: 'Courier New', monospace"))
    }

    fun `test blockquote color overrides appear in override sheet`() {
        view.quoteBorder = Color(0xAA, 0x00, 0x00)
        view.quoteFg = Color(0x00, 0xBB, 0x00)
        view.set("> quote")
        val sheet = view.overrideSheet()
        assertTrue(sheet.contains("#aa0000"))
        assertTrue(sheet.contains("#00bb00"))
    }

    fun `test table border override appears in override sheet`() {
        view.tableBorder = Color(0x12, 0x34, 0x56)
        view.set("| a |\n|---|\n| 1 |")
        assertTrue(view.overrideSheet().contains("#123456"))
    }

    fun `test font family override appears in override sheet`() {
        view.font = Font("Courier New", Font.PLAIN, 14)
        view.set("text")
        assertTrue(view.overrideSheet().contains("Courier New"))
    }

    fun `test font size override appears in override sheet`() {
        view.font = Font("Arial", Font.PLAIN, 18)
        view.set("text")
        assertTrue(view.overrideSheet().contains("18pt"))
    }

    fun `test italic font override appears in override sheet`() {
        view.font = Font("Arial", Font.ITALIC, 18)
        view.set("text")
        assertTrue(view.overrideSheet().contains("font-style: italic"))
    }

    fun `test font override targets markdown elements`() {
        view.font = Font("Courier New", Font.PLAIN, 14)
        view.set("# title\n\ntext\n\n`code`")
        val sheet = view.overrideSheet()

        assertTrue(sheet.contains("p {"))
        assertTrue(sheet.contains("h1 {"))
        assertTrue(sheet.contains("code {"))
    }

    fun `test style change re-renders and override sheet reflects change`() {
        view.set("hello")
        view.foreground = Color(0xDE, 0xAD, 0x00)
        assertTrue(view.overrideSheet().contains("#dead00"))
        assertTrue(view.html().contains("hello"))
    }

    fun `test applying same style reapplies component background`() {
        view.set("hello")
        view.component.background = Color.RED
        val style = SessionEditorStyle.current()

        view.applyStyle(style)

        assertEquals(view.background, view.component.background)
        assertTrue(view.html().contains("hello"))
    }

    fun `test style change without content does not crash`() {
        view.foreground = Color.RED
        view.linkColor = Color.BLUE
        view.codeFont = "Monospaced"
        assertEquals("", view.markdown())
    }

    // ---- default codeFont uses session style ----

    fun `test default codeFont is session editor font`() {
        val style = SessionEditorStyle.current()

        assertEquals(style.editorFamily, view.codeFont)
    }

    fun `test default override sheet includes session style before any set`() {
        assertTrue(view.overrideSheet().contains(SessionEditorStyle.current().editorFamily))
    }

    // ---- background sets component background ----

    fun `test background override sets component background`() {
        view.background = Color(0x11, 0x22, 0x33)
        assertEquals(Color(0x11, 0x22, 0x33), view.component.background)
    }

    fun `test background override does not appear in override sheet`() {
        // background is applied to the Swing component, not via CSS override rule
        view.background = Color(0x11, 0x22, 0x33)
        view.set("text")
        assertFalse(view.overrideSheet().contains("#112233"))
    }

    // ---- opaque / transparent ----

    fun `test opaque true sets component opaque`() {
        view.opaque = true
        assertTrue(view.component.isOpaque)
    }

    fun `test opaque false sets component non-opaque`() {
        view.opaque = false
        assertFalse(view.component.isOpaque)
    }

    fun `test opaque false adds transparent background to override sheet`() {
        view.opaque = false
        view.set("text")
        assertTrue(view.overrideSheet().contains("transparent"))
    }

    fun `test opaque true does not add transparent rule`() {
        view.opaque = true
        view.set("text")
        assertFalse(view.overrideSheet().contains("transparent"))
    }

    fun `test opaque false does not affect pre background override`() {
        view.opaque = false
        view.preBg = Color(0x0A, 0x0B, 0x0C)
        view.set("```\ncode\n```")
        assertTrue(view.overrideSheet().contains("#0a0b0c"))
    }

    fun `test background override applied to component when opaque is true`() {
        view.background = Color(0xFE, 0xFE, 0xFE)
        view.opaque = true
        assertEquals(Color(0xFE, 0xFE, 0xFE), view.component.background)
    }

    fun `test opaque toggle updates component opacity`() {
        view.opaque = false
        assertFalse(view.component.isOpaque)
        view.opaque = true
        assertTrue(view.component.isOpaque)
    }

    // ---- resetStyles ----

    fun `test resetStyles clears foreground override`() {
        view.foreground = Color.RED
        view.resetStyles()
        assertFalse(view.overrideSheet().contains("#ff0000"))
    }

    fun `test resetStyles clears all overrides`() {
        view.foreground = Color.RED
        view.linkColor = Color.BLUE
        view.codeBg = Color.GREEN
        view.preBg = Color.ORANGE
        view.preFg = Color.CYAN
        view.codeFont = "Monospaced"
        view.quoteBorder = Color.PINK
        view.quoteFg = Color.MAGENTA
        view.tableBorder = Color.YELLOW
        view.font = Font("Arial", Font.PLAIN, 18)
        view.resetStyles()
        val sheet = view.overrideSheet()
        assertFalse(sheet.contains("Arial"))
        assertTrue(sheet.contains(SessionEditorStyle.current().editorFamily))
    }

    fun `test resetStyles restores opaque to true`() {
        view.opaque = false
        view.resetStyles()
        assertTrue(view.component.isOpaque)
    }

    fun `test resetStyles after set still renders content`() {
        view.set("hello **world**")
        view.foreground = Color.RED
        view.resetStyles()
        assertTrue(view.html().contains("<strong>"))
    }

}
