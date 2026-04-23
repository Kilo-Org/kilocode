package ai.kilocode.backend.cli

import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageErrorDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionStatusDto
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Round-trip serialization tests for [ChatEventDto].
 *
 * Verifies that the @SerialName values match the real CLI event type strings
 * and that polymorphic serialization/deserialization works end-to-end.
 */
class ChatDtoSerializationTest {

    private val json = Json {
        ignoreUnknownKeys = true
        classDiscriminator = "type"
    }

    // ================================================================
    // Serial name round-trips — confirms @SerialName matches CLI types
    // ================================================================

    @Test
    fun `MessageUpdated serializes with correct type discriminator`() {
        val event: ChatEventDto = ChatEventDto.MessageUpdated(
            sessionID = "ses_1",
            info = msg("msg_1"),
        )
        val encoded = json.encodeToString(ChatEventDto.serializer(), event)
        assertTrue(encoded.contains(""""type":"message.updated""""), "Expected type=message.updated in: $encoded")

        val decoded = json.decodeFromString(ChatEventDto.serializer(), encoded)
        assertTrue(decoded is ChatEventDto.MessageUpdated)
        assertEquals("ses_1", (decoded as ChatEventDto.MessageUpdated).sessionID)
    }

    @Test
    fun `PartUpdated serializes with type message dot part dot updated`() {
        val event: ChatEventDto = ChatEventDto.PartUpdated(
            sessionID = "ses_1",
            part = part("p1"),
        )
        val encoded = json.encodeToString(ChatEventDto.serializer(), event)
        assertTrue(encoded.contains(""""type":"message.part.updated""""), "Expected type=message.part.updated in: $encoded")

        val decoded = json.decodeFromString(ChatEventDto.serializer(), encoded)
        assertTrue(decoded is ChatEventDto.PartUpdated)
    }

    @Test
    fun `PartDelta serializes with type message dot part dot delta`() {
        val event: ChatEventDto = ChatEventDto.PartDelta("ses_1", "msg_1", "part_1", "text", "hello")
        val encoded = json.encodeToString(ChatEventDto.serializer(), event)
        assertTrue(encoded.contains(""""type":"message.part.delta""""), "Expected type=message.part.delta in: $encoded")

        val decoded = json.decodeFromString(ChatEventDto.serializer(), encoded) as ChatEventDto.PartDelta
        assertEquals("hello", decoded.delta)
    }

    @Test
    fun `PartRemoved serializes with type message dot part dot removed`() {
        val event: ChatEventDto = ChatEventDto.PartRemoved("ses_1", "msg_1", "part_1")
        val encoded = json.encodeToString(ChatEventDto.serializer(), event)
        assertTrue(encoded.contains(""""type":"message.part.removed""""), "Expected type=message.part.removed in: $encoded")

        val decoded = json.decodeFromString(ChatEventDto.serializer(), encoded) as ChatEventDto.PartRemoved
        assertEquals("part_1", decoded.partID)
    }

    @Test
    fun `TurnOpen serializes with type session dot turn dot open`() {
        val event: ChatEventDto = ChatEventDto.TurnOpen("ses_1")
        val encoded = json.encodeToString(ChatEventDto.serializer(), event)
        assertTrue(encoded.contains(""""type":"session.turn.open""""), "Expected type=session.turn.open in: $encoded")

        val decoded = json.decodeFromString(ChatEventDto.serializer(), encoded)
        assertTrue(decoded is ChatEventDto.TurnOpen)
    }

    @Test
    fun `TurnClose serializes with type session dot turn dot close`() {
        val event: ChatEventDto = ChatEventDto.TurnClose("ses_1", "completed")
        val encoded = json.encodeToString(ChatEventDto.serializer(), event)
        assertTrue(encoded.contains(""""type":"session.turn.close""""), "Expected type=session.turn.close in: $encoded")

        val decoded = json.decodeFromString(ChatEventDto.serializer(), encoded) as ChatEventDto.TurnClose
        assertEquals("completed", decoded.reason)
    }

    @Test
    fun `Error serializes with type session dot error`() {
        val event: ChatEventDto = ChatEventDto.Error("ses_1", MessageErrorDto("timeout", "Timed out"))
        val encoded = json.encodeToString(ChatEventDto.serializer(), event)
        assertTrue(encoded.contains(""""type":"session.error""""), "Expected type=session.error in: $encoded")
    }

    @Test
    fun `SessionStatusChanged serializes with full retry detail`() {
        val event: ChatEventDto = ChatEventDto.SessionStatusChanged(
            sessionID = "ses_1",
            status = SessionStatusDto("retry", "Retrying", attempt = 3, next = 5000L),
        )
        val encoded = json.encodeToString(ChatEventDto.serializer(), event)
        assertTrue(encoded.contains(""""type":"session.status""""), "Expected type=session.status in: $encoded")
        assertTrue(encoded.contains(""""attempt":3"""), "Expected attempt in: $encoded")
        assertTrue(encoded.contains(""""next":5000"""), "Expected next in: $encoded")

        val decoded = json.decodeFromString(ChatEventDto.serializer(), encoded) as ChatEventDto.SessionStatusChanged
        assertEquals(3, decoded.status.attempt)
        assertEquals(5000L, decoded.status.next)
    }

    @Test
    fun `SessionStatusChanged serializes with offline requestID`() {
        val event: ChatEventDto = ChatEventDto.SessionStatusChanged(
            sessionID = "ses_1",
            status = SessionStatusDto("offline", "No connection", requestID = "req_abc"),
        )
        val encoded = json.encodeToString(ChatEventDto.serializer(), event)
        assertTrue(encoded.contains(""""requestID":"req_abc""""), "Expected requestID in: $encoded")

        val decoded = json.decodeFromString(ChatEventDto.serializer(), encoded) as ChatEventDto.SessionStatusChanged
        assertEquals("req_abc", decoded.status.requestID)
    }

    @Test
    fun `PermissionAsked serializes with correct type`() {
        val event: ChatEventDto = ChatEventDto.PermissionAsked(
            sessionID = "ses_1",
            request = PermissionRequestDto("p1", "ses_1", "edit", listOf("*.kt")),
        )
        val encoded = json.encodeToString(ChatEventDto.serializer(), event)
        assertTrue(encoded.contains(""""type":"permission.asked""""))
    }

    @Test
    fun `QuestionAsked serializes with correct type`() {
        val event: ChatEventDto = ChatEventDto.QuestionAsked(
            sessionID = "ses_1",
            request = QuestionRequestDto("q1", "ses_1", listOf(QuestionInfoDto("pick", "h"))),
        )
        val encoded = json.encodeToString(ChatEventDto.serializer(), event)
        assertTrue(encoded.contains(""""type":"question.asked""""))
    }

    @Test
    fun `TodoUpdated serializes with correct type`() {
        val event: ChatEventDto = ChatEventDto.TodoUpdated("ses_1", emptyList())
        val encoded = json.encodeToString(ChatEventDto.serializer(), event)
        assertTrue(encoded.contains(""""type":"todo.updated""""))
    }

    @Test
    fun `SessionIdle serializes with correct type`() {
        val event: ChatEventDto = ChatEventDto.SessionIdle("ses_1")
        val encoded = json.encodeToString(ChatEventDto.serializer(), event)
        assertTrue(encoded.contains(""""type":"session.idle""""))
    }

    @Test
    fun `SessionCompacted serializes with correct type`() {
        val event: ChatEventDto = ChatEventDto.SessionCompacted("ses_1")
        val encoded = json.encodeToString(ChatEventDto.serializer(), event)
        assertTrue(encoded.contains(""""type":"session.compacted""""))
    }

    @Test
    fun `PartDto callID is preserved in round-trip`() {
        val part = PartDto(
            id = "p1", sessionID = "s1", messageID = "m1",
            type = "tool", tool = "bash", callID = "call_abc",
        )
        val encoded = json.encodeToString(PartDto.serializer(), part)
        assertTrue(encoded.contains(""""callID":"call_abc""""))

        val decoded = json.decodeFromString(PartDto.serializer(), encoded)
        assertEquals("call_abc", decoded.callID)
    }

    // ------ helpers ------

    private fun msg(id: String) = MessageDto(
        id = id, sessionID = "ses_1", role = "assistant",
        time = MessageTimeDto(created = 0.0),
    )

    private fun part(id: String) = PartDto(
        id = id, sessionID = "ses_1", messageID = "msg_1", type = "text",
    )
}
