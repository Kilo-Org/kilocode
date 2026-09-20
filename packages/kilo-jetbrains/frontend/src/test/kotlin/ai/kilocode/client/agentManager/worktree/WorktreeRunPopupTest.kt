package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.RunConfigDto
import ai.kilocode.rpc.dto.RunProcessState
import ai.kilocode.rpc.dto.RunStateDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUiKind
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Separator
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class WorktreeRunPopupTest : BasePlatformTestCase() {
    fun testEmptyConfigsShowDisabledRowAndFrameAction() {
        val group = WorktreeRunPopup.group(emptyList(), null, emptyList(), {}, {}, {}, {}, false, {})
        val rows = group.getChildren(null)
        assertEquals(3, rows.size)
        assertEquals(KiloBundle.message("worktree.run.empty"), rows[0].templateText)
        assertFalse(enabled(rows[0]))
        assertTrue(rows[1] is Separator)
        assertEquals(KiloBundle.message("worktree.run.open.frame"), rows[2].templateText)
    }

    fun testErrorReplacesEmptyText() {
        val group = WorktreeRunPopup.group(emptyList(), "backend unavailable", emptyList(), {}, {}, {}, {}, false, {})
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
            buildable = false,
            build = {},
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

        // A started row is the same green run glyph as the idle rows below it, wearing the shared live
        // badge — not the neutral triangle the worktree list uses, and not a second badge built here.
        assertSame(WorktreeIcons.live(AllIcons.Actions.Execute), rows[4].templatePresentation.icon)
        assertSame(AllIcons.Actions.Execute, rows[5].templatePresentation.icon)

        perform(rows[1])
        assertEquals(listOf(state), stops)
        perform(rows[2])
        assertEquals(listOf(state), outs)
        perform(rows[4])
        assertEquals(listOf(cfg), runs)
        perform(rows[7])
        assertEquals(1, frames)
    }

    fun testStoppingDisablesStopRowForUnkillableProcess() {
        // Gradle/external-system runs cannot be force-killed, so the row offers nothing more.
        val cfg = RunConfigDto("id1", "dev", "Gradle")
        val state = RunStateDto("id1", "dev [wt]", "/wt", RunProcessState.STOPPING)
        val group = WorktreeRunPopup.group(listOf(cfg), null, listOf(state), {}, {}, {}, {}, false, {})
        val rows = group.getChildren(null)
        assertEquals(KiloBundle.message("worktree.run.kill", "dev [wt]"), rows[1].templateText)
        assertFalse(enabled(rows[1]))
        assertEquals(KiloBundle.message("worktree.run.output", "dev [wt]"), rows[2].templateText)
        assertTrue(enabled(rows[2]))
    }

    fun testBuildRowsFollowConfigsAndPrecedeOpenFrame() {
        val cfg = RunConfigDto("id1", "dev", "Gradle")
        val cleans = mutableListOf<Boolean>()
        val group = WorktreeRunPopup.group(
            configs = listOf(cfg),
            error = null,
            states = emptyList(),
            run = {},
            stop = {},
            output = {},
            frame = {},
            buildable = true,
            build = { cleans += it },
        )
        val rows = group.getChildren(null)

        assertEquals(
            listOf("dev", "---", "Build", "Rebuild", "---", KiloBundle.message("worktree.run.open.frame")),
            layout(rows),
        )

        perform(rows[2])
        perform(rows[3])
        assertEquals(listOf(false, true), cleans)
    }

    fun testBuildRowsAreAbsentWhenProjectIsNotBuildable() {
        val cfg = RunConfigDto("id1", "dev", "Gradle")
        val group = WorktreeRunPopup.group(listOf(cfg), null, emptyList(), {}, {}, {}, {}, false, {})

        assertEquals(
            listOf("dev", "---", KiloBundle.message("worktree.run.open.frame")),
            layout(group.getChildren(null)),
        )
    }

    /** Row labels in order, with unlabeled separators as `---`, so ordering is asserted directly. */
    private fun layout(rows: Array<AnAction>): List<String> =
        rows.map { if (it is Separator) it.text ?: "---" else it.templateText.orEmpty() }

    fun testDelegatedConfigDescribesItsBuildSystem() {
        val direct = RunConfigDto("id1", "dev", "Gradle")
        val delegated = RunConfigDto("id2", "HvApiGatewayApp", "Spring Boot", via = "Gradle")
        val group = WorktreeRunPopup.group(listOf(direct, delegated), null, emptyList(), {}, {}, {}, {}, false, {})
        val rows = group.getChildren(null)

        assertEquals("Gradle", description(rows[0]))
        assertEquals(KiloBundle.message("worktree.run.via", "Spring Boot", "Gradle"), description(rows[1]))
    }

    fun testOrphanRowOffersKillWithoutAnOutputRow() {
        // The Run tab is already gone for an orphan, so there is no console to show — only Kill.
        val cfg = RunConfigDto("id1", "HvApiGatewayApp", "Spring Boot", via = "Gradle")
        val state = RunStateDto("id1", "app [wt]", "/wt", RunProcessState.STOPPING, killable = true, orphan = true)
        val stops = mutableListOf<RunStateDto>()
        val group = WorktreeRunPopup.group(listOf(cfg), null, listOf(state), {}, { stops += it }, {}, {}, false, {})
        val rows = group.getChildren(null)

        assertEquals(
            listOf(
                KiloBundle.message("worktree.run.section.running"),
                KiloBundle.message("worktree.run.kill", "app [wt]"),
                KiloBundle.message("worktree.run.section.start"),
                "HvApiGatewayApp",
                "---",
                KiloBundle.message("worktree.run.open.frame"),
            ),
            layout(rows),
        )
        assertTrue(enabled(rows[1]))

        perform(rows[1])
        assertEquals(listOf(state), stops)
    }

    fun testStoppingOffersKillForKillableProcess() {
        val cfg = RunConfigDto("id1", "dev", "Shell Script")
        val state = RunStateDto("id1", "dev [wt]", "/wt", RunProcessState.STOPPING, killable = true)
        val stops = mutableListOf<RunStateDto>()
        val group = WorktreeRunPopup.group(listOf(cfg), null, listOf(state), {}, { stops += it }, {}, {}, false, {})
        val rows = group.getChildren(null)

        assertEquals(KiloBundle.message("worktree.run.kill", "dev [wt]"), rows[1].templateText)
        assertTrue(enabled(rows[1]))

        // Kill reuses the stop call: the backend escalates because the process is already terminating.
        perform(rows[1])
        assertEquals(listOf(state), stops)
    }

    private fun event(action: AnAction): AnActionEvent =
        AnActionEvent.createEvent(action, DataContext.EMPTY_CONTEXT, null, ActionPlaces.UNKNOWN, ActionUiKind.NONE, null)

    private fun enabled(action: AnAction): Boolean {
        val e = event(action)
        action.update(e)
        return e.presentation.isEnabled
    }

    private fun description(action: AnAction): String? = action.templatePresentation.description

    private fun perform(action: AnAction) {
        action.actionPerformed(event(action))
    }
}
