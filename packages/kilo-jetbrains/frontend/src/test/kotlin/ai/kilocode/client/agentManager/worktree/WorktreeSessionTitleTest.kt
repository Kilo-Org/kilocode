package ai.kilocode.client.agentManager.worktree

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WorktreeSessionTitleTest {

    @Test
    fun `default placeholder titles are detected`() {
        assertTrue(isDefaultSessionTitle("New session - 2026-07-30T19:01:40.945Z"))
        assertTrue(isDefaultSessionTitle("Child session - 2026-07-30T19:01:40.945Z"))
    }

    @Test
    fun `agent-generated and user titles are not default`() {
        assertFalse(isDefaultSessionTitle("Repository overview request"))
        assertFalse(isDefaultSessionTitle(""))
        assertFalse(isDefaultSessionTitle("New session - not a timestamp"))
        assertFalse(isDefaultSessionTitle("New session"))
    }
}
