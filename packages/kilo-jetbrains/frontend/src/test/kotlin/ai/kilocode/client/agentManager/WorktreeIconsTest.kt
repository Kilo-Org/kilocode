package ai.kilocode.client.agentManager

import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SpinnerIcon
import ai.kilocode.client.ui.PrIcons
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.BadgeIcon
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

    fun `test pull request verdict glyphs are never tinted to the row text color`() {
        // neutral() drives tinting, which would flatten these to the label foreground and lose the
        // red/green/amber the whole indicator depends on.
        assertFalse(WorktreeIcons.neutral(PrIcons.reviewApproved))
        assertFalse(WorktreeIcons.neutral(PrIcons.reviewChanges))
        assertFalse(WorktreeIcons.neutral(PrIcons.checksPassed))
        assertFalse(WorktreeIcons.neutral(PrIcons.checksFailed))
        assertFalse(WorktreeIcons.neutral(PrIcons.checksRunning))
    }

    fun `test activity outranks the resting glyph on the local row`() {
        assertSame(
            WorktreeIcons.running,
            WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.RUNNING, current = true),
        )
    }

    fun `test a running process replaces the resting glyph with the platform live-run indicator`() {
        assertSame(WorktreeIcons.runIndicator, WorktreeIcons.forRow(busy = false, running = true))
        // Outranks both the local-checkout monitor and the locked glyph.
        assertSame(WorktreeIcons.runIndicator, WorktreeIcons.forRow(busy = false, current = true, running = true))
        assertSame(WorktreeIcons.runIndicator, WorktreeIcons.forRow(busy = false, locked = true, running = true))
    }

    fun `test a worktree operation outranks the live-run indicator entirely`() {
        assertSame(WorktreeIcons.spinner, WorktreeIcons.forRow(busy = true, running = true))
    }

    fun `test session activity keeps its own glyph and only wears the run badge`() {
        // The agent working, or waiting on an answer, still owns the slot; the badge is how a live
        // process stays visible behind it.
        for (kind in SessionActivityKind.entries) {
            val plain = WorktreeIcons.forRow(busy = false, kind = kind)
            val badged = WorktreeIcons.forRow(busy = false, kind = kind, running = true)
            assertSame("$kind lost its glyph to the run indicator", WorktreeIcons.live(plain), badged)
            assertSame("$kind should keep the same glyph underneath", plain, (badged as BadgeIcon).icon)
        }
    }

    fun `test a settled session returns to the plain run indicator`() {
        // Idle again but the process is still up: back to the standard running glyph, not a badged one.
        assertSame(WorktreeIcons.runIndicator, WorktreeIcons.forRow(busy = false, kind = null, running = true))
        // ...and to the plain activity glyph the moment the process exits.
        assertSame(
            SessionActivityKind.QUESTION.icon(),
            WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.QUESTION, running = false),
        )
    }

    fun `test badging is cached so rows keep a stable icon identity`() {
        // forRow runs on every list sync, so a fresh BadgeIcon per call would churn the row icon.
        assertSame(WorktreeIcons.live(WorktreeIcons.branch), WorktreeIcons.live(WorktreeIcons.branch))
        assertSame(
            WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.RUNNING, running = true),
            WorktreeIcons.forRow(busy = false, kind = SessionActivityKind.RUNNING, running = true),
        )
    }

    fun `test badging preserves the base icon size`() {
        for (base in listOf(WorktreeIcons.branch, WorktreeIcons.running, SessionActivityKind.QUESTION.icon())) {
            assertEquals(base.iconWidth, WorktreeIcons.live(base).iconWidth)
            assertEquals(base.iconHeight, WorktreeIcons.live(base).iconHeight)
        }
    }

    fun `test the live-run indicator is never tinted to the row text color`() {
        // Tinting would recolor the whole composite and flatten the green badge to the row foreground.
        assertFalse(WorktreeIcons.neutral(WorktreeIcons.runIndicator))
    }

    /**
     * The badge is a hole punched through the glyph, and HoledIcon sizes itself to the union of the two.
     * Default dot fractions are tuned for a 20px stripe icon and overhang a 16px base, which would widen
     * the row's icon column for running rows only, so the dot is pulled inside the canvas on purpose.
     */
    fun `test the live-run indicator fits the row icon slot`() {
        assertEquals(WorktreeIcons.branch.iconWidth, WorktreeIcons.runIndicator.iconWidth)
        assertEquals(WorktreeIcons.branch.iconHeight, WorktreeIcons.runIndicator.iconHeight)
        // The badge must not silently swallow the glyph either: it wraps the platform run triangle.
        assertSame(AllIcons.Toolwindows.ToolWindowRun, (WorktreeIcons.runIndicator as BadgeIcon).icon)
    }

    fun `test the live-run indicator wears the success badge in the top-right corner`() {
        val badge = WorktreeIcons.runIndicator as BadgeIcon
        assertEquals(JBUI.CurrentTheme.IconBadge.SUCCESS, badge.paint)

        // The hole is what HoledIcon unions into the icon size, so it is the shape that has to stay
        // inside the canvas for the row's icon column to keep its width.
        val size = WorktreeIcons.branch.iconWidth
        val hole = badge.provider.createShape(size, size, true)!!.bounds2D
        assertTrue("badge overhangs the right edge: $hole in $size", hole.maxX <= size)
        assertTrue("badge overhangs the top edge: $hole", hole.minY >= 0)
        // Top-right, not centered or bottom-right like the pre-New UI indicator.
        assertTrue("badge is not in the right half: $hole", hole.centerX > size / 2)
        assertTrue("badge is not in the top half: $hole", hole.centerY < size / 2)
    }
}
