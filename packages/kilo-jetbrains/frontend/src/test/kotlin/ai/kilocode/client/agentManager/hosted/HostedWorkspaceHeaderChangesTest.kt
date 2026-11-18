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
        )).headerChanges()!!

        assertEquals(Int.MAX_VALUE, changes.stats.additions)
        assertEquals(6, changes.stats.deletions)
        assertEquals(2, changes.stats.files)
        assertEquals("origin/main", changes.stats.base)
        assertEquals(7, changes.dirty.additions)
        assertEquals(3, changes.dirty.deletions)
        assertEquals(1, changes.dirty.files)
        assertEquals(1, changes.dirty.untracked)
    }

    fun `test multiple bases avoid a misleading label and unavailable snapshots stay absent`() {
        val mixed = captured(listOf(
            comparison("main", listOf(file("a", "against-base-branch", 1, 0))),
            comparison("develop", listOf(file("b", "against-base-branch", 1, 0))),
        )).headerChanges()!!
        assertEquals("", mixed.stats.base)
        assertNull(HostedWorkspaceChangesDto(ref, "not_captured", null, null, false, null).headerChanges())
        assertNull(HostedWorkspaceChangesDto(ref, "inconsistent", null, null, false, null).headerChanges())
    }

    private fun captured(comparisons: List<HostedWorkspaceChangeComparisonDto>) =
        HostedWorkspaceChangesDto(ref, "captured", 1, "2026-11-18T00:00:00Z", false, comparisons)

    private fun comparison(base: String, files: List<HostedWorkspaceChangeFileDto>) =
        HostedWorkspaceChangeComparisonDto(null, HostedWorkspaceComparisonDto(base, "a".repeat(40), "b".repeat(40)), false, files)

    private fun file(path: String, scope: String?, additions: Long, deletions: Long, tracked: Boolean = true) =
        HostedWorkspaceChangeFileDto(path, "modified", additions, deletions, tracked, false, true, 1, null,
            HostedWorkspaceDiffAvailabilityDto("available"), HostedWorkspaceContentAvailabilityDto("available", "current"), scope)
}
