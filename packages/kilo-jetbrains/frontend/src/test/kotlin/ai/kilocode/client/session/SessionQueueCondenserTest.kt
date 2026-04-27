package ai.kilocode.client.session

import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.SessionStatusDto
import junit.framework.TestCase

class SessionQueueCondenserTest : TestCase() {

    private val condenser = SessionQueueCondenser()

    private fun delta(msg: String, part: String, text: String) =
        ChatEventDto.PartDelta("ses", msg, part, "text", text)

    private fun updated(
        msg: String,
        part: String,
        type: String,
        text: String? = null,
        tool: String? = null,
        state: String? = null,
        title: String? = null,
    ) = ChatEventDto.PartUpdated(
        "ses",
        PartDto(part, "ses", msg, type, text = text, tool = tool, state = state, title = title),
    )

    private fun nonDelta(msg: String) =
        ChatEventDto.TurnOpen(msg)

    fun `test empty list returns empty`() {
        assertEquals(emptyList<ChatEventDto>(), condenser.condense(emptyList()))
    }

    fun `test single event returned unchanged`() {
        val event = delta("m1", "p1", "hi")
        assertEquals(listOf(event), condenser.condense(listOf(event)))
    }

    fun `test two deltas for same part are merged`() {
        val result = condenser.condense(listOf(
            delta("m1", "p1", "hello "),
            delta("m1", "p1", "world"),
        ))
        assertEquals(1, result.size)
        assertEquals("hello world", (result[0] as ChatEventDto.PartDelta).delta)
    }

    fun `test many deltas for same part are all merged`() {
        val result = condenser.condense(listOf(
            delta("m1", "p1", "a"),
            delta("m1", "p1", "b"),
            delta("m1", "p1", "c"),
        ))
        assertEquals(1, result.size)
        assertEquals("abc", (result[0] as ChatEventDto.PartDelta).delta)
    }

    fun `test deltas for different parts are kept separate`() {
        val result = condenser.condense(listOf(
            delta("m1", "p1", "foo"),
            delta("m1", "p2", "bar"),
        ))
        assertEquals(2, result.size)
        assertEquals("foo", (result[0] as ChatEventDto.PartDelta).delta)
        assertEquals("bar", (result[1] as ChatEventDto.PartDelta).delta)
    }

    fun `test non-text field deltas are not merged`() {
        val d1 = ChatEventDto.PartDelta("ses", "m1", "p1", "tool_call", "chunk1")
        val d2 = ChatEventDto.PartDelta("ses", "m1", "p1", "tool_call", "chunk2")
        val result = condenser.condense(listOf(d1, d2))
        assertEquals(2, result.size)
    }

    fun `test non-delta event flushes pending deltas before it`() {
        val barrier = nonDelta("turn1")
        val result = condenser.condense(listOf(
            delta("m1", "p1", "x"),
            delta("m1", "p1", "y"),
            barrier,
            delta("m1", "p1", "z"),
        ))
        assertEquals(3, result.size)
        assertEquals("xy", (result[0] as ChatEventDto.PartDelta).delta)
        assertEquals(barrier, result[1])
        assertEquals("z", (result[2] as ChatEventDto.PartDelta).delta)
    }

    fun `test deltas after barrier are merged independently`() {
        val result = condenser.condense(listOf(
            delta("m1", "p1", "a"),
            nonDelta("t"),
            delta("m1", "p1", "b"),
            delta("m1", "p1", "c"),
        ))
        assertEquals(3, result.size)
        assertEquals("a", (result[0] as ChatEventDto.PartDelta).delta)
        assertEquals("bc", (result[2] as ChatEventDto.PartDelta).delta)
    }

    fun `test deltas for different messages are kept separate`() {
        val result = condenser.condense(listOf(
            delta("m1", "p1", "hi"),
            delta("m2", "p1", "there"),
        ))
        assertEquals(2, result.size)
        assertEquals("hi", (result[0] as ChatEventDto.PartDelta).delta)
        assertEquals("there", (result[1] as ChatEventDto.PartDelta).delta)
    }

    fun `test merged delta uses session and part ids from last event`() {
        val result = condenser.condense(listOf(
            delta("m1", "p1", "first"),
            delta("m1", "p1", "second"),
        ))
        val event = result.single() as ChatEventDto.PartDelta
        assertEquals("ses", event.sessionID)
        assertEquals("m1", event.messageID)
        assertEquals("p1", event.partID)
    }

