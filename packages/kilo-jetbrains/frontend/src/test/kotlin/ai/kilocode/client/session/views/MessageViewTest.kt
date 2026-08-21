package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.ToolKind
import ai.kilocode.client.session.views.question.QuestionResultView
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
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
}
