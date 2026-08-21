package ai.kilocode.client.agentManager

import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.session.SessionActivityKind
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.AnimatedIcon
import com.intellij.util.ui.JBUI

class WorktreeIconsTest : BasePlatformTestCase() {
    fun `test running session resolves to the animated spinner`() {
        assertSame(WorktreeIcons.running, WorktreeIcons.forRow(pending = false, kind = SessionActivityKind.RUNNING))
    }

    fun `test running icon is animated and sized to the row icon`() {
        assertTrue(WorktreeIcons.running is AnimatedIcon)
        assertEquals(JBUI.scale(16), WorktreeIcons.running.iconWidth)
        assertEquals(JBUI.scale(16), WorktreeIcons.running.iconHeight)
    }

    fun `test pending outranks running and uses the platform spinner`() {
        assertSame(WorktreeIcons.spinner, WorktreeIcons.forRow(pending = true, kind = SessionActivityKind.RUNNING))
    }

    fun `test waiting kinds resolve to the attention glyph`() {
        assertSame(
            SessionActivityKind.QUESTION.icon(),
            WorktreeIcons.forRow(pending = false, kind = SessionActivityKind.QUESTION),
        )
        assertSame(SessionActivityKind.PLAN.icon(), WorktreeIcons.forRow(pending = false, kind = SessionActivityKind.PLAN))
    }

    fun `test rows at rest show what the checkout is`() {
        assertSame(WorktreeIcons.branch, WorktreeIcons.forRow(pending = false))
        assertSame(WorktreeIcons.locked, WorktreeIcons.forRow(pending = false, locked = true))
        assertSame(WorktreeIcons.local, WorktreeIcons.forRow(pending = false, current = true))
    }

    fun `test errored session falls back to the resting glyph`() {
        assertSame(WorktreeIcons.branch, WorktreeIcons.forRow(pending = false, kind = SessionActivityKind.ERROR))
        assertSame(
            WorktreeIcons.local,
            WorktreeIcons.forRow(pending = false, kind = SessionActivityKind.ERROR, current = true),
        )
    }

    fun `test activity outranks the resting glyph on the local row`() {
        assertSame(
            WorktreeIcons.running,
            WorktreeIcons.forRow(pending = false, kind = SessionActivityKind.RUNNING, current = true),
        )
    }
}
