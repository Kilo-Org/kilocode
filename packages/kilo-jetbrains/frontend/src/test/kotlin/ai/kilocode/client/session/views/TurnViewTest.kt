package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.model.Text
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Tests for [TurnView] and [MessageView].
 */
@Suppress("UnstableApiUsage")
class TurnViewTest : BasePlatformTestCase() {

    // ------ TurnView ------

    fun `test new TurnView is empty`() {
        val tv = TurnView("t1")
        assertTrue(tv.messageIds().isEmpty())
    }

    fun `test addMessage appends and returns view`() {
        val tv = TurnView("t1")
        val mv = tv.addMessage(msg("u1", "user"))
        assertEquals("u1", mv.msg.info.id)
        assertEquals(listOf("u1"), tv.messageIds())
    }

    fun `test addMessage preserves insertion order`() {
        val tv = TurnView("t1")
        tv.addMessage(msg("u1", "user"))
        tv.addMessage(msg("a1", "assistant"))
        tv.addMessage(msg("a2", "assistant"))
        assertEquals(listOf("u1", "a1", "a2"), tv.messageIds())
    }

    fun `test messageView returns the view for a given id`() {
        val tv = TurnView("t1")
        tv.addMessage(msg("u1", "user"))
        val mv = tv.messageView("u1")
        assertNotNull(mv)
        assertEquals("user", mv!!.role)
    }

    fun `test messageView returns null for unknown id`() {
        val tv = TurnView("t1")
        assertNull(tv.messageView("missing"))
    }

    fun `test removeMessage removes the view`() {
        val tv = TurnView("t1")
        tv.addMessage(msg("u1", "user"))
        tv.addMessage(msg("a1", "assistant"))

        tv.removeMessage("a1")

        assertEquals(listOf("u1"), tv.messageIds())
        assertNull(tv.messageView("a1"))
    }

    fun `test removeMessage unknown id is noop`() {
        val tv = TurnView("t1")
        tv.addMessage(msg("u1", "user"))
        tv.removeMessage("nope")
        assertEquals(listOf("u1"), tv.messageIds())
    }

    fun `test dump produces correct format`() {
        val tv = TurnView("u1")
        tv.addMessage(msg("u1", "user"))
        tv.addMessage(msg("a1", "assistant"))
        assertEquals("user#u1, assistant#a1", tv.dump())
    }

    // ------ MessageView ------

    fun `test new MessageView is empty`() {
        val mv = MessageView(msg("u1", "user"))
        assertTrue(mv.partIds().isEmpty())
    }

    fun `test MessageView for user message has user role`() {
        val mv = MessageView(msg("u1", "user"))
        assertEquals("user", mv.role)
    }

    fun `test MessageView for assistant message has assistant role`() {
        val mv = MessageView(msg("a1", "assistant"))
        assertEquals("assistant", mv.role)
    }

    fun `test upsertPart adds a new TextView for Text content`() {
        val mv = MessageView(msg("a1", "assistant"))
        val text = ai.kilocode.client.session.model.Text("p1")
        text.content.append("hello")
        mv.upsertPart(text)

        assertEquals(listOf("p1"), mv.partIds())
        assertTrue(mv.part("p1") is TextView)
    }

    fun `test upsertPart updates existing part rather than adding duplicate`() {
        val mv = MessageView(msg("a1", "assistant"))
        val t1 = ai.kilocode.client.session.model.Text("p1").also { it.content.append("v1") }
        mv.upsertPart(t1)

        val t2 = ai.kilocode.client.session.model.Text("p1").also { it.content.append("v2") }
        mv.upsertPart(t2)

        assertEquals(1, mv.partIds().size)
        val view = mv.part("p1") as TextView
        assertEquals("v2", view.markdown())
    }

    fun `test removePart removes the renderer`() {
        val mv = MessageView(msg("a1", "assistant"))
        mv.upsertPart(ai.kilocode.client.session.model.Text("p1").also { it.content.append("x") })
        mv.removePart("p1")

        assertTrue(mv.partIds().isEmpty())
        assertNull(mv.part("p1"))
    }

    fun `test removePart unknown id is noop`() {
        val mv = MessageView(msg("a1", "assistant"))
        mv.removePart("none")
        assertTrue(mv.partIds().isEmpty())
    }

    fun `test appendDelta reaches TextView`() {
        val mv = MessageView(msg("a1", "assistant"))
        mv.upsertPart(ai.kilocode.client.session.model.Text("p1").also { it.content.append("hello ") })

        mv.appendDelta("p1", "world")

        val view = mv.part("p1") as TextView
        assertEquals("hello world", view.markdown())
    }

    fun `test appendDelta for unknown part id is noop`() {
        val mv = MessageView(msg("a1", "assistant"))
        // Must not throw
        mv.appendDelta("unknown", "delta")
    }

    fun `test MessageView pre-populates parts from Message on creation`() {
        val message = msg("a1", "assistant")
        val text = ai.kilocode.client.session.model.Text("p1").also { it.content.append("preloaded") }
        message.parts["p1"] = text

        val mv = MessageView(message)

        assertEquals(listOf("p1"), mv.partIds())
        assertTrue(mv.part("p1") is TextView)
    }

    // ------ helpers ------

    private fun msg(id: String, role: String): Message =
        Message(MessageDto(id = id, sessionID = "ses", role = role, time = MessageTimeDto(0.0)))
}
