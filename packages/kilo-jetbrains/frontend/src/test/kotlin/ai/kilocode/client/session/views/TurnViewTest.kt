package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.JBUI
import java.awt.image.BufferedImage
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.RepaintManager

/**
 * Tests for [TurnView] and [MessageView].
 */
@Suppress("UnstableApiUsage")
class TurnViewTest : BasePlatformTestCase() {
    private val openFile: (String) -> Unit = {}

    // ------ TurnView ------

    fun `test new TurnView is empty`() {
        val tv = TurnView("t1", openFile)
        assertTrue(tv.messageIds().isEmpty())
    }

    fun `test addMessage appends and returns view`() {
        val tv = TurnView("t1", openFile)
        val mv = tv.addMessage(msg("u1", "user"))
        assertEquals("u1", mv.msg.info.id)
        assertEquals(listOf("u1"), tv.messageIds())
    }

    fun `test addMessage preserves insertion order`() {
        val tv = TurnView("t1", openFile)
        tv.addMessage(msg("u1", "user"))
        tv.addMessage(msg("a1", "assistant"))
        tv.addMessage(msg("a2", "assistant"))
        assertEquals(listOf("u1", "a1", "a2"), tv.messageIds())
    }

    fun `test messageView returns the view for a given id`() {
        val tv = TurnView("t1", openFile)
        tv.addMessage(msg("u1", "user"))
        val mv = tv.messageView("u1")
        assertNotNull(mv)
        assertEquals("user", mv!!.role)
    }

    fun `test messageView returns null for unknown id`() {
        val tv = TurnView("t1", openFile)
        assertNull(tv.messageView("missing"))
    }

    fun `test removeMessage removes the view`() {
        val tv = TurnView("t1", openFile)
        tv.addMessage(msg("u1", "user"))
        tv.addMessage(msg("a1", "assistant"))

        tv.removeMessage("a1")

        assertEquals(listOf("u1"), tv.messageIds())
        assertNull(tv.messageView("a1"))
    }

    fun `test removeMessage unknown id is noop`() {
        val tv = TurnView("t1", openFile)
        tv.addMessage(msg("u1", "user"))
        tv.removeMessage("nope")
        assertEquals(listOf("u1"), tv.messageIds())
    }

    fun `test dump produces correct format`() {
        val tv = TurnView("u1", openFile)
        tv.addMessage(msg("u1", "user"))
        tv.addMessage(msg("a1", "assistant"))
        assertEquals("user#u1, assistant#a1", tv.dump())
    }

    // ------ MessageView ------

    fun `test new MessageView is empty`() {
        val mv = MessageView(msg("u1", "user"), openFile)
        assertTrue(mv.partIds().isEmpty())
    }

    fun `test MessageView for user message has user role`() {
        val mv = MessageView(msg("u1", "user"), openFile)
        assertEquals("user", mv.role)
    }

    fun `test MessageView for assistant message has assistant role`() {
        val mv = MessageView(msg("a1", "assistant"), openFile)
        assertEquals("assistant", mv.role)
    }

    fun `test user message uses prompt shell padding`() {
        val mv = MessageView(msg("u1", "user"), openFile)
        val ins = mv.border.getBorderInsets(mv)

        assertEquals(0, ins.top)
        assertEquals(0, ins.bottom)
        assertEquals(0, ins.left)
        assertEquals(0, ins.right)
        assertFalse(mv.isOpaque)
    }

    fun `test user message uses standard outline color`() {
        val mv = MessageView(msg("u1", "user"), openFile)
        mv.setSize(120, 48)
        val image = BufferedImage(120, 48, BufferedImage.TYPE_INT_ARGB)

        mv.paint(image.createGraphics())

        assertEquals(SessionUiStyle.View.Outline.color().rgb, image.getRGB(60, 0))
    }

    fun `test assistant message remains borderless`() {
        val mv = MessageView(msg("a1", "assistant"), openFile)
        val ins = mv.border.getBorderInsets(mv)

        assertEquals(0, ins.top)
        assertEquals(0, ins.bottom)
        assertEquals(0, ins.left)
        assertEquals(0, ins.right)
    }

    fun `test upsertPart adds a new TextView for Text content`() {
        val mv = MessageView(msg("a1", "assistant"), openFile)
        val text = ai.kilocode.client.session.model.Text("p1")
        text.content.append("hello")
        mv.upsertPart(text)

        assertEquals(listOf("p1"), mv.partIds())
        assertTrue(mv.part("p1") is TextView)
    }

