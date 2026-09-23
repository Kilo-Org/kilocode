package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.background.BackgroundAgent
import ai.kilocode.client.session.background.BackgroundAgentStatus
import ai.kilocode.client.ui.HoverArea
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Component
import java.awt.Container

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
        val firstCompact = compact(strip, "Agent job1")
        val secondCompact = compact(strip, "Agent job2")
        assertNotNull(first)
        assertNotNull(second)
        assertNotNull(firstCompact)
        assertNotNull(secondCompact)

        repeat(200) { i ->
            val count = 3 + i % 20
            val agents = listOf(agent("job1"), agent("job2")) + (3 until count).map { agent("job$it") }
            strip.update(agents)
            assertSame(first, strip.agentRowPanel("job1"))
            assertSame(second, strip.agentRowPanel("job2"))
            assertSame(firstCompact, compact(strip, "Agent job1"))
            assertSame(secondCompact, compact(strip, "Agent job2"))
            assertEquals(agents.size, strip.rowCount())
            assertEquals(agents.size + 1, descendants(strip.rowComponent()).filterIsInstance<HoverArea>().size)
        }

        // Settling back down to just the two stable rows must drop every churned row.
        strip.update(listOf(agent("job1"), agent("job2")))
        assertEquals(2, strip.rowCount())
        assertSame(first, strip.agentRowPanel("job1"))
        assertSame(second, strip.agentRowPanel("job2"))
        assertSame(firstCompact, compact(strip, "Agent job1"))
        assertSame(secondCompact, compact(strip, "Agent job2"))
    }

    private fun compact(strip: BackgroundAgentStrip, title: String) =
        descendants(strip.rowComponent()).filterIsInstance<HoverArea>().firstOrNull {
            it.accessibleContext.accessibleName == "Open background agent $title"
        }

    private fun descendants(root: Component): List<Component> = buildList {
        add(root)
        if (root is Container) root.components.forEach { addAll(descendants(it)) }
    }

    private fun agent(job: String) =
        BackgroundAgent(job = job, session = "${job}_session", title = "Agent $job", status = BackgroundAgentStatus.RUNNING)
}
