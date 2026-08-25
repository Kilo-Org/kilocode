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
            assertTrue(AgentAttention().update(activity(kind), read = false), kind.name)
        }
    }

    @Test
    fun `running and empty do not light up the dot`() {
        assertFalse(AgentAttention().update(emptyMap(), read = false))
        assertFalse(AgentAttention().update(activity(SessionActivityKindDto.RUNNING), read = false))
    }

    @Test
    fun `attention already read stays clear after leaving the tab`() {
        val attention = AgentAttention()
        val errored = activity(SessionActivityKindDto.ERROR)

        assertFalse(attention.update(errored, read = true))
        // The error sticks in the snapshot until the session runs again; the dot must not come back.
        assertFalse(attention.update(errored, read = false))
        assertFalse(attention.update(errored, read = false))
    }

    @Test
    fun `attention arriving while the panel is unread lights the dot`() {
        val attention = AgentAttention()
        attention.update(activity(SessionActivityKindDto.ERROR), read = true)

        val another = mapOf(
            "ses_1" to SessionActivityDto("/repo/wt", SessionActivityKindDto.ERROR),
            "ses_2" to SessionActivityDto("/repo/other", SessionActivityKindDto.QUESTION),
        )

        assertTrue(attention.update(another, read = false))
    }

    @Test
    fun `a session that recovers and fails again lights the dot again`() {
        val attention = AgentAttention()
        val errored = activity(SessionActivityKindDto.ERROR)
        attention.update(errored, read = true)

        assertFalse(attention.update(emptyMap(), read = false))
        assertTrue(attention.update(errored, read = false))
    }

    private fun activity(kind: SessionActivityKindDto) =
        mapOf("ses_1" to SessionActivityDto("/repo/wt", kind))
}