    fun `test consecutive same part updates keep only latest snapshot`() {
        val result = condenser.condense(listOf(
            updated("m1", "p1", "tool", tool = "bash", state = "pending"),
            updated("m1", "p1", "tool", tool = "bash", state = "completed", title = "Install deps"),
        ))

        assertEquals(1, result.size)
        val event = result.single() as ChatEventDto.PartUpdated
        assertEquals("completed", event.part.state)
        assertEquals("Install deps", event.part.title)
    }

    fun `test consecutive text part updates keep final text`() {
        val result = condenser.condense(listOf(
            updated("m1", "p1", "text", text = "hel"),
            updated("m1", "p1", "text", text = "hello"),
        ))

        assertEquals(1, result.size)
        val event = result.single() as ChatEventDto.PartUpdated
        assertEquals("hello", event.part.text)
    }

    fun `test part updates for different parts are kept separate`() {
        val result = condenser.condense(listOf(
            updated("m1", "p1", "tool", tool = "bash"),
            updated("m1", "p2", "tool", tool = "edit"),
        ))

        assertEquals(2, result.size)
        assertEquals("p1", (result[0] as ChatEventDto.PartUpdated).part.id)
        assertEquals("p2", (result[1] as ChatEventDto.PartUpdated).part.id)
    }

    fun `test part updates for different messages are kept separate`() {
        val result = condenser.condense(listOf(
            updated("m1", "p1", "tool", tool = "bash"),
            updated("m2", "p1", "tool", tool = "bash"),
        ))

        assertEquals(2, result.size)
        assertEquals("m1", (result[0] as ChatEventDto.PartUpdated).part.messageID)
        assertEquals("m2", (result[1] as ChatEventDto.PartUpdated).part.messageID)
    }

    fun `test barrier flushes pending part updates before it`() {
        val barrier = nonDelta("turn1")
        val result = condenser.condense(listOf(
            updated("m1", "p1", "tool", tool = "bash", state = "pending"),
            updated("m1", "p1", "tool", tool = "bash", state = "running"),
            barrier,
            updated("m1", "p1", "tool", tool = "bash", state = "completed"),
        ))

        assertEquals(3, result.size)
        assertEquals("running", (result[0] as ChatEventDto.PartUpdated).part.state)
        assertEquals(barrier, result[1])
        assertEquals("completed", (result[2] as ChatEventDto.PartUpdated).part.state)
    }

    fun `test delta acts as barrier for part updates`() {
        val result = condenser.condense(listOf(
            updated("m1", "p1", "text", text = "he"),
            delta("m1", "p1", "l"),
            updated("m1", "p1", "text", text = "hello"),
        ))

        assertEquals(3, result.size)
        assertEquals("he", (result[0] as ChatEventDto.PartUpdated).part.text)
        assertEquals("l", (result[1] as ChatEventDto.PartDelta).delta)
        assertEquals("hello", (result[2] as ChatEventDto.PartUpdated).part.text)
    }

    fun `test merged part update matches latest payload exactly`() {
        val first = updated("m1", "p1", "tool", tool = "bash", state = "pending")
        val last = updated("m1", "p1", "tool", tool = "edit", state = "running", title = "Apply patch")

        val result = condenser.condense(listOf(first, last))

        assertEquals(listOf(last), result)
    }

    // ------ MessageUpdated coalescing ------

    fun `test consecutive message updates for same id keep only latest`() {
        val first = msgUpdated("m1", role = "assistant")
        val last = msgUpdated("m1", role = "assistant", cost = 0.02)

        val result = condenser.condense(listOf(first, last))

        assertEquals(1, result.size)
        assertEquals(last, result[0])
    }

    fun `test message updates for different ids are kept separate`() {
        val result = condenser.condense(listOf(
            msgUpdated("m1"),
            msgUpdated("m2"),
        ))

        assertEquals(2, result.size)
        assertEquals("m1", (result[0] as ChatEventDto.MessageUpdated).info.id)
        assertEquals("m2", (result[1] as ChatEventDto.MessageUpdated).info.id)
    }

    fun `test barrier flushes pending message updates before it`() {
        val barrier = nonDelta("turn1")
        val result = condenser.condense(listOf(
            msgUpdated("m1"),
            barrier,
            msgUpdated("m1", cost = 0.05),
        ))

        assertEquals(3, result.size)
        assertNull((result[0] as ChatEventDto.MessageUpdated).info.cost)
        assertEquals(barrier, result[1])
        assertEquals(0.05, (result[2] as ChatEventDto.MessageUpdated).info.cost)
    }

