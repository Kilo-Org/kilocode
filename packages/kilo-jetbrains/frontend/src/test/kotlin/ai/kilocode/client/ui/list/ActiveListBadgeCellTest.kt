package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.UiStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBFont
import javax.swing.Icon

class ActiveListBadgeCellTest : BasePlatformTestCase() {
    private val glyph: Icon = EmptyIcon.create(16)
    private val other: Icon = EmptyIcon.create(12)

    fun `test a text badge renders the filled pill`() {
        val cell = ActiveListBadgeCell()

        cell.update(ActiveListBadge("#7", UiStyle.Badge.PullRequestOpen, id = "pull-request"))

        val pill = assertInstanceOf(cell.icon, FilledBadgeIcon::class.java)
        assertEquals("#7", pill.text)
        assertEquals("pull-request", cell.cellId)
    }

    fun `test an icon badge renders the glyph instead of a pill`() {
        val cell = ActiveListBadgeCell()

        cell.update(ActiveListBadge("", id = "pr-checks", icon = glyph))

        // The glyph replaces the pill rather than joining it, so a status icon is not boxed in a badge.
        assertSame(glyph, cell.icon)
        assertEquals("pr-checks", cell.cellId)
    }

    fun `test an unchanged badge keeps its icon instance`() {
        val cell = ActiveListBadgeCell()
        val badge = ActiveListBadge("#7", UiStyle.Badge.PullRequestOpen, id = "pull-request")
        cell.update(badge)
        val first = cell.icon

        cell.update(badge)

        // Retained rendering: a repaint of an unchanged row must not churn the label's icon.
        assertSame(first, cell.icon)
    }

    fun `test a changed glyph replaces the previous one`() {
        val cell = ActiveListBadgeCell()
        cell.update(ActiveListBadge("", id = "pr-checks", icon = glyph))

        cell.update(ActiveListBadge("", id = "pr-checks", icon = other))

        assertSame(other, cell.icon)
    }

    fun `test switching between a pill and a glyph swaps the icon both ways`() {
        val cell = ActiveListBadgeCell()

        cell.update(ActiveListBadge("#7", UiStyle.Badge.PullRequestOpen))
        assertInstanceOf(cell.icon, FilledBadgeIcon::class.java)

        // A row whose checks appear after the first paint has to pick the glyph up.
        cell.update(ActiveListBadge("", icon = glyph))
        assertSame(glyph, cell.icon)

        cell.update(ActiveListBadge("#8", UiStyle.Badge.PullRequestMerged))
        assertEquals("#8", assertInstanceOf(cell.icon, FilledBadgeIcon::class.java).text)
    }

    fun `test a labelled glyph renders the icon beside its count`() {
        val cell = ActiveListBadgeCell()

        cell.update(ActiveListBadge("3", id = "pr-comments", icon = glyph), UiStyle.Colors.weak())

        // Unlike a pill, whose text is painted inside the icon, a counted status keeps its number as real
        // label text so the glyph and the figure sit side by side.
        assertSame(glyph, cell.icon)
        assertEquals("3", cell.text)
        assertEquals(UiStyle.Colors.weak(), cell.foreground)
        // Font and gap match the ahead/behind counters in ChangesPanel: glyph and figure are one token, and
        // the default label gap pulls them apart into an icon with a caption.
        assertEquals(JBFont.small(), cell.font)
        assertEquals(UiStyle.Gap.xs(), cell.iconTextGap)
    }

    fun `test a bare glyph carries no label text`() {
        val cell = ActiveListBadgeCell()

        cell.update(ActiveListBadge("", id = "pr-checks", icon = glyph), UiStyle.Colors.weak())

        assertEquals("", cell.text)
    }

    fun `test a pill keeps its text inside the icon and off the label`() {
        val cell = ActiveListBadgeCell()

        cell.update(ActiveListBadge("#7", UiStyle.Badge.PullRequestOpen, id = "pull-request"), UiStyle.Colors.weak())

        // Doubling the text onto the label would print "#7" twice, once painted in the pill.
        assertEquals("", cell.text)
        assertEquals("#7", assertInstanceOf(cell.icon, FilledBadgeIcon::class.java).text)
    }

    fun `test a count that changed replaces the label without churning the glyph`() {
        val cell = ActiveListBadgeCell()
        cell.update(ActiveListBadge("3", id = "pr-comments", icon = glyph), UiStyle.Colors.weak())

        cell.update(ActiveListBadge("2", id = "pr-comments", icon = glyph), UiStyle.Colors.weak())

        assertEquals("2", cell.text)
        assertSame(glyph, cell.icon)
    }

    fun `test a labelled glyph that loses its count clears the label`() {
        val cell = ActiveListBadgeCell()
        cell.update(ActiveListBadge("3", id = "pr-comments", icon = glyph), UiStyle.Colors.weak())

        cell.update(ActiveListBadge("", id = "pr-checks", icon = other), UiStyle.Colors.weak())

        // The cells are recycled across rows, so a stale count must not survive onto a bare glyph.
        assertEquals("", cell.text)
        assertSame(other, cell.icon)
    }

    fun `test only a badge with an action is treated as clickable`() {
        val cell = ActiveListBadgeCell()

        cell.update(ActiveListBadge("", id = "pr-checks", icon = glyph))
        assertFalse(cell.cellEnabled())

        cell.update(ActiveListBadge("", id = "pr-checks", icon = glyph, action = {}))
        assertTrue(cell.cellEnabled())
    }
}
