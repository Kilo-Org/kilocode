package ai.kilocode.client.session.model

import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PartDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.UsefulTestCase

/**
 * Hard model-level tests for turn grouping inside [SessionModel].
 *
 * Every test that adds/removes messages also asserts both the derived
 * turn structure ([assertTurns]) and the exact event stream
 * ([assertTurnEvents] / [assertAllEvents]).
 *
 * Naming convention for message ids:  u1, u2, u3 = user messages
 *                                     a1, a2, a3 = assistant messages
 */
class TurnGroupingTest : UsefulTestCase() {

    private lateinit var model: SessionModel
    private lateinit var parent: Disposable
    private lateinit var events: MutableList<SessionModelEvent>

    override fun setUp() {
        super.setUp()
        parent = Disposer.newDisposable("test")
        model = SessionModel()
        events = mutableListOf()
        model.addListener(parent) { events.add(it) }
    }

    override fun tearDown() {
        try {
            Disposer.dispose(parent)
        } finally {
            super.tearDown()
        }
    }

    // ------ empty model ------

    fun `test empty model has no turns`() {
        assertTurns("(no turns)")
        assertTrue(model.turns().isEmpty())
    }

    // ------ single messages ------

    fun `test adding user message creates turn and fires TurnAdded`() {
        model.upsertMessage(msg("u1", "user"))

        assertTurns("turn#u1: user#u1")
        assertTurnEvents("TurnAdded u1 [u1]")
    }

    fun `test adding assistant message before any user message creates standalone turn`() {
        model.upsertMessage(msg("a1", "assistant"))

        assertTurns("turn#a1: assistant#a1")
        assertTurnEvents("TurnAdded a1 [a1]")
    }

    // ------ building up a turn ------

    fun `test assistant message after user message is added to user's turn`() {
        model.upsertMessage(msg("u1", "user"))
        events.clear()

        model.upsertMessage(msg("a1", "assistant"))

        assertTurns("turn#u1: user#u1, assistant#a1")
        assertTurnEvents("TurnUpdated u1 [u1, a1]")
    }

    fun `test multiple assistant messages appended to same turn`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        events.clear()

        model.upsertMessage(msg("a2", "assistant"))

