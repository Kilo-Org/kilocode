package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.model.Notice
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.ToolKind
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.views.question.QuestionResultView
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import com.intellij.ui.HyperlinkLabel
import com.intellij.ui.components.JBLabel
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Component
import java.awt.Container
import javax.swing.SwingUtilities

class MessageViewTest : BasePlatformTestCase() {
    // A user message can carry both a prompt bubble (wrapped, lower component index) and a tool
    // view added after it. Replacing that tool (e.g. a completed question) must reuse the tool's
    // own slot, not the prompt wrap's lower index, or the replacement jumps above the bubble.
    fun `test replacing a tool view keeps it below the prompt bubble`() {
        val msg = Message(MessageDto("m1", "ses", "user", MessageTimeDto(0.0)))
        val view = MessageView(msg, openFile = { _, _ -> })

        val text = Text("p1").also { it.content.append("do the thing") }
        msg.parts["p1"] = text
        view.upsertPart(text)

        val tool = Tool("t1", "question", ToolKind.GENERIC).also {
            it.state = ToolExecState.RUNNING
            it.input = mapOf("questions" to """[{"question":"Proceed?"}]""")
        }
        msg.parts["t1"] = tool
        view.upsertPart(tool)

        tool.state = ToolExecState.COMPLETED
        tool.metadata = mapOf("answers" to """[["Yes"]]""")
        view.upsertPart(tool)

        val result = view.part("t1")
        val prompt = view.part("p1")
        assertNotNull(result)
        assertNotNull(prompt)
        assertTrue(result is QuestionResultView)
        val children = view.components.toList()
        val wrapIndex = children.indexOfFirst { SwingUtilities.isDescendingFrom(prompt, it) }
        val resultIndex = children.indexOf(result)
        assertTrue("prompt bubble is a direct child", wrapIndex >= 0)
        assertTrue("question result stays below the prompt bubble", resultIndex > wrapIndex)
    }

    // An empty message must stay hidden so SessionLayout skips it (no stray gap/stripe at the top of a
    // turn), and must reappear as soon as content arrives — then hide again if that content is removed.
    fun `test empty message is hidden until content arrives`() {
        val msg = Message(MessageDto("m1", "ses", "user", MessageTimeDto(0.0)))
        val view = MessageView(msg, openFile = { _, _ -> })
        assertFalse("empty message starts hidden", view.isVisible)

        val text = Text("p1").also { it.content.append("hi") }
        msg.parts["p1"] = text
        view.upsertPart(text)
        assertTrue("message shows once it has content", view.isVisible)

        view.removePart("p1")
        assertFalse("message hides again when content is removed", view.isVisible)
    }

    // An attachment the server could not read renders as an inline notice rather than a raw
    // synthetic text part, and names the file so the user knows what was skipped.
    fun `test notice renders an inline notice view with the attachment name`() {
        val msg = Message(MessageDto("m1", "ses", "user", MessageTimeDto(0.0)))
        val view = MessageView(msg, openFile = { _, _ -> })

        val notice = Notice("p1", "attachment_read_failed", "report.jfr")
        msg.parts["p1"] = notice
        view.upsertPart(notice)

        val rendered = view.part("p1")
        assertTrue(rendered is NoticeView)
        assertEquals(
            KiloBundle.message("session.notice.attachment.read.failed", "report.jfr"),
            (rendered as NoticeView).text(),
        )
    }

    // The notice belongs to the prompt bubble, like the attachment chips, so reverting the message
    // rolls the notice back together with the rest of the prompt instead of leaving it behind.
    fun `test notice renders inside the prompt bubble`() {
        val msg = Message(MessageDto("m1", "ses", "user", MessageTimeDto(0.0)))
        val view = MessageView(msg, openFile = { _, _ -> })

        val prompt = Text("p1").also { it.content.append("check this") }
        val notice = Notice("n1", "attachment_read_failed", "report.jfr")
        msg.parts["p1"] = prompt
        msg.parts["n1"] = notice
        view.upsertPart(prompt)
        view.upsertPart(notice)

        val promptView = view.part("p1")
        val noticeView = view.part("n1")
        assertNotNull(promptView)
        assertNotNull(noticeView)
        assertFalse("notice is not a separate top-level row", view.components.contains(noticeView))
        assertTrue(
            "notice sits inside the prompt box",
            SwingUtilities.isDescendingFrom(noticeView, promptView!!.parent.parent),
        )
    }

    // A prompt Kilo composed shows the same attribution header as VS Code and starts collapsed to
    // its first paragraph, with a control that expands it again.
    fun `test injected prompt shows header and collapses to the first paragraph`() {
        val msg = Message(MessageDto("m1", "ses_user", "user", MessageTimeDto(0.0)))
        val view = MessageView(msg, openFile = { _, _ -> })

        val text = Text("p1").also {
            it.injectedTitle = "Update from main"
            it.content.append("Update the current branch in the worktree.\n\nSecond paragraph.\n\nThird paragraph.")
        }
        msg.parts["p1"] = text
        view.upsertPart(text)

        val label = find(view) { it is JBLabel && it.text == "Sent by Kilo \u00B7 Update from main" }
        val toggle = find(view) { it is HyperlinkLabel } as? HyperlinkLabel
        assertNotNull("attribution label is shown", label)
        assertNotNull("collapse control is shown", toggle)
        assertEquals("Show prompt", toggle!!.text)
        assertNull("the full prompt is detached while collapsed", view.part("p1")!!.parent)

        toggle.doClick()

        assertEquals("Hide prompt", toggle.text)
        assertNotNull("expanding attaches the full prompt", view.part("p1")!!.parent)

        toggle.doClick()

        assertEquals("Show prompt", toggle.text)
        assertNull("collapsing detaches the full prompt again so it no longer sizes the bubble", view.part("p1")!!.parent)
    }

    fun `test short injected prompt shows header without a collapse control`() {
        val msg = Message(MessageDto("m1", "ses_short", "user", MessageTimeDto(0.0)))
        val view = MessageView(msg, openFile = { _, _ -> })

        val text = Text("p1").also {
            it.injectedTitle = "Update from main"
            it.content.append("Short prompt.")
        }
        msg.parts["p1"] = text
        view.upsertPart(text)

        assertNotNull(find(view) { it is JBLabel && it.text == "Sent by Kilo \u00B7 Update from main" })
        val toggle = find(view) { it is HyperlinkLabel } as? HyperlinkLabel
        assertNotNull(toggle)
        assertFalse("a short prompt has nothing to collapse", toggle!!.isVisible)
        assertTrue(view.part("p1")!!.isVisible)
    }

    // An unrecognized notice kind (a newer server) must not leak the raw snake_case token into the
    // transcript; it falls back to a bundled generic sentence.
    fun `test notice falls back to a generic sentence for an unknown kind`() {
        val msg = Message(MessageDto("m1", "ses", "user", MessageTimeDto(0.0)))
        val view = MessageView(msg, openFile = { _, _ -> })

        val notice = Notice("p1", "some_future_notice_kind", null)
        msg.parts["p1"] = notice
        view.upsertPart(notice)

        val text = (view.part("p1") as NoticeView).text()
        assertEquals(KiloBundle.message("session.notice.unknown"), text)
        assertFalse(text.contains("some_future_notice_kind"))
    }

    private fun find(root: Component, predicate: (Component) -> Boolean): Component? {
        if (predicate(root)) return root
        if (root !is Container) return null
        return root.components.firstNotNullOfOrNull { find(it, predicate) }
    }
}
