package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Regression coverage for the [WorktreeStatsView] memo key: the dirty badge lives on the same
 * render stamp as the committed-diff badge, so a change confined to the dirty counts must still
 * bust [WorktreeStatsView]'s `state == next` early return in `sync()`.
 */
class WorktreeStatsViewTest : BasePlatformTestCase() {
    fun `test dirty badge updates when only dirty counts change`() {
        val view = edt { WorktreeStatsView() }
        val stats = WorktreeStatsDto("/repo", additions = 5, deletions = 1)

        edt { view.update(stats, dirtyAdd = 1, dirtyDel = 0, dirtyFiles = 1) }
        assertTrue(edt { view.dirtyHitForTest().isVisible })
        assertEquals("+1", edt { view.dirtyBadgeForTest().addedLabelForTest().text })

        // Same stats DTO, different dirty counts: the State memo key must not skip this update.
        edt { view.update(stats, dirtyAdd = 3, dirtyDel = 2, dirtyFiles = 2) }

        assertTrue(edt { view.dirtyHitForTest().isVisible })
        assertEquals("+3", edt { view.dirtyBadgeForTest().addedLabelForTest().text })
        assertEquals("-2", edt { view.dirtyBadgeForTest().removedLabelForTest().text })
    }

    fun `test dirty badge hides when there are no uncommitted changes`() {
        val view = edt { WorktreeStatsView() }
        val stats = WorktreeStatsDto("/repo", additions = 5, deletions = 1)

        edt { view.update(stats, dirtyAdd = 2, dirtyDel = 0, dirtyFiles = 1) }
        assertTrue(edt { view.dirtyHitForTest().isVisible })

        edt { view.update(stats, dirtyAdd = 0, dirtyDel = 0, dirtyFiles = 0) }
        assertFalse(edt { view.dirtyHitForTest().isVisible })
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