    // ------ SessionStatusChanged coalescing ------

    fun `test consecutive status changes keep only latest`() {
        val busy = statusChanged("busy")
        val idle = statusChanged("idle")

        val result = condenser.condense(listOf(busy, idle))

        assertEquals(1, result.size)
        assertEquals("idle", (result[0] as ChatEventDto.SessionStatusChanged).status.type)
    }

    fun `test status changes for different sessions kept separate`() {
        val result = condenser.condense(listOf(
            ChatEventDto.SessionStatusChanged("ses1", SessionStatusDto("busy")),
            ChatEventDto.SessionStatusChanged("ses2", SessionStatusDto("idle")),
        ))

        assertEquals(2, result.size)
        assertEquals("ses1", (result[0] as ChatEventDto.SessionStatusChanged).sessionID)
        assertEquals("ses2", (result[1] as ChatEventDto.SessionStatusChanged).sessionID)
    }

    fun `test barrier flushes pending status change before it`() {
        val barrier = nonDelta("turn1")
        val result = condenser.condense(listOf(
            statusChanged("busy"),
            barrier,
            statusChanged("idle"),
        ))

        assertEquals(3, result.size)
        assertEquals("busy", (result[0] as ChatEventDto.SessionStatusChanged).status.type)
        assertEquals(barrier, result[1])
        assertEquals("idle", (result[2] as ChatEventDto.SessionStatusChanged).status.type)
    }

    // ------ SessionDiffChanged coalescing ------

    fun `test consecutive diff changes keep only latest`() {
        val first = ChatEventDto.SessionDiffChanged("ses", listOf(DiffFileDto("a.kt", 1, 0)))
        val last = ChatEventDto.SessionDiffChanged("ses", listOf(DiffFileDto("b.kt", 2, 1)))

        val result = condenser.condense(listOf(first, last))

        assertEquals(1, result.size)
        assertEquals(last, result[0])
    }

    // ------ State-event / content-event drain ordering ------

    fun `test mixed batch with two message updates same and status change is condensed`() {
        val result = condenser.condense(listOf(
            msgUpdated("m1"),
            msgUpdated("m1", cost = 0.02),
            statusChanged("busy"),
            statusChanged("idle"),
            ChatEventDto.SessionDiffChanged("ses", listOf(DiffFileDto("x.kt", 1, 0))),
        ))

        // 2 MU → 1, 2 SSC → 1, 1 SDC → 1  =  3 total
        assertEquals(3, result.size)
        assertEquals(0.02, (result[0] as ChatEventDto.MessageUpdated).info.cost)
        assertEquals("idle", (result[1] as ChatEventDto.SessionStatusChanged).status.type)
        assertTrue(result[2] is ChatEventDto.SessionDiffChanged)
    }

    fun `test message update is emitted before part update for same message`() {
        // Server always sends MessageUpdated before PartUpdated for a new message.
        // Condensing must preserve that semantic ordering.
        val result = condenser.condense(listOf(
            msgUpdated("m1"),
            updated("m1", "p1", "text", text = "hello"),
        ))

        assertEquals(2, result.size)
        assertTrue(result[0] is ChatEventDto.MessageUpdated)
        assertTrue(result[1] is ChatEventDto.PartUpdated)
    }

    fun `test part updates for same part coalesce across interleaved message update`() {
        // Both PUs are for the same part but separated by a MU.
        // MU drains and flushes the first PU, so they do NOT merge.
        val result = condenser.condense(listOf(
            updated("m1", "p1", "tool", state = "running"),
            msgUpdated("m1", cost = 0.01),
            updated("m1", "p1", "tool", state = "completed"),
        ))

        // running is flushed when MU arrives, completed is a new batch → cannot merge
        assertEquals(3, result.size)
        assertEquals("running", (result[0] as ChatEventDto.PartUpdated).part.state)
        assertNotNull(result[1] as? ChatEventDto.MessageUpdated)
        assertEquals("completed", (result[2] as ChatEventDto.PartUpdated).part.state)
    }

    // ------ helpers ------

    private fun msgUpdated(id: String, role: String = "assistant", cost: Double? = null) =
        ChatEventDto.MessageUpdated(
            "ses",
            MessageDto(id = id, sessionID = "ses", role = role, time = MessageTimeDto(0.0), cost = cost),
        )

    private fun statusChanged(type: String) =
        ChatEventDto.SessionStatusChanged("ses", SessionStatusDto(type))
}
