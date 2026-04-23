package ai.kilocode.client.session.ui

import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.views.TextView
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PartDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Tests for [SessionPanel] — structural and index integrity.
 *
 * Uses [BasePlatformTestCase] for a real IntelliJ Application; layout
 * is not measured (no screen), but the structural / index state is fully
 * testable.
 */
@Suppress("UnstableApiUsage")
class SessionPanelTest : BasePlatformTestCase() {

    private lateinit var model: SessionModel
    private lateinit var parent: Disposable
    private lateinit var panel: SessionPanel

    override fun setUp() {
        super.setUp()
        parent = Disposer.newDisposable("test")
        model = SessionModel()
        panel = SessionPanel(model, parent)
    }

    override fun tearDown() {
        try {
            Disposer.dispose(parent)
        } finally {
            super.tearDown()
        }
    }

    // ------ initial state ------

    fun `test empty panel has no turns`() {
        assertEquals(0, panel.turnCount())
        assertEquals("", panel.dump())
    }

    // ------ TurnAdded ------

    fun `test user message creates turn and is findable by message id`() {
        model.upsertMessage(msg("u1", "user"))

        assertEquals(1, panel.turnCount())
        assertNotNull(panel.findMessage("u1"))
        assertEquals("user", panel.findMessage("u1")!!.role)
        assertEquals(panel.dump(), "turn#u1: user#u1")
    }

    fun `test assistant message added to existing turn`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))

        assertEquals(1, panel.turnCount())
        assertNotNull(panel.findMessage("a1"))
        assertEquals("turn#u1: user#u1, assistant#a1", panel.dump())
    }

    fun `test second user message creates a second turn`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("u2", "user"))
        model.upsertMessage(msg("a2", "assistant"))

        assertEquals(2, panel.turnCount())
        assertNotNull(panel.findMessage("u2"))
        assertNotNull(panel.findMessage("a2"))
        assertEquals("""
            turn#u1: user#u1, assistant#a1
            turn#u2: user#u2, assistant#a2
        """.trimIndent().trim(), panel.dump())
    }

    // ------ TurnRemoved ------

    fun `test removing only message removes the turn`() {
        model.upsertMessage(msg("u1", "user"))
        model.removeMessage("u1")

        assertEquals(0, panel.turnCount())
        assertNull(panel.findMessage("u1"))
    }

    fun `test removing user anchor of two-message turn creates new standalone turn for assistant`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))

        model.removeMessage("u1")

        assertEquals(1, panel.turnCount())
        assertNull(panel.findMessage("u1"))
        assertNotNull(panel.findMessage("a1"))
        assertEquals("turn#a1: assistant#a1", panel.dump())
    }

    fun `test removing middle user message merges turns`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("u2", "user"))
        model.upsertMessage(msg("a2", "assistant"))

        model.removeMessage("u2")

        assertEquals(1, panel.turnCount())
        assertNull(panel.findMessage("u2"))
        assertNotNull(panel.findMessage("a2"))  // now in u1's turn
        assertEquals("turn#u1: user#u1, assistant#a1, assistant#a2", panel.dump())
    }

    // ------ secondary index integrity ------

    fun `test findTurn returns the owning TurnView`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))

        val tv = panel.findTurn("a1")
        assertNotNull(tv)
        assertEquals("u1", tv!!.id)
    }

    fun `test indexes are null after message removal`() {
        model.upsertMessage(msg("u1", "user"))
        model.removeMessage("u1")

        assertNull(panel.findMessage("u1"))
        assertNull(panel.findTurn("u1"))
    }

    // ------ content events ------

    fun `test ContentAdded adds TextView to MessageView`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "hello"))

        val mv = panel.findMessage("a1")!!
        assertEquals(listOf("p1"), mv.partIds())
        assertTrue(mv.part("p1") is TextView)
    }

    fun `test ContentDelta appends text to TextView`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "hello "))
        model.appendDelta("a1", "p1", "world")

        val tv = panel.findMessage("a1")!!.part("p1") as TextView
        assertEquals("hello world", tv.markdown())
    }

    fun `test ContentRemoved removes PartView from MessageView`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "x"))
        model.removeContent("a1", "p1")

        val mv = panel.findMessage("a1")!!
        assertTrue(mv.partIds().isEmpty())
    }

    // ------ HistoryLoaded ------

    fun `test HistoryLoaded rebuilds panel from scratch`() {
        // Prime with some messages
        model.upsertMessage(msg("u0", "user"))

        model.loadHistory(listOf(
            MessageWithPartsDto(msg("u1", "user"), emptyList()),
            MessageWithPartsDto(msg("a1", "assistant"), emptyList()),
            MessageWithPartsDto(msg("u2", "user"), emptyList()),
        ))

        assertNull(panel.findMessage("u0"))  // old message gone
        assertNotNull(panel.findMessage("u1"))
        assertNotNull(panel.findMessage("a1"))
        assertNotNull(panel.findMessage("u2"))
        assertEquals("""
            turn#u1: user#u1, assistant#a1
            turn#u2: user#u2
        """.trimIndent().trim(), panel.dump())
    }

    fun `test HistoryLoaded with parts populates MessageView content`() {
        model.loadHistory(listOf(
            MessageWithPartsDto(
                msg("a1", "assistant"),
                listOf(part("p1", "a1", "text", text = "preloaded")),
            ),
        ))

        val mv = panel.findMessage("a1")!!
        assertEquals(listOf("p1"), mv.partIds())
        val tv = mv.part("p1") as TextView
        assertEquals("preloaded", tv.markdown())
    }

    // ------ Cleared ------

    fun `test Cleared wipes all panel state`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))

        model.clear()

        assertEquals(0, panel.turnCount())
        assertNull(panel.findMessage("u1"))
        assertNull(panel.findMessage("a1"))
        assertEquals("", panel.dump())
    }

    // ------ turn ordering ------

    fun `test turn insertion order is preserved`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("u2", "user"))
        model.upsertMessage(msg("u3", "user"))

        assertEquals(listOf("u1", "u2", "u3"), panel.turnIds())
    }

    // ------ helpers ------

    private fun msg(id: String, role: String) = MessageDto(
        id = id, sessionID = "ses", role = role, time = MessageTimeDto(0.0),
    )

    private fun part(id: String, mid: String, type: String, text: String? = null) = PartDto(
        id = id, sessionID = "ses", messageID = mid, type = type, text = text,
    )
}