        assertTurns("turn#u1: user#u1, assistant#a1, assistant#a2")
        assertTurnEvents("TurnUpdated u1 [u1, a1, a2]")
    }

    // ------ multiple turns ------

    fun `test second user message starts a new turn`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        events.clear()

        model.upsertMessage(msg("u2", "user"))

        assertTurns("""
            turn#u1: user#u1, assistant#a1
            turn#u2: user#u2
        """)
        assertTurnEvents("TurnAdded u2 [u2]")
    }

    fun `test two complete turns`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("u2", "user"))
        model.upsertMessage(msg("a2", "assistant"))

        assertTurns("""
            turn#u1: user#u1, assistant#a1
            turn#u2: user#u2, assistant#a2
        """)
        assertEquals(2, model.turns().size)
    }

    fun `test leading assistant messages followed by user message splits into two turns`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("a2", "assistant"))
        events.clear()

        model.upsertMessage(msg("u1", "user"))

        assertTurns("""
            turn#a1: assistant#a1, assistant#a2
            turn#u1: user#u1
        """)
        assertTurnEvents("TurnAdded u1 [u1]")
    }

    // ------ removals ------

    fun `test removing assistant from single-message turn removes the turn`() {
        model.upsertMessage(msg("a1", "assistant"))
        events.clear()

        model.removeMessage("a1")

        assertTurns("(no turns)")
        assertTurnEvents("TurnRemoved a1")
    }

    fun `test removing user anchor from a two-message turn creates standalone assistant turn`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        events.clear()

        model.removeMessage("u1")

        assertTurns("turn#a1: assistant#a1")
        // Old turn u1 is gone; new standalone turn a1 appears
        assertTurnEvents("""
            TurnRemoved u1
            TurnAdded a1 [a1]
        """)
    }

    fun `test removing assistant from two-message turn updates turn`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        events.clear()

        model.removeMessage("a1")

        assertTurns("turn#u1: user#u1")
        assertTurnEvents("TurnUpdated u1 [u1]")
    }

    fun `test removing middle user message merges turns`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("u2", "user"))
        model.upsertMessage(msg("a2", "assistant"))
        events.clear()

        model.removeMessage("u2")

        // a2 falls into u1's turn; u2's turn disappears
        assertTurns("turn#u1: user#u1, assistant#a1, assistant#a2")
        assertTurnEvents("""
            TurnRemoved u2
            TurnUpdated u1 [u1, a1, a2]
        """)
    }

    fun `test removing user anchor when another user follows causes regrouping`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("u2", "user"))
        events.clear()

        model.removeMessage("u1")

        // a1 is now the leading assistant; it anchors its own standalone turn.
        // u2 still anchors its own turn.
        assertTurns("""
            turn#a1: assistant#a1
            turn#u2: user#u2
        """)
        assertTurnEvents("""
            TurnRemoved u1
            TurnAdded a1 [a1]
        """)
    }

    // ------ deprecated addMessage ------

    fun `test deprecated addMessage also triggers regrouping`() {
        model.addMessage(msg("u1", "user"))
        model.addMessage(msg("a1", "assistant"))

        assertTurns("turn#u1: user#u1, assistant#a1")
    }

    fun `test deprecated addMessage ignores duplicate`() {
        model.addMessage(msg("u1", "user"))
        events.clear()

        model.addMessage(msg("u1", "user"))

        // Duplicate ignored — no new turn event
        assertTrue(turnEvents().isEmpty())
        assertEquals(1, model.turns().size)
    }

    // ------ loadHistory ------

    fun `test loadHistory populates turns silently then fires HistoryLoaded`() {
        model.loadHistory(listOf(
            withParts(msg("u1", "user")),
            withParts(msg("a1", "assistant")),
            withParts(msg("u2", "user")),
            withParts(msg("a2", "assistant")),
        ))

        assertTurns("""
            turn#u1: user#u1, assistant#a1
            turn#u2: user#u2, assistant#a2
        """)
        // HistoryLoaded is the only event — no per-turn events
        assertEquals(1, events.size)
        assertTrue(events.single() is SessionModelEvent.HistoryLoaded)
    }

    fun `test loadHistory with leading assistant messages groups them correctly`() {
        model.loadHistory(listOf(
            withParts(msg("a1", "assistant")),
            withParts(msg("a2", "assistant")),
            withParts(msg("u1", "user")),
        ))

        assertTurns("""
            turn#a1: assistant#a1, assistant#a2
            turn#u1: user#u1
        """)
        assertEquals(1, events.size)  // only HistoryLoaded
    }

    fun `test loadHistory clears previous turns`() {
        model.upsertMessage(msg("u1", "user"))
        events.clear()

        model.loadHistory(listOf(withParts(msg("u2", "user"))))

        assertTurns("turn#u2: user#u2")
        assertEquals(1, events.size)  // only HistoryLoaded
    }

    fun `test loadHistory with empty list produces no turns`() {
        model.upsertMessage(msg("u1", "user"))
        events.clear()

        model.loadHistory(emptyList())

        assertTurns("(no turns)")
        assertEquals(1, events.size)  // only HistoryLoaded
    }

    // ------ clear ------

    fun `test clear removes all turns silently`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        events.clear()

        model.clear()

        assertTurns("(no turns)")
        // Cleared is the only event — no per-turn events
        assertEquals(1, events.size)
        assertTrue(events.single() is SessionModelEvent.Cleared)
    }

    // ------ idempotency ------

    fun `test no TurnUpdated when same assistant arrives in same turn twice`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        events.clear()

        // Same assistant message arrives again (e.g. metadata update)
        // upsertMessage update path: fires MessageUpdated but no regroup
        model.upsertMessage(msg("a1", "assistant"))

        assertTrue(turnEvents().isEmpty())
    }

    // ------ turn lookup ------

    fun `test turn() retrieves by id`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))

        val t = model.turn("u1")
        assertNotNull(t)
        assertEquals(listOf("u1", "a1"), t!!.messageIds)
    }

    fun `test turns() preserves insertion order`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("u2", "user"))
        model.upsertMessage(msg("a2", "assistant"))

        val ids = model.turns().map { it.id }
        assertEquals(listOf("u1", "u2"), ids)
    }

    // ------ helpers ------

    private fun msg(id: String, role: String) = MessageDto(
        id = id,
        sessionID = "ses",
        role = role,
        time = MessageTimeDto(created = 0.0),
    )

    private fun withParts(dto: MessageDto) = MessageWithPartsDto(info = dto, parts = emptyList())

    private fun part(id: String, mid: String, type: String) = PartDto(
        id = id, sessionID = "ses", messageID = mid, type = type,
    )

    // Turn-specific event helpers

    private fun turnEvents(): List<SessionModelEvent> = events.filter {
        it is SessionModelEvent.TurnAdded ||
            it is SessionModelEvent.TurnUpdated ||
            it is SessionModelEvent.TurnRemoved
    }

    private fun assertTurns(expected: String) {
        assertEquals(expected.trimIndent().trim(), model.toTurnsString().trim())
    }

    private fun assertTurnEvents(expected: String) {
        assertEquals(expected.trimIndent().trim(), turnEvents().joinToString("\n"))
    }

    private fun assertAllEvents(expected: String) {
        assertEquals(expected.trimIndent().trim(), events.joinToString("\n"))
    }
}
