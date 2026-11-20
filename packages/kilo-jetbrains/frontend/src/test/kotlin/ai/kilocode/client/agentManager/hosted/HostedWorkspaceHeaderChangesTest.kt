package ai.kilocode.client.agentManager.hosted

import ai.kilocode.rpc.dto.HostedWorkspaceChangeComparisonDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangeFileDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangesDto
import ai.kilocode.rpc.dto.HostedWorkspaceComparisonDto
import ai.kilocode.rpc.dto.HostedWorkspaceContentAvailabilityDto
import ai.kilocode.rpc.dto.HostedWorkspaceDiffAvailabilityDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class HostedWorkspaceHeaderChangesTest : BasePlatformTestCase() {
    private val ref = HostedWorkspaceRefDto("cloud", "workspace")

    fun `test saved scopes project into shared header models with saturation`() {
        val changes = captured(listOf(
            comparison("origin/main", listOf(
                file("a.kt", "against-base-branch", Int.MAX_VALUE.toLong() + 10, 2),
                file("b.kt", "uncommitted", 7, 3, tracked = false),
                file("ignored.kt", null, 100, 100),
            )),
            comparison("origin/main", listOf(file("omitted.bin", "against-base-branch", 0, 4))),
        )).headerChanges()

        assertEquals(Int.MAX_VALUE, changes.stats.additions)
        assertEquals(6, changes.stats.deletions)
        assertEquals(2, changes.stats.files)
        assertEquals("origin/main", changes.stats.base)
        assertFalse(changes.stats.unavailable)
        assertTrue("Saturated totals are a lower bound", changes.stats.incomplete)
        assertEquals(7, changes.dirty.additions)
        assertEquals(3, changes.dirty.deletions)
        assertEquals(1, changes.dirty.files)
        assertEquals(1, changes.dirty.untracked)
        assertFalse(changes.dirty.incomplete)
    }

    fun `test multiple bases avoid a misleading label and uncaptured snapshots read as unknown`() {
        val mixed = captured(listOf(
            comparison("main", listOf(file("a", "against-base-branch", 1, 0))),
            comparison("develop", listOf(file("b", "against-base-branch", 1, 0))),
        )).headerChanges()
        assertEquals("", mixed.stats.base)

        for (status in listOf("not_captured", "inconsistent")) {
            val unknown = HostedWorkspaceChangesDto(ref, status, null, null, false, null).headerChanges()
            assertTrue(unknown.stats.unavailable)
            assertTrue(unknown.dirty.unavailable)
            assertTrue(unknown.stats.reason.isNotBlank())
            assertEquals(unknown.stats.reason, unknown.dirty.reason)
            assertEquals(0, unknown.stats.files)
            assertEquals(0, unknown.dirty.files)
            assertFalse(unknown.stats.incomplete)
        }
    }

    fun `test truncated or incomplete file counts project as a lower bound`() {
        val truncated = HostedWorkspaceChangesDto(ref, "captured", 1, "2026-11-18T00:00:00Z", true,
            listOf(comparison("origin/main", listOf(file("a", "against-base-branch", 1, 0))))).headerChanges()
        assertTrue(truncated.stats.incomplete)
        assertTrue(truncated.dirty.incomplete)
        assertFalse(truncated.stats.unavailable)

        val partial = captured(listOf(
            comparison("origin/main", listOf(file("a", "against-base-branch", 1, 0, complete = false))),
        )).headerChanges()
        assertTrue(partial.stats.incomplete)
        assertTrue(partial.dirty.incomplete)
        assertEquals(1, partial.stats.files)
    }

    private fun captured(comparisons: List<HostedWorkspaceChangeComparisonDto>) =
        HostedWorkspaceChangesDto(ref, "captured", 1, "2026-11-18T00:00:00Z", false, comparisons)

    private fun comparison(base: String, files: List<HostedWorkspaceChangeFileDto>) =
        HostedWorkspaceChangeComparisonDto(null, HostedWorkspaceComparisonDto(base, "a".repeat(40), "b".repeat(40)), false, files)

    private fun file(
        path: String,
        scope: String?,
        additions: Long,
        deletions: Long,
        tracked: Boolean = true,
        complete: Boolean = true,
    ) =
        HostedWorkspaceChangeFileDto(path, "modified", additions, deletions, tracked, false, complete, 1, null,
            HostedWorkspaceDiffAvailabilityDto("available"), HostedWorkspaceContentAvailabilityDto("available", "current"), scope)
}
