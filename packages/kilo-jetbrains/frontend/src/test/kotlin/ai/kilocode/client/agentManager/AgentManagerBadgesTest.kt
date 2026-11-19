package ai.kilocode.client.agentManager

import ai.kilocode.client.testing.FakeAgentManagerFacade
import ai.kilocode.client.testing.installBrowser
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhCommentsDto
import ai.kilocode.rpc.dto.GhMerge
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class AgentManagerBadgesTest : BasePlatformTestCase() {
    private val commands = setOf(
        AgentManagerCommand.PR, AgentManagerCommand.REVIEW, AgentManagerCommand.CHECKS,
        AgentManagerCommand.COMMENTS, AgentManagerCommand.BASE_DIFF, AgentManagerCommand.UNCOMMITTED_DIFF,
    )

    fun `test every PR badge dispatches its own command and captured element for local and cloud`() {
        val browser = installBrowser()
        edtWait {
            for (element in elements()) {
                val facade = FakeAgentManagerFacade(state(element))
                val badges = AgentManagerBadges(facade, element)
                assertEquals(listOf("pr-comments", "pr-review", "pr-checks"), badges.primary.map { it.id })
                assertEquals("#7", badges.secondary.single().text)
                assertTrue(facade.queries.isEmpty())

                (badges.primary + badges.secondary).forEach { requireNotNull(it.action).invoke() }

                val expected = listOf(
                    AgentManagerCommand.COMMENTS, AgentManagerCommand.REVIEW,
                    AgentManagerCommand.CHECKS, AgentManagerCommand.PR,
                )
                assertEquals(expected, facade.calls.map { it.command })
                assertEquals(expected.map { element to it }, facade.queries)
                assertTrue(facade.calls.all { it.element == element && it.target == null })
            }
        }
        assertTrue(browser.urls.isEmpty())
    }

    fun `test initially unavailable badge commands stay inert while their status remains visible`() = edtWait {
        for (element in elements()) {
            val facade = FakeAgentManagerFacade(state(element).copy(enabled = setOf(AgentManagerCommand.CHECKS)))
            val badges = AgentManagerBadges(facade, element)
            assertEquals(3, badges.primary.size)
            assertNull(badges.secondary.single().action)
            assertNull(badges.primary.single { it.id == "pr-comments" }.action)
            assertNull(badges.primary.single { it.id == "pr-review" }.action)
            assertNotNull(badges.primary.single { it.id == "pr-checks" }.action)
            assertNull(badges.metrics?.action)

            facade.enabled = commands
            assertNull(badges.actions.open)
            facade.state = facade.state.copy(enabled = commands)
            val next = AgentManagerBadges(facade, element)
            assertFalse(badges.state == next.state)
            assertNotNull(next.actions.open)
            assertEquals(next.state, AgentManagerBadges(facade, element).state)
            assertTrue(facade.calls.isEmpty())
        }
    }

    fun `test retained callbacks recheck live availability before dispatching`() = edtWait {
        for (element in elements()) {
            val facade = FakeAgentManagerFacade(state(element))
            val badges = AgentManagerBadges(facade, element)
            val callbacks = (badges.primary + badges.secondary).map { requireNotNull(it.action) } +
                listOfNotNull(badges.action(AgentManagerCommand.BASE_DIFF), badges.action(AgentManagerCommand.UNCOMMITTED_DIFF))

            facade.enabled = emptySet()
            callbacks.forEach { it() }
            assertTrue(facade.calls.isEmpty())
            assertEquals(callbacks.size, facade.queries.size)

            facade.enabled = setOf(AgentManagerCommand.CHECKS)
            callbacks.forEach { it() }
            assertEquals(listOf(AgentManagerCommand.CHECKS), facade.calls.map { it.command })
            assertEquals(element, facade.calls.single().element)
        }
    }

    fun `test metrics retain the existing committed and uncommitted comparison selection`() = edtWait {
        val element = elements().filterIsInstance<AgentManagerElement.Local>().single()
        val facade = FakeAgentManagerFacade(state(element))
        val badges = AgentManagerBadges(facade, element)
        val metrics = requireNotNull(badges.metrics)
        assertEquals(2, metrics.files)
        assertEquals(9, metrics.additions)
        assertEquals(4, metrics.deletions)
        assertEquals("origin/main", metrics.base)
        assertEquals(1, metrics.localFiles)
        assertEquals(5, metrics.localAdditions)
        assertTrue(metrics.conflict)
        assertFalse(metrics.local)
        requireNotNull(metrics.action).invoke()

        facade.state = facade.state.copy(stats = null)
        val local = requireNotNull(AgentManagerBadges(facade, element).metrics)
        assertTrue(local.local)
        requireNotNull(local.action).invoke()
        assertEquals(
            listOf(AgentManagerCommand.BASE_DIFF, AgentManagerCommand.UNCOMMITTED_DIFF),
            facade.calls.map { it.command },
        )
        assertTrue(facade.calls.all { it.element == element })
    }

    fun `test busy rows hide badges and metrics and idle rows follow facade evidence`() = edtWait {
        for (element in elements()) {
            val facade = FakeAgentManagerFacade(state(element).copy(busy = true))
            val busy = AgentManagerBadges(facade, element)
            assertEmpty(busy.primary)
            assertEmpty(busy.secondary)
            assertNull(busy.metrics)
            commands.forEach { assertNull(busy.action(it)) }
            assertTrue(facade.queries.isEmpty())

            facade.state = facade.state.copy(busy = false)
            val idle = AgentManagerBadges(facade, element)
            assertEquals(facade.state.stats != null || facade.state.dirty != null, idle.metrics != null)
        }
    }

    fun `test facade supplied metrics use the same renderer and action for either element type`() = edtWait {
        for (element in elements()) {
            val facade = FakeAgentManagerFacade(state(element).copy(
                stats = WorktreeStatsDto(element.key, files = 2, additions = 3),
            ))
            val metrics = requireNotNull(AgentManagerBadges(facade, element).metrics)
            assertEquals(2, metrics.files)
            requireNotNull(metrics.action).invoke()
            assertEquals(element, facade.calls.single().element)
            assertEquals(AgentManagerCommand.BASE_DIFF, facade.calls.single().command)
        }
    }

    private fun elements() = listOf(
        AgentManagerElement.Local(WorktreeDto("/repo/feature", "feature", "feature/x", "/repo/feature")),
        AgentManagerElement.Cloud(HostedWorkspaceDto(HostedWorkspaceRefDto("cloud", "workspace"))),
    )

    private fun state(element: AgentManagerElement) = AgentManagerBadgeState(
        pr = WorktreePrDto(
            element.key, 7, GhState.OPEN, "https://example.test/pr/7", "Feature",
            GhReview.APPROVED, GhChecksDto(GhChecks.FAILED, total = 3, failed = 1),
            GhCommentsDto(total = 4, unresolved = 2), GhMerge.CONFLICTING,
        ),
        stats = WorktreeStatsDto(element.key, additions = 9, deletions = 4, files = 2, ahead = 3, behind = 1, base = "origin/main")
            .takeIf { element is AgentManagerElement.Local },
        dirty = WorktreeDirtyDto(element.key, additions = 5, files = 1).takeIf { element is AgentManagerElement.Local },
        enabled = commands,
    )
}
