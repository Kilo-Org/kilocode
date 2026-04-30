package ai.kilocode.client.session.update

import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.TodoDto

/**
 * Controller-level tests for session artifact events:
 * [ChatEventDto.SessionDiffChanged], [ChatEventDto.TodoUpdated], and
 * [ChatEventDto.SessionCompacted].
 *
 * Verifies that the controller forwards them to the model and fires the
 * expected model events, and that the session ID filter drops events
 * belonging to other sessions.
 */
class SessionArtifactsTest : SessionControllerTestBase() {

    // ------ SessionDiffChanged ------

    fun `test SessionDiffChanged updates model and fires DiffUpdated`() {
        val (m, _, modelEvents) = prompted()

        emit(ChatEventDto.SessionDiffChanged(
            sessionID = "ses_test",
            diff = listOf(
                DiffFileDto("src/A.kt", additions = 5, deletions = 2),
                DiffFileDto("src/B.kt", additions = 1, deletions = 0),
            ),
        ))

        assertModelEvents("DiffUpdated files=2", modelEvents)
        assertSession(
            """
            diff: src/A.kt src/B.kt

            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
    }

    fun `test SessionDiffChanged from other session is ignored`() {
        val (m, _, modelEvents) = prompted()

        emit(ChatEventDto.SessionDiffChanged(
            sessionID = "ses_other",
            diff = listOf(DiffFileDto("src/Other.kt", additions = 1, deletions = 0)),
        ))

        assertModelEvents("", modelEvents)
        assertSession(
            """
            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
    }

    fun `test SessionDiffChanged with empty list clears diff`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.SessionDiffChanged("ses_test", listOf(DiffFileDto("src/A.kt", 3, 1))))
        emit(ChatEventDto.SessionDiffChanged("ses_test", emptyList()))

        assertSession(
            """
            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
    }

    // ------ TodoUpdated ------

    fun `test TodoUpdated updates model and fires TodosUpdated`() {
        val (m, _, modelEvents) = prompted()

        emit(ChatEventDto.TodoUpdated(
            sessionID = "ses_test",
            todos = listOf(
                TodoDto("Write tests", "pending", "high"),
                TodoDto("Ship it", "in_progress", "medium"),
            ),
        ))

        assertModelEvents("TodosUpdated count=2", modelEvents)
        assertSession(
            """
            todo: [pending] Write tests
            todo: [in_progress] Ship it

            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
    }

    fun `test TodoUpdated from other session is ignored`() {
        val (m, _, modelEvents) = prompted()

        emit(ChatEventDto.TodoUpdated(
            sessionID = "ses_other",
            todos = listOf(TodoDto("alien task", "pending", "low")),
        ))

        assertModelEvents("", modelEvents)
        assertSession(
            """
            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
    }

    fun `test TodoUpdated replaces previous todo list`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TodoUpdated("ses_test", listOf(
            TodoDto("task1", "pending", "high"),
            TodoDto("task2", "pending", "low"),
        )))
        emit(ChatEventDto.TodoUpdated("ses_test", listOf(
            TodoDto("only task", "completed", "medium"),
        )))

        assertSession(
            """
            todo: [completed] only task

            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
    }

    // ------ SessionCompacted ------

    fun `test SessionCompacted fires Compacted event`() {
        val (m, _, modelEvents) = prompted()

        emit(ChatEventDto.SessionCompacted("ses_test"))

        assertModelEvents("Compacted count=1", modelEvents)
        assertSession(
            """
            compacted: 1

            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
    }

    fun `test multiple SessionCompacted events accumulate`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.SessionCompacted("ses_test"), flush = false)
        emit(ChatEventDto.SessionCompacted("ses_test"), flush = false)
        emit(ChatEventDto.SessionCompacted("ses_test"))

        assertSession(
            """
            compacted: 3

            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
    }

    fun `test SessionCompacted from other session is ignored`() {
        val (m, _, modelEvents) = prompted()

        emit(ChatEventDto.SessionCompacted("ses_other"))

        assertModelEvents("", modelEvents)
        assertSession(
            """
            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
    }
}