    fun `test user text view is transparent`() {
        val mv = MessageView(msg("u1", "user"), openFile)
        val text = ai.kilocode.client.session.model.Text("p1")
        text.content.append("hello")

        mv.upsertPart(text)

        assertFalse((mv.part("p1") as TextView).contentOpaque())
    }

    fun `test assistant text view is transparent`() {
        val mv = MessageView(msg("a1", "assistant"), openFile)
        val text = ai.kilocode.client.session.model.Text("p1")
        text.content.append("hello")

        mv.upsertPart(text)

        assertFalse((mv.part("p1") as TextView).contentOpaque())
    }

    fun `test upsertPart updates existing part rather than adding duplicate`() {
        val mv = MessageView(msg("a1", "assistant"), openFile)
        val t1 = ai.kilocode.client.session.model.Text("p1").also { it.content.append("v1") }
        mv.upsertPart(t1)

        val t2 = ai.kilocode.client.session.model.Text("p1").also { it.content.append("v2") }
        mv.upsertPart(t2)

        assertEquals(1, mv.partIds().size)
        val view = mv.part("p1") as TextView
        assertEquals("v2", view.markdown())
    }

    fun `test removePart removes the renderer`() {
        val mv = MessageView(msg("a1", "assistant"), openFile)
        mv.upsertPart(ai.kilocode.client.session.model.Text("p1").also { it.content.append("x") })
        mv.removePart("p1")

        assertTrue(mv.partIds().isEmpty())
        assertNull(mv.part("p1"))
    }

    fun `test removePart unknown id is noop`() {
        val mv = MessageView(msg("a1", "assistant"), openFile)
        mv.removePart("none")
        assertTrue(mv.partIds().isEmpty())
    }

    fun `test appendDelta reaches TextView`() {
        val mv = MessageView(msg("a1", "assistant"), openFile)
        mv.upsertPart(ai.kilocode.client.session.model.Text("p1").also { it.content.append("hello ") })

        mv.appendDelta("p1", "world")

        val view = mv.part("p1") as TextView
        assertEquals("hello world", view.markdown())
    }

    fun `test consecutive reasoning parts reuse one view`() {
        val message = msg("a1", "assistant")
        message.parts["r1"] = reasoning("r1", "first ")
        message.parts["r2"] = reasoning("r2", "second")

        val mv = MessageView(message, openFile)

        assertEquals(listOf("r1"), mv.partIds())
        assertSame(mv.part("r1"), mv.part("r2"))
        assertEquals("first second", (mv.part("r1") as ReasoningView).markdown())
    }

    fun `test delta for aliased reasoning appends to reused view`() {
        val message = msg("a1", "assistant")
        message.parts["r1"] = reasoning("r1", "first ")
        message.parts["r2"] = reasoning("r2", "second")
        val mv = MessageView(message, openFile)

        assertTrue(mv.appendDelta("r2", " third"))

        assertEquals("first second third", (mv.part("r1") as ReasoningView).markdown())
    }

    fun `test reasoning alias maps stay bounded across churn`() {
        val mv = MessageView(msg("a1", "assistant"), openFile)

        repeat(100) { i ->
            mv.upsertPart(reasoning("r${i}a", "first $i "))
            mv.upsertPart(reasoning("r${i}b", "second $i"))

            assertEquals(listOf("r${i}a"), mv.partIds())
            assertSame(mv.part("r${i}a"), mv.part("r${i}b"))
            assertEquals(1, aliasSize(mv))
            assertEquals(1, sourceSize(mv))
            assertEquals(1, mv.componentCount)

            mv.removePart("r${i}b")
            mv.removePart("r${i}a")

            assertTrue(mv.partIds().isEmpty())
            assertEquals(0, aliasSize(mv))
            assertEquals(0, sourceSize(mv))
            assertEquals(0, mv.componentCount)
        }
    }

    fun `test text between reasoning parts keeps separate views`() {
        val message = msg("a1", "assistant")
        message.parts["r1"] = reasoning("r1", "first")
        message.parts["t1"] = text("t1", "middle")
        message.parts["r2"] = reasoning("r2", "second")

        val mv = MessageView(message, openFile)

        assertEquals(listOf("r1", "t1", "r2"), mv.partIds())
        assertNotSame(mv.part("r1"), mv.part("r2"))
    }

