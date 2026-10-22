package ai.kilocode.client.session.controller

import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionOptionDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto

/**
 * End-to-end-ish controller test that drives a realistic CLI-shaped event
 * sequence through [SessionController], verifies model/state, sends a
 * synthetic question reply, and verifies the reply payload forwarded to
 * [ai.kilocode.client.testing.FakeSessionRpcApi].
 *
 * KiloCliDataParser lives in the backend module and is not available in
 * the frontend test classpath. The fallback plan from the implementation
 * plan is used here: DTOs are constructed directly, which still validates
 * the full controller/model path.
 */
class JsonSessionStreamTest : SessionControllerTestBase() {

    fun `test cli stream with assistant text then two-question prompt and reply`() {
        val (m, _, modelEvents) = prompted()

        // --- session.turn.open ---
        emit(ChatEventDto.TurnOpen("ses_test"))

        // --- message.updated for assistant message ---
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg_assistant", "ses_test", "assistant")))

        // --- message.part.updated for text part ---
        emit(
            ChatEventDto.PartUpdated(
                "ses_test",
                part("part_text", "ses_test", "msg_assistant", "text", text = "I'll help you with that."),
            )
        )

        // --- question.asked with two question items ---
        val request = QuestionRequestDto(
            id = "q_strategy",
            sessionID = "ses_test",
            questions = listOf(
                QuestionInfoDto(
                    question = "Which implementation approach?",
                    header = "Approach",
                    options = listOf(
                        QuestionOptionDto("Minimal", "Keep changes minimal"),
                        QuestionOptionDto("Refactor", "Full refactor"),
                    ),
                    multiple = false,
                    custom = false,
                ),
                QuestionInfoDto(
                    question = "Which test level?",
                    header = "Test Level",
                    options = listOf(
                        QuestionOptionDto("Unit", "Unit tests only"),
                        QuestionOptionDto("Integration", "Integration tests"),
                    ),
                    multiple = false,
                    custom = false,
                ),
            ),
        )
        emit(ChatEventDto.QuestionAsked("ses_test", request))

        // Assert state is AwaitingQuestion
        assertTrue("Expected AwaitingQuestion state", m.model.state is SessionState.AwaitingQuestion)
        val questionState = m.model.state as SessionState.AwaitingQuestion
        assertEquals("q_strategy", questionState.question.id)
        assertEquals(2, questionState.question.items.size)

        // Assert session model includes assistant text and both question items
        assertSession(
            """
            assistant#msg_assistant
            text#part_text:
              I'll help you with that.
            ---
            question#q_strategy
            tool: <none>
            header: Approach
            prompt: Which implementation approach?
            option: Minimal - Keep changes minimal
            option: Refactor - Full refactor
            multiple: false
            custom: false
            header: Test Level
            prompt: Which test level?
            option: Unit - Unit tests only
            option: Integration - Integration tests
            multiple: false
            custom: false

            [code] [kilo/gpt-5] [awaiting-question]
            """,
            m,
        )

        modelEvents.clear()

        // --- Synthetic reply ---
        edt {
            m.replyQuestion(
                "q_strategy",
                QuestionReplyDto(listOf(listOf("Minimal"), listOf("Unit"))),
            )
        }
        flush()

        // Assert the reply was forwarded through RPC
        assertQuestionReply("q_strategy /test [[Minimal],[Unit]]", rpc.questionReplies)

        // --- question.replied — controller moves to Busy ---
        emit(ChatEventDto.QuestionReplied("ses_test", "q_strategy"))

        assertTrue(
            "Expected Busy state after QuestionReplied",
            m.model.state is SessionState.Busy,
        )
    }
}
