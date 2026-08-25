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
            assertTrue(AgentAttention().update(activity(kind), showing = false), kind.name)
        }
    }

    @Test
    fun `running and empty do not light up the dot`() {
        assertFalse(AgentAttention().update(emptyMap(), showing = false))
        assertFalse(AgentAttention().update(activity(SessionActivityKindDto.RUNNING), showing = false))
    }

    @Test
    fun `attention seen on screen stays clear after leaving the tab`() {
        val attention = AgentAttention()
        val errored = activity(SessionActivityKindDto.ERROR)

        assertFalse(attention.update(errored, showing = true))
        // The error sticks in the snapshot until the session runs again; the dot must not come back.
        assertFalse(attention.update(errored, showing = false))
        assertFalse(attention.update(errored, showing = false))
    }

    @Test
    fun `attention arriving while the tab is hidden lights the dot`() {
        val attention = AgentAttention()
        attention.update(activity(SessionActivityKindDto.ERROR), showing = true)

        val another = mapOf(
            "ses_1" to SessionActivityDto("/repo/wt", SessionActivityKindDto.ERROR),
            "ses_2" to SessionActivityDto("/repo/other", SessionActivityKindDto.QUESTION),
        )

        assertTrue(attention.update(another, showing = false))
    }

    @Test
    fun `a session that recovers and fails again lights the dot again`() {
        val attention = AgentAttention()
        val errored = activity(SessionActivityKindDto.ERROR)
        attention.update(errored, showing = true)

        assertFalse(attention.update(emptyMap(), showing = false))
        assertTrue(attention.update(errored, showing = false))
    }

    private fun activity(kind: SessionActivityKindDto) =
        mapOf("ses_1" to SessionActivityDto("/repo/wt", kind))
}
