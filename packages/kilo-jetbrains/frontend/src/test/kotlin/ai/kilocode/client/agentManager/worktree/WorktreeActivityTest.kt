package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionActivityKindDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class WorktreeActivityTest {
    @Test
    fun `aggregates multiple sessions by directory with deterministic precedence`() {
        val result = aggregateWorktreeActivity(mapOf(
            "ses_run" to SessionActivityDto("/repo/wt", SessionActivityKindDto.RUNNING),
            "ses_plan" to SessionActivityDto("/repo/wt", SessionActivityKindDto.PLAN),
            "ses_question" to SessionActivityDto("/repo/wt", SessionActivityKindDto.QUESTION),
            "ses_permission" to SessionActivityDto("/repo/wt", SessionActivityKindDto.PERMISSION),
        ))

        assertEquals(SessionActivityKind.PERMISSION, result["/repo/wt"])
    }

    @Test
    fun `question beats plan and running while running is used alone`() {
        val result = aggregateWorktreeActivity(mapOf(
            "ses_run" to SessionActivityDto("/repo/a", SessionActivityKindDto.RUNNING),
            "ses_plan" to SessionActivityDto("/repo/b", SessionActivityKindDto.PLAN),
            "ses_question" to SessionActivityDto("/repo/b", SessionActivityKindDto.QUESTION),
        ))

        assertEquals(SessionActivityKind.RUNNING, result["/repo/a"])
        assertEquals(SessionActivityKind.QUESTION, result["/repo/b"])
    }

    @Test
    fun `running outranks a sibling error but yields to interactive prompts`() {
        val runningOverError = aggregateWorktreeActivity(mapOf(
            "ses_run" to SessionActivityDto("/repo/wt", SessionActivityKindDto.RUNNING),
            "ses_error" to SessionActivityDto("/repo/wt", SessionActivityKindDto.ERROR),
        ))
        assertEquals(SessionActivityKind.RUNNING, runningOverError["/repo/wt"])

        val questionOverError = aggregateWorktreeActivity(mapOf(
            "ses_error" to SessionActivityDto("/repo/wt", SessionActivityKindDto.ERROR),
            "ses_question" to SessionActivityDto("/repo/wt", SessionActivityKindDto.QUESTION),
        ))
        assertEquals(SessionActivityKind.QUESTION, questionOverError["/repo/wt"])
    }

    @Test
    fun `attention ranks waiting sessions and ignores running work`() {
        val kinds = mapOf(
            "ses_run" to SessionActivityKind.RUNNING,
            "ses_error" to SessionActivityKind.ERROR,
            "ses_question" to SessionActivityKind.QUESTION,
            "ses_permission" to SessionActivityKind.PERMISSION,
        )

        assertEquals(SessionActivityKind.PERMISSION, attention(kinds))
        assertEquals(SessionActivityKind.QUESTION, attention(kinds, current = "ses_permission"))
        assertNull(attention(mapOf("ses_run" to SessionActivityKind.RUNNING)))
        assertNull(attention(emptyMap()))
    }

    @Test
    fun `attention skips the current and deleting sessions`() {
        val kinds = mapOf(
            "ses_open" to SessionActivityKind.QUESTION,
            "ses_gone" to SessionActivityKind.PERMISSION,
        )

        assertNull(attention(kinds, current = "ses_open", deleting = setOf("ses_gone")))
        assertEquals(SessionActivityKind.QUESTION, attention(kinds, deleting = setOf("ses_gone")))
    }

    @Test
    fun `normalizes trailing slashes`() {
        val result = aggregateWorktreeActivity(mapOf(
            "ses_1" to SessionActivityDto("/repo/wt/", SessionActivityKindDto.RUNNING),
        ))

        assertEquals(mapOf("/repo/wt" to SessionActivityKind.RUNNING), result)
        assertEquals("/repo/wt", normalizeWorktreePath("/repo/wt/"))
    }
}
