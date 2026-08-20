package ai.kilocode.client.agentManager

import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.session.SessionActivityKind
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.AnimatedIcon
import com.intellij.util.ui.JBUI

class WorktreeIconsTest : BasePlatformTestCase() {
    fun `test running session resolves to the animated spinner`() {
        assertSame(WorktreeIcons.running, WorktreeIcons.forRow(locked = false, pending = false, kind = SessionActivityKind.RUNNING))
    }

    fun `test running icon is animated and sized to the row icon`() {
        assertTrue(WorktreeIcons.running is AnimatedIcon)
        assertEquals(JBUI.scale(16), WorktreeIcons.running.iconWidth)
        assertEquals(JBUI.scale(16), WorktreeIcons.running.iconHeight)
    }

    fun `test pending outranks running and uses the platform spinner`() {
        assertSame(WorktreeIcons.spinner, WorktreeIcons.forRow(locked = false, pending = true, kind = SessionActivityKind.RUNNING))
    }

    fun `test non-running kinds keep the activity badge`() {
        val error = WorktreeIcons.forRow(locked = false, pending = false, kind = SessionActivityKind.ERROR)
        assertSame(SessionActivityKind.ERROR.icon(), error)
        assertNotSame(WorktreeIcons.running, error)
    }

    fun `test locked and plain rows keep their static icons`() {
        assertSame(WorktreeIcons.locked, WorktreeIcons.forRow(locked = true, pending = false, kind = null))
        assertSame(WorktreeIcons.branch, WorktreeIcons.forRow(locked = false, pending = false, kind = null))
    }
}
