package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.background.BackgroundAgent
import ai.kilocode.client.session.background.BackgroundAgentStatus
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Streaming-UI churn test for [BackgroundAgentStrip], per this plugin's stress + leak test
 * requirement for retained Swing surfaces that rebuild their row list on every update.
 */
class BackgroundAgentStripStressTest : BasePlatformTestCase() {

    fun `test agent churn retains stable rows and stays bounded`() {
        val strip = BackgroundAgentStrip(false, { _, _ -> }, {}, {}, {})
        strip.update(listOf(agent("job1"), agent("job2"), agent("job3")))
        val first = strip.agentRowPanel("job1")
        val second = strip.agentRowPanel("job2")
        assertNotNull(first)
        assertNotNull(second)

        repeat(200) { i ->
            val count = 3 + i % 20
            val agents = listOf(agent("job1"), agent("job2")) + (3 until count).map { agent("job$it") }
            strip.update(agents)
            assertSame(first, strip.agentRowPanel("job1"))
            assertSame(second, strip.agentRowPanel("job2"))
            assertEquals(agents.size, strip.rowCount())
        }

        // Settling back down to just the two stable rows must drop every churned row.
        strip.update(listOf(agent("job1"), agent("job2")))
        assertEquals(2, strip.rowCount())
        assertSame(first, strip.agentRowPanel("job1"))
        assertSame(second, strip.agentRowPanel("job2"))
    }

    private fun agent(job: String) =
        BackgroundAgent(job = job, session = "${job}_session", title = "Agent $job", status = BackgroundAgentStatus.RUNNING)
}
