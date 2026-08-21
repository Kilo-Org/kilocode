package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.RunConfigDto
import ai.kilocode.rpc.dto.RunProcessState
import ai.kilocode.rpc.dto.RunStateDto
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUiKind
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Separator
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class WorktreeRunPopupTest : BasePlatformTestCase() {
    fun testEmptyConfigsShowDisabledRowAndFrameAction() {
        val group = WorktreeRunPopup.group(emptyList(), null, emptyList(), {}, {}, {}, {})
        val rows = group.getChildren(null)
        assertEquals(3, rows.size)
        assertEquals(KiloBundle.message("worktree.run.empty"), rows[0].templateText)
        assertFalse(enabled(rows[0]))
        assertTrue(rows[1] is Separator)
        assertEquals(KiloBundle.message("worktree.run.open.frame"), rows[2].templateText)
    }

    fun testErrorReplacesEmptyText() {
        val group = WorktreeRunPopup.group(emptyList(), "backend unavailable", emptyList(), {}, {}, {}, {})
        assertEquals("backend unavailable", group.getChildren(null)[0].templateText)
        assertFalse(enabled(group.getChildren(null)[0]))
    }

    fun testRunningSectionRowsAndCallbacks() {
        val cfg = RunConfigDto("id1", "dev", "Gradle")
        val idle = RunConfigDto("id2", "worker", "Shell Script")
        val state = RunStateDto("id1", "dev [wt]", "/wt", RunProcessState.RUNNING)
        val runs = mutableListOf<RunConfigDto>()
        val stops = mutableListOf<RunStateDto>()
        val outs = mutableListOf<RunStateDto>()
        var frames = 0
        val group = WorktreeRunPopup.group(
            listOf(cfg, idle),
            null,
            listOf(state),
            run = { runs += it },
            stop = { stops += it },
            output = { outs += it },
            frame = { frames++ },
        )
        val rows = group.getChildren(null)
        // separator(Running), stop, output, separator(Start), cfg, idle, separator, frame
        assertEquals(8, rows.size)
        assertTrue(rows[0] is Separator)
        assertEquals(KiloBundle.message("worktree.run.section.running"), (rows[0] as Separator).text)
        assertEquals(KiloBundle.message("worktree.run.stop", "dev [wt]"), rows[1].templateText)
        assertTrue(enabled(rows[1]))
        assertEquals(KiloBundle.message("worktree.run.output", "dev [wt]"), rows[2].templateText)
        assertEquals(KiloBundle.message("worktree.run.section.start"), (rows[3] as Separator).text)
        assertEquals("dev", rows[4].templateText)
        assertEquals("worker", rows[5].templateText)
        assertTrue(rows[6] is Separator)
        assertEquals(KiloBundle.message("worktree.run.open.frame"), rows[7].templateText)

        perform(rows[1])
        assertEquals(listOf(state), stops)
        perform(rows[2])
        assertEquals(listOf(state), outs)
        perform(rows[4])
        assertEquals(listOf(cfg), runs)
        perform(rows[7])
        assertEquals(1, frames)
    }

    fun testStoppingDisablesStopRow() {
        val cfg = RunConfigDto("id1", "dev", "Gradle")
        val state = RunStateDto("id1", "dev [wt]", "/wt", RunProcessState.STOPPING)
        val group = WorktreeRunPopup.group(listOf(cfg), null, listOf(state), {}, {}, {}, {})
        val rows = group.getChildren(null)
        assertFalse(enabled(rows[1]))
        assertEquals(KiloBundle.message("worktree.run.output", "dev [wt]"), rows[2].templateText)
        assertTrue(enabled(rows[2]))
    }

    private fun event(action: AnAction): AnActionEvent =
        AnActionEvent.createEvent(action, DataContext.EMPTY_CONTEXT, null, ActionPlaces.UNKNOWN, ActionUiKind.NONE, null)

    private fun enabled(action: AnAction): Boolean {
        val e = event(action)
        action.update(e)
        return e.presentation.isEnabled
    }

    private fun perform(action: AnAction) {
        action.actionPerformed(event(action))
    }
}
