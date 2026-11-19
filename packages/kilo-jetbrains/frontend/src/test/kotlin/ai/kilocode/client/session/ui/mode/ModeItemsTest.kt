package ai.kilocode.client.session.ui.mode

import ai.kilocode.rpc.dto.AgentDto
import org.junit.Assert.assertEquals
import org.junit.Test

class ModeItemsTest {

    @Test
    fun `agentTitle prefers the explicit display name`() {
        assertEquals("Code Reviewer", agentTitle("code-reviewer", "Code Reviewer"))
    }

    @Test
    fun `agentTitle title-cases the id fallback`() {
        assertEquals("Upstream Merge", agentTitle("upstream-merge", null))
        assertEquals("Ask", agentTitle("ask", null))
        assertEquals("Debug Mode", agentTitle("debug_mode", null))
    }

    @Test
    fun `modeItems maps agents with the shared display fallback`() {
        val items = modeItems(
            listOf(
                AgentDto(name = "ask", mode = "primary"),
                AgentDto(name = "code-reviewer", displayName = "Code Reviewer", mode = "primary", deprecated = true),
            ),
        )

        assertEquals(listOf("Ask", "Code Reviewer"), items.map { it.display })
        assertEquals(listOf("ask", "code-reviewer"), items.map { it.id })
        assertEquals(listOf(false, true), items.map { it.deprecated })
    }
}
