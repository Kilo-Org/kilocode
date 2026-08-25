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
            assertTrue(sessionAttentionNeeded(mapOf("ses" to SessionActivityDto("/repo/wt", kind))), kind.name)
        }
    }

    @Test
    fun `running and empty do not light up the dot`() {
        assertFalse(sessionAttentionNeeded(emptyMap()))
        assertFalse(sessionAttentionNeeded(mapOf("ses" to SessionActivityDto("/repo/wt", SessionActivityKindDto.RUNNING))))
    }
}
