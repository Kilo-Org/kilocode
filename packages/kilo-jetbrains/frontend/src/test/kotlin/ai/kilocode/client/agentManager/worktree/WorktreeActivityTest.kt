package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionActivityKindDto
import kotlin.test.Test
import kotlin.test.assertEquals

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
    fun `normalizes trailing slashes`() {
        val result = aggregateWorktreeActivity(mapOf(
            "ses_1" to SessionActivityDto("/repo/wt/", SessionActivityKindDto.RUNNING),
        ))

        assertEquals(mapOf("/repo/wt" to SessionActivityKind.RUNNING), result)
        assertEquals("/repo/wt", normalizeWorktreePath("/repo/wt/"))
    }

    @Test
    fun `worktree activity badges use shared session activity styles`() {
        assertEquals(SessionActivityKind.RUNNING.style(), worktreeActivityBadge(SessionActivityKind.RUNNING).style)
        assertEquals(SessionActivityKind.QUESTION.style(), worktreeActivityBadge(SessionActivityKind.QUESTION).style)
        assertEquals(SessionActivityKind.PERMISSION.style(), worktreeActivityBadge(SessionActivityKind.PERMISSION).style)
        assertEquals(SessionActivityKind.RUNNING.label(), worktreeActivityBadge(SessionActivityKind.RUNNING).text)
    }
}
