package ai.kilocode.client.agentManager

import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SpinnerIcon
import ai.kilocode.client.ui.UiStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.ColorUtil
import com.intellij.util.ui.JBUI
import java.awt.Color

class WorktreeIconsTest : BasePlatformTestCase() {
    fun `test running session resolves to the animated spinner`() {
        assertSame(WorktreeIcons.running, WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.RUNNING))
    }

    fun `test running icon is animated and sized to the row icon`() {
        assertTrue(WorktreeIcons.running is AnimatedIcon)
        assertEquals(JBUI.scale(16), WorktreeIcons.running.iconWidth)
        assertEquals(JBUI.scale(16), WorktreeIcons.running.iconHeight)
    }

    fun `test resting row icons carry the muted palette in both themes`() {
        for (name in listOf("worktreeBranch", "worktreeLock", "worktree-local")) {
            // The tertiary New UI greys: a resting glyph only says what the checkout is, so it sits a
            // step quieter than the secondary grey the description line under it uses.
            val light = svg(name).replace("#A8ADBD", "GLYPH")
            val dark = svg("${name}_dark").replace("#9DA0A8", "GLYPH")

            assertFalse("$name still uses a primary grey", light.contains("#6C707E"))
            assertFalse("${name}_dark still uses a primary grey", dark.contains("#CED0D6"))
            assertFalse("$name still uses the secondary grey", light.contains("#818594"))
            assertFalse("${name}_dark still uses the secondary grey", dark.contains("#6F737A"))
            // Recoloring must be the only difference: the loader animates between the two.
            assertEquals("$name geometry drifted from its dark variant", light, dark)
        }
    }

    private fun svg(name: String): String {
        val stream = WorktreeIcons::class.java.getResourceAsStream("/icons/$name.svg")
        return checkNotNull(stream) { "missing /icons/$name.svg" }.use { it.readBytes().decodeToString() }
    }

    fun `test running spinner paints a neutral grey that carries contrast in both themes`() {
        assertEquals(UiStyle.Colors.running().rgb, SpinnerIcon.color().rgb)

        // Neutral: no channel pulls the grey towards a hue.
        assertTrue("light variant is not neutral", spread(UiStyle.Colors.runningLight) <= 24)
        assertTrue("dark variant is not neutral", spread(UiStyle.Colors.runningDark) <= 24)

        // Each variant stands out against the background its own theme paints behind the row.
        assertTrue("light variant is too pale", ColorUtil.isDark(UiStyle.Colors.runningLight))
        assertFalse("dark variant is too dim", ColorUtil.isDark(UiStyle.Colors.runningDark))
    }

    /** Distance between the strongest and weakest channel, i.e. how far the color is from pure grey. */
    private fun spread(color: Color): Int {
        val channels = listOf(color.red, color.green, color.blue)
        return channels.max() - channels.min()
    }

    fun `test busy outranks running and uses the platform spinner`() {
        assertSame(WorktreeIcons.spinner, WorktreeIcons.forRow(busy = true, kind = SessionActivityKind.RUNNING))
    }

    fun `test waiting kinds resolve to the attention glyph`() {
        assertSame(
            SessionActivityKind.QUESTION.icon(),
            WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.QUESTION),
        )
        assertSame(SessionActivityKind.PLAN.icon(), WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.PLAN))
    }

    fun `test rows at rest show what the checkout is`() {
        assertSame(WorktreeIcons.branch, WorktreeIcons.forRow(busy = false))
        assertSame(WorktreeIcons.locked, WorktreeIcons.forRow(busy = false, locked = true))
        assertSame(WorktreeIcons.local, WorktreeIcons.forRow(busy = false, current = true))
    }

    fun `test errored session shows the error glyph over the resting one`() {
        val error = SessionActivityKind.ERROR.icon()
        assertSame(error, WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.ERROR))
        assertSame(error, WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.ERROR, current = true))
        assertSame(error, WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.ERROR, locked = true))
        // An operation on the row still outranks it.
        assertSame(WorktreeIcons.spinner, WorktreeIcons.forRow(busy = true, kind = SessionActivityKind.ERROR))
    }

    fun `test activity outranks the resting glyph on the local row`() {
        assertSame(
            WorktreeIcons.running,
            WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.RUNNING, current = true),
        )
    }
}
