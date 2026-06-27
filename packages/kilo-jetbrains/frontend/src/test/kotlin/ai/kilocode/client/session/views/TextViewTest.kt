package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.FileAttachment
import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.PartSourceDto
import ai.kilocode.rpc.dto.PartSourceTextDto
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
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

        view.simulateLink("https://kilocode.ai/docs")

        assertEquals(listOf("https://kilocode.ai/docs"), urls)
    }

    fun `test linkifyMentions rewrites tracked token`() {
        val out = linkifyMentions(
            "read @src/a.kt",
            listOf(PromptMention("@src/a.kt", "src/a.kt", 5, 14)),
        )

        assertEquals("read [@src/a.kt](src/a.kt)", out)
    }

    fun `test linkifyMentions escapes text and encodes href`() {
        val out = linkifyMentions(
            "open @[a] file.kt",
            listOf(PromptMention("@[a] file.kt", "[a] file.kt", 5, 17)),
        )

        assertEquals("open [@\\[a\\] file.kt]([a]%20file.kt)", out)
    }

    fun `test linkifyMentions handles multiple mentions by offset`() {
        val out = linkifyMentions(
            "read @src/a.kt and @src/b.kt",
            listOf(
                PromptMention("@src/a.kt", "src/a.kt", 5, 14),
                PromptMention("@src/b.kt", "src/b.kt", 19, 28),
            ),
        )

        assertEquals("read [@src/a.kt](src/a.kt) and [@src/b.kt](src/b.kt)", out)
    }

    fun `test linkifyMentions falls back to literal replacement when offset drifts`() {
        val out = linkifyMentions(
            "read @src/a.kt",
            listOf(PromptMention("@src/a.kt", "src/a.kt", 0, 4)),
        )

        assertEquals("read [@src/a.kt](src/a.kt)", out)
    }

    fun `test linkifyMentions fallback does not relink generated markdown`() {
        val out = linkifyMentions(
            "read @src/a.kt and @src/a.kt",
            listOf(
                PromptMention("@src/a.kt", "src/a.kt", 5, 14),
                PromptMention("@src/a.kt", "src/a.kt", 0, 4),
            ),
        )

        assertEquals("read [@src/a.kt](src/a.kt) and [@src/a.kt](src/a.kt)", out)
    }

    fun `test linkifyMentions leaves text without mentions unchanged`() {
        assertEquals("read @src/a.kt", linkifyMentions("read @src/a.kt", emptyList()))
    }

    fun `test promptMentions extracts source backed text files`() {
        val msg = Message(MessageDto("m1", "ses", "user", MessageTimeDto(0.0)))
        msg.parts["keep"] = file("keep", "text/plain", "@src/a.kt", "src/a.kt", 0, 9)
        msg.parts["image"] = file("image", "image/png", "@src/a.png", "src/a.png", 0, 10)
        msg.parts["blank"] = file("blank", "text/plain", "@src/b.kt", "", 0, 9)
        msg.parts["plain"] = FileAttachment("plain").also { it.mime = "text/plain" }

        val mentions = promptMentions(msg)
        assertEquals(1, mentions.size)
        assertEquals("@src/a.kt", mentions.single().token)
        assertEquals("src/a.kt", mentions.single().path)
        assertEquals(0, mentions.single().start)
        assertEquals(9, mentions.single().end)
        assertSame(msg.parts["keep"], mentions.single().attachment)
    }

    fun `test prompt view renders mention as link`() {
        val text = Text("p1").also { it.content.append("read @src/a.kt") }
        val view = PromptView(text, mentions = listOf(PromptMention("@src/a.kt", "src/a.kt", 5, 14)))

        assertEquals("read [@src/a.kt](src/a.kt)", view.markdown())
        assertTrue(view.md.html().contains("href=\"src/a.kt\""))
        assertTrue(view.md.html().contains("@src/a.kt"))
    }

    fun `test prompt view routes mention links to file and urls to browser`() {
        val files = mutableListOf<String>()
        val urls = mutableListOf<String>()
        val text = Text("p1").also { it.content.append("read @src/a file.kt") }
        val view = PromptView(
            text,
            openFile = { files.add(it) },
            openUrl = { urls.add(it) },
            mentions = listOf(PromptMention("@src/a file.kt", "src/a file.kt", 5, 19)),
        )

        view.simulateLink("src/a%20file.kt")
        view.simulateLink("https://kilocode.ai/docs")

        assertEquals(listOf("src/a file.kt"), files)
        assertEquals(listOf("https://kilocode.ai/docs"), urls)
    }

    fun `test prompt view routes attachment backed mention link to attachment opener`() {
        val opened = mutableListOf<FileAttachment>()
        val item = file("f1", "text/plain", "@git-changes", "git-changes", 7, 19).also {
            it.url = "data:text/plain;charset=utf-8,diff%20content"
            it.filename = "git-changes.txt"
        }
        val text = Text("p1").also { it.content.append("review @git-changes") }
        val view = PromptView(
            text,
            openFile = { error("should not open file") },
            openAttachment = { opened.add(it) },
            mentions = listOf(PromptMention("@git-changes", "git-changes", 7, 19, item)),
        )

        view.simulateLink("git-changes")

        assertEquals(listOf(item), opened)
    }

    fun `test prompt view setMentions refreshes existing prompt`() {
        val text = Text("p1").also { it.content.append("read @src/a.kt") }
        val view = PromptView(text)

        view.setMentions(listOf(PromptMention("@src/a.kt", "src/a.kt", 5, 14)))

        assertEquals("read [@src/a.kt](src/a.kt)", view.markdown())
    }

    fun `test message view syncs prompt mentions from hidden part`() {
        val msg = Message(MessageDto("m1", "ses", "user", MessageTimeDto(0.0)))
        val view = MessageView(msg, openFile = {})
        val text = Text("p1").also { it.content.append("read @src/a.kt") }
        msg.parts["p1"] = text
        view.upsertPart(text)

        assertEquals("read @src/a.kt", (view.part("p1") as PromptView).markdown())

        val mention = file("f1", "text/plain", "@src/a.kt", "src/a.kt", 5, 14)
        msg.parts["f1"] = mention
        view.upsertPart(mention)

        assertNull(view.part("f1"))
        assertEquals("read [@src/a.kt](src/a.kt)", (view.part("p1") as PromptView).markdown())
    }

    fun `test prompt view colors links with metadata color`() {
        val style = SessionEditorStyle.current()
        val color = style.editorScheme.getAttributes(DefaultLanguageHighlighterColors.METADATA)?.foregroundColor
        val view = PromptView(Text("p1"))
        val before = view.md.linkColor

        view.applyStyle(style)

        assertEquals(color ?: before, view.md.linkColor)
    }

    private fun file(id: String, mime: String, token: String, path: String, start: Int, end: Int) = FileAttachment(id).also {
        it.mime = mime
        it.source = PartSourceDto("file", PartSourceTextDto(token, start.toDouble(), end.toDouble()), path = path)
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
