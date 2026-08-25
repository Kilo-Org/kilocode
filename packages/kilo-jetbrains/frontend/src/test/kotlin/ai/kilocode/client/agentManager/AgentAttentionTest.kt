package ai.kilocode.client.agentManager

import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionActivityKindDto
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AgentAttentionTest {
    @Test
    fun `attention states light up the dot`() {
        for (kind in listOf(
            SessionActivityKindDto.QUESTION,
            SessionActivityKindDto.PLAN,
            SessionActivityKindDto.PERMISSION,
            SessionActivityKindDto.ERROR,
        )) {
            assertTrue(sessionAttentionNeeded(activity(kind)), kind.name)
        }
    }

    @Test
    fun `running and empty do not light up the dot`() {
        assertFalse(sessionAttentionNeeded(emptyMap()))
        assertFalse(sessionAttentionNeeded(activity(SessionActivityKindDto.RUNNING)))
    }

    @Test
    fun `one session needing attention lights the dot for the whole snapshot`() {
        val mixed = mapOf(
            "ses_running" to SessionActivityDto("/repo/a", SessionActivityKindDto.RUNNING),
            "ses_failed" to SessionActivityDto("/repo/b", SessionActivityKindDto.ERROR),
        )

        assertTrue(sessionAttentionNeeded(mixed))
        // Only resolving it clears the dot, however often the state is re-evaluated.
        assertTrue(sessionAttentionNeeded(mixed))
        assertFalse(sessionAttentionNeeded(mixed - "ses_failed"))
    }

    private fun activity(kind: SessionActivityKindDto) =
        mapOf("ses_1" to SessionActivityDto("/repo/wt", kind))
}