    fun `test blank reasoning part is invisible`() {
        val message = msg("a1", "assistant")
        message.parts["r1"] = reasoning("r1", "")
        message.parts["t1"] = text("t1", "middle")

        val mv = MessageView(message, openFile)

        assertFalse(mv.part("r1")!!.isVisible)
        assertTrue(mv.part("t1")!!.isVisible)
    }

    fun `test appendDelta for unknown part id is noop`() {
        val mv = MessageView(msg("a1", "assistant"), openFile)
        // Must not throw
        mv.appendDelta("unknown", "delta")
    }

    fun `test appendDelta for unknown part id does not repaint message or parent`() {
        val parent = JPanel()
        val mv = MessageView(msg("a1", "assistant"), openFile)
        parent.add(mv)
        val repaint = TrackingRepaintManager(setOf(parent, mv))
        val old = RepaintManager.currentManager(parent)

        try {
            RepaintManager.setCurrentManager(repaint)

            assertFalse(mv.appendDelta("unknown", "delta"))

            assertTrue(repaint.dirty.isEmpty())
            assertTrue(repaint.invalid.isEmpty())
        } finally {
            RepaintManager.setCurrentManager(old)
        }
    }

    fun `test MessageView pre-populates parts from Message on creation`() {
        val message = msg("a1", "assistant")
        val text = ai.kilocode.client.session.model.Text("p1").also { it.content.append("preloaded") }
        message.parts["p1"] = text

        val mv = MessageView(message, openFile)

        assertEquals(listOf("p1"), mv.partIds())
        assertTrue(mv.part("p1") is TextView)
    }

    fun `test assistant card parts use shared compact gap`() {
        val message = msg("a1", "assistant")
        val reasoning = reasoning("r1", "thinking")
        val tool = Tool("t1", "read", toolKind("read")).also { it.state = ToolExecState.COMPLETED }
        message.parts["r1"] = reasoning
        message.parts["t1"] = tool
        val mv = MessageView(message, openFile)

        mv.setSize(400, 200)
        mv.doLayout()

        assertEquals(
            JBUI.scale(SessionUiStyle.SessionLayout.GAP),
            mv.part("t1")!!.y - mv.part("r1")!!.bounds.maxY.toInt(),
        )
    }

    fun `test consecutive messages use shared compact gap`() {
        val tv = TurnView("u1", openFile)
        tv.addMessage(msg("u1", "user").also { msg ->
            msg.parts["t1"] = Tool("t1", "read", toolKind("read")).also { it.state = ToolExecState.COMPLETED }
        })
        tv.addMessage(msg("a2", "assistant").also { msg ->
            msg.parts["t2"] = Tool("t2", "read", toolKind("read")).also { it.state = ToolExecState.COMPLETED }
        })

        tv.setSize(400, 300)
        tv.doLayout()
        val first = tv.messageView("u1")!!
        val second = tv.messageView("a2")!!

        assertEquals(JBUI.scale(SessionUiStyle.SessionLayout.GAP), second.y - first.bounds.maxY.toInt())
    }

    // ------ helpers ------

    private fun msg(id: String, role: String): Message =
        Message(MessageDto(id = id, sessionID = "ses", role = role, time = MessageTimeDto(0.0)))

    private fun reasoning(id: String, content: String) = Reasoning(id).also {
        it.done = false
        it.content.append(content)
    }

    private fun text(id: String, content: String) = Text(id).also { it.content.append(content) }

    private fun aliasSize(view: MessageView) = mapSize(view, "aliases")

    private fun sourceSize(view: MessageView) = mapSize(view, "sources")

    private fun mapSize(view: MessageView, name: String): Int {
        val field = MessageView::class.java.getDeclaredField(name)
        field.isAccessible = true
        return (field.get(view) as Map<*, *>).size
    }

    private class TrackingRepaintManager(private val watched: Set<JComponent>) : RepaintManager() {
        val dirty = mutableListOf<JComponent>()
        val invalid = mutableListOf<JComponent>()

        override fun addDirtyRegion(c: JComponent, x: Int, y: Int, w: Int, h: Int) {
            if (c in watched) dirty.add(c)
            super.addDirtyRegion(c, x, y, w, h)
        }

        override fun addInvalidComponent(invalidComponent: JComponent) {
            if (invalidComponent in watched) invalid.add(invalidComponent)
            super.addInvalidComponent(invalidComponent)
        }
    }
}
