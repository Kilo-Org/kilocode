package ai.kilocode.client.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.util.edtWait
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.util.text.StringUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBFont
import java.awt.Component
import java.awt.Container
import java.awt.Cursor
import java.awt.event.ActionEvent
import java.awt.event.KeyEvent
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage
import javax.accessibility.AccessibleRole
import javax.swing.JComponent
import javax.swing.JSeparator
import javax.swing.KeyStroke
import javax.swing.RepaintManager
import javax.swing.SwingUtilities

class ChangesPanelTest : BasePlatformTestCase() {
    fun `test compact renders only the shared base file and diff group`() = edt {
        val view = ChangesPanel(ChangesPanel.Mode.COMPACT)
        assertFalse(view.isVisible)

        view.update(3, 10, 7, ahead = 4, behind = 5, localFiles = 2, localAdditions = 9, localDeletions = 3, base = "origin/main")

        assertEquals(listOf("3 files", "-7", "+10"), labels(view))
        assertEquals(1, groups(view).size)
        assertEquals(1, components(view).filterIsInstance<DiffStatBadge>().size)
        // The row already prints the counts beside this tooltip, so it only says what a click does.
        assertEquals(KiloBundle.message("worktree.stats.tooltip.open"), view.toolTipText)
        assertEquals(view.toolTipText, groups(view).single().toolTipText)
    }

    fun `test full orders local separator ahead behind and base`() = edt {
        val view = ChangesPanel(ChangesPanel.Mode.FULL)
        view.update(3, 10, 7, ahead = 4, behind = 5, localFiles = 2, localAdditions = 9, localDeletions = 3, base = "origin/main")
        layout(view)

        assertEquals(listOf("2 files", "-3", "+9", "4", "5", "3 files", "-7", "+10"), labels(view))
        val row = view.components.single() as Container
        val order = row.components.toList()
        assertEquals(5, order.size)
        assertSame(groups(view).first(), order[0])
        assertTrue(order[1] is JSeparator)
        assertEquals("4", (order[2] as JBLabel).text)
        assertEquals("5", (order[3] as JBLabel).text)
        assertSame(groups(view).last(), order[4])
        assertTrue(order.zipWithNext().all { (left, right) -> left.x + left.width <= right.x })
        assertNull(view.toolTipText)
    }

    fun `test zero line files retain targets without empty stat pills`() = edt {
        val view = ChangesPanel(ChangesPanel.Mode.FULL, onBase = {}, onLocal = {})
        view.update(1, 0, 0, localFiles = 2)

        assertEquals(listOf("2 files", "1 file"), labels(view))
        assertTrue(groups(view).all { it.isVisible && it.isFocusable })
        assertTrue(components(view).filterIsInstance<DiffStatBadge>().all { !it.isVisible })
        assertTrue(separator(view).isVisible)
    }

    fun `test clean and missing data clear targets tooltips and separator`() = edt {
        val view = ChangesPanel(ChangesPanel.Mode.FULL, onBase = {}, onLocal = {})
        view.update(1, 2, 3, ahead = 4, behind = 5, localFiles = 6, localAdditions = 7, localDeletions = 8)
        view.update(0, 0, 0)

        assertFalse(view.isVisible)
        assertFalse(separator(view).isVisible)
        assertTrue(groups(view).all { !it.isVisible && !it.isFocusable && it.toolTipText == null })
        assertTrue(labels(view).isEmpty())

        val compact = ChangesPanel(ChangesPanel.Mode.COMPACT, onBase = {})
        compact.update(1, 2, 0)
        // A compact summary has no ahead/behind counters, so commits alone leave it with nothing to show.
        compact.update(0, 0, 0, ahead = 8)
        assertFalse(compact.isVisible)
        assertNull(compact.toolTipText)
    }

    fun `test compact stands uncommitted counts in for an empty committed set`() = edt {
        val view = ChangesPanel(ChangesPanel.Mode.COMPACT, onBase = {})

        view.update(0, 0, 0, ahead = 8, localFiles = 2, localAdditions = 9, localDeletions = 3, base = "origin/main")

        assertTrue(view.isVisible)
        assertEquals(listOf("2 files", "-3", "+9"), labels(view))
        assertEquals(KiloBundle.message("worktree.dirty.tooltip.open"), view.toolTipText)

        // One committed file outranks any amount of uncommitted work: it is the number a PR would show.
        view.update(1, 4, 0, localFiles = 2, localAdditions = 9, localDeletions = 3, base = "origin/main")
        assertEquals(listOf("1 file", "+4"), labels(view))
        assertEquals(KiloBundle.message("worktree.stats.tooltip.open"), view.toolTipText)
    }

    fun `test compact ignores uncommitted counts it is not showing`() = edt {
        val view = ChangesPanel(ChangesPanel.Mode.COMPACT, onBase = {})
        view.update(2, 1, 1)
        val previous = RepaintManager.currentManager(view)
        val tracker = Tracker(view)
        RepaintManager.setCurrentManager(tracker)
        try {
            repeat(100) { view.update(2, 1, 1, localFiles = it + 1, localAdditions = it, localDeletions = it) }
            assertEquals(0, tracker.invalidations)
            assertEquals(0, tracker.paints)
        } finally {
            RepaintManager.setCurrentManager(previous)
        }
        assertEquals(listOf("2 files", "-1", "+1"), labels(view))
    }

    fun `test ahead behind remain independent from file groups`() = edt {
        val view = ChangesPanel(ChangesPanel.Mode.FULL)
        view.update(0, 0, 0, ahead = 2)
        assertEquals(listOf("2"), labels(view))
        assertFalse(separator(view).isVisible)

        view.update(0, 0, 0, behind = 4, localFiles = 1)
        assertEquals(listOf("1 file", "4"), labels(view))
        assertTrue(separator(view).isVisible)

        view.update(0, 0, 0, localFiles = 1)
        assertEquals(listOf("1 file"), labels(view))
        assertFalse(separator(view).isVisible)

        view.update(1, 0, 0)
        assertEquals(listOf("1 file"), labels(view))
        assertFalse(separator(view).isVisible)
    }

    fun `test each side updates without stale counts or base tooltip`() = edt {
        val view = ChangesPanel(ChangesPanel.Mode.FULL)
        view.update(2, 5, 1, localFiles = 1, localAdditions = 2, base = "origin/main")
        val groups = groups(view)

        view.update(2, 5, 1, localFiles = 3, localDeletions = 4, base = "origin/main")
        assertEquals(listOf("3 files", "-4", "2 files", "-1", "+5"), labels(view))
        assertEquals(KiloBundle.message("worktree.dirty.tooltip", 3, 0, 4), groups.first().toolTipText)

        view.update(2, 5, 1, localFiles = 3, localDeletions = 4, base = "origin/trunk")
        assertEquals(KiloBundle.message("worktree.stats.base.tooltip", 2, 5, 1, "origin/trunk"), groups.last().toolTipText)
        assertEquals(groups, groups(view))
    }

    fun `test mouse children whitespace keyboard and accessibility activate once`() = edt {
        var base = 0
        var local = 0
        val view = ChangesPanel(ChangesPanel.Mode.FULL, onBase = { base++ }, onLocal = { local++ })
        view.update(2, 3, 1, localFiles = 1, localAdditions = 4)
        layout(view)
        val groups = groups(view)
        val left = groups.first()
        val right = groups.last()
        val targets = visible(right).filterIsInstance<JComponent>()
        targets.forEach { click(it) }
        assertEquals(targets.size, base)
        assertEquals(0, local)

        click(left)
        click(visible(left).filterIsInstance<JBLabel>().first())
        key(left, KeyEvent.VK_ENTER)
        key(left, KeyEvent.VK_SPACE)
        assertEquals(4, local)
        assertTrue(right.accessibleContext.accessibleAction.doAccessibleAction(0))
        assertFalse(right.accessibleContext.accessibleAction.doAccessibleAction(1))
        assertEquals(targets.size + 1, base)
        assertEquals(StringUtil.stripHtml(right.toolTipText, " "), right.accessibleContext.accessibleName)
        assertEquals(AccessibleRole.PUSH_BUTTON, right.accessibleContext.accessibleRole)

        val compact = ChangesPanel(ChangesPanel.Mode.COMPACT, onBase = { base++ })
        compact.update(1, 0, 0)
        layout(compact)
        click(compact)
        assertEquals(targets.size + 2, base)
    }

    fun `test disabled missing action and nonprimary clicks do not activate`() = edt {
        var calls = 0
        val view = ChangesPanel(ChangesPanel.Mode.COMPACT, onBase = { calls++ })
        view.update(1, 2, 3)
        layout(view)
        val group = groups(view).single()
        val child = visible(group).filterIsInstance<JBLabel>().first()
        click(child, button = MouseEvent.BUTTON3)
        click(child, count = 2)
        click(child, consumed = true)
        child.isEnabled = false
        click(child)
        child.isEnabled = true
        group.isEnabled = false
        click(child)
        key(group, KeyEvent.VK_ENTER)
        assertEquals(Cursor.DEFAULT_CURSOR, group.cursor.type)
        group.isEnabled = true
        view.isEnabled = false
        click(child)
        key(group, KeyEvent.VK_SPACE)
        assertFalse(group.accessibleContext.accessibleAction.doAccessibleAction(0))
        assertFalse(group.isFocusable)
        assertEquals(Cursor.DEFAULT_CURSOR, child.cursor.type)
        view.isEnabled = true
        view.setActions(null)
        click(child)
        key(group, KeyEvent.VK_ENTER)
        assertFalse(group.isFocusable)
        assertEquals(0, group.accessibleContext.accessibleAction.accessibleActionCount)
        assertEquals(0, calls)
        view.setActions({ calls++ })
        click(child)
        assertEquals(1, calls)
    }

    fun `test equal aggregate updates still use rebound actions`() = edt {
        val calls = mutableListOf<String>()
        val view = ChangesPanel(ChangesPanel.Mode.FULL, onBase = { calls += "old base" }, onLocal = { calls += "old local" })
        view.update(1, 0, 0, localFiles = 1)
        view.setActions({ calls += "base" }, { calls += "local" })
        view.update(1, 0, 0, localFiles = 1)
        layout(view)
        groups(view).forEach { click(it) }
        assertEquals(listOf("local", "base"), calls)
    }

    fun `test child hover paints group and disabled or inert groups do not hover`() = edt {
        val view = ChangesPanel(ChangesPanel.Mode.COMPACT, onBase = {})
        view.update(1, 0, 0)
        layout(view)
        val group = groups(view).single()
        val child = visible(group).filterIsInstance<JBLabel>().first()
        val plain = pixels(group)
        child.dispatchEvent(MouseEvent(child, MouseEvent.MOUSE_ENTERED, 0, 0, 1, 1, 0, false))
        assertFalse(plain.contentEquals(pixels(group)))
        group.dispatchEvent(MouseEvent(group, MouseEvent.MOUSE_EXITED, 0, 0, -1, -1, 0, false))
        assertTrue(plain.contentEquals(pixels(group)))
        view.setActions(null)
        child.dispatchEvent(MouseEvent(child, MouseEvent.MOUSE_ENTERED, 0, 0, 1, 1, 0, false))
        assertTrue(plain.contentEquals(pixels(group)))
    }

    fun `test identical data actions and fonts do not repaint or invalidate`() = edt {
        val view = ChangesPanel(ChangesPanel.Mode.COMPACT, onBase = {})
        view.update(1, 2, 3)
        val previous = RepaintManager.currentManager(view)
        val tracker = Tracker(view)
        RepaintManager.setCurrentManager(tracker)
        try {
            repeat(100) {
                view.update(1, 2, 3, localFiles = it, ahead = it)
                view.setActions({})
                view.font = view.font
            }
            assertEquals(0, tracker.invalidations)
            assertEquals(0, tracker.paints)
        } finally {
            RepaintManager.setCurrentManager(previous)
        }
    }

    fun `test host styling preserves semantic diff colors and retained nodes through UI refresh`() = edt {
        val view = ChangesPanel(ChangesPanel.Mode.FULL)
        view.update(2, 3, 4, ahead = 1, localFiles = 1, localAdditions = 5)
        val nodes = components(view)
        val stats = nodes.filterIsInstance<DiffStatBadge>().flatMap(::components).filterIsInstance<JBLabel>()
        val colors = stats.map { it.foreground }
        val font = JBFont.small().asBold()
        val color = UiStyle.Colors.fg()
        view.font = font
        view.foreground = color
        SwingUtilities.updateComponentTreeUI(view)
        assertEquals(nodes, components(view))
        assertTrue(nodes.filterIsInstance<JBLabel>().all { it.font == font })
        assertTrue(nodes.filterIsInstance<JBLabel>().filter { it !in stats }.all { it.foreground == color })
        assertEquals(colors, stats.map { it.foreground })
    }

    fun `test retained groups fonts listeners and editor resources stay bounded under churn`() = edt {
        val baseline = EditorFactory.getInstance().allEditors.size
        val view = ChangesPanel(ChangesPanel.Mode.FULL, onBase = {}, onLocal = {})
        view.update(1, 2, 3, localFiles = 1, localAdditions = 2)
        val nodes = components(view)
        val listeners = nodes.map { it.mouseListeners.size }
        val font = JBFont.small().asBold()
        view.font = font
        repeat(500) { n ->
            view.setActions({}, {})
            view.update(n % 5, n % 11, n % 7, n % 3, n % 2, n % 4, n % 13, n % 17, "origin/main")
            view.update(0, 0, 0)
        }
        view.update(1, 2, 3, localFiles = 1, localAdditions = 2)
        assertEquals(nodes, components(view))
        assertEquals(listeners, nodes.map { it.mouseListeners.size })
        assertTrue(nodes.filterIsInstance<JBLabel>().all { it.font == font })
        assertEquals(baseline, EditorFactory.getInstance().allEditors.size)
    }

    @RequiresEdt
    private fun components(root: Component): List<Component> =
        listOf(root) + if (root is Container) root.components.flatMap(::components) else emptyList()

    @RequiresEdt
    private fun visible(root: Component): List<Component> =
        if (!root.isVisible) emptyList() else listOf(root) + if (root is Container) root.components.flatMap(::visible) else emptyList()

    @RequiresEdt
    private fun labels(root: Component): List<String> = visible(root).filterIsInstance<JBLabel>().mapNotNull { it.text }

    @RequiresEdt
    private fun groups(view: ChangesPanel): List<JComponent> = components(view).filterIsInstance<JComponent>()
        .filter { it.accessibleContext?.accessibleRole == AccessibleRole.PUSH_BUTTON }

    @RequiresEdt
    private fun separator(view: ChangesPanel): JSeparator = components(view).filterIsInstance<JSeparator>().single()

    @RequiresEdt
    private fun layout(view: ChangesPanel) {
        view.setSize(view.preferredSize)
        fun lay(component: Component) {
            component.doLayout()
            if (component is Container) component.components.forEach(::lay)
        }
        lay(view)
    }

    @RequiresEdt
    private fun click(target: JComponent, button: Int = MouseEvent.BUTTON1, count: Int = 1, consumed: Boolean = false) {
        listOf(MouseEvent.MOUSE_PRESSED, MouseEvent.MOUSE_RELEASED, MouseEvent.MOUSE_CLICKED).forEach { id ->
            val event = MouseEvent(target, id, 0, 0, target.width / 2, target.height / 2, count, false, button)
            if (consumed) event.consume()
            target.dispatchEvent(event)
        }
    }

    @RequiresEdt
    private fun key(target: JComponent, key: Int) {
        target.getActionForKeyStroke(KeyStroke.getKeyStroke(key, 0))!!.actionPerformed(ActionEvent(target, ActionEvent.ACTION_PERFORMED, ""))
    }

    @RequiresEdt
    private fun pixels(target: JComponent): IntArray {
        val image = BufferedImage(target.width, target.height, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        try {
            target.paint(graphics)
        } finally {
            graphics.dispose()
        }
        return image.getRGB(0, 0, image.width, image.height, null, 0, image.width)
    }

    private class Tracker(private val root: JComponent) : RepaintManager() {
        var invalidations = 0
        var paints = 0

        @RequiresEdt
        override fun addInvalidComponent(component: JComponent) {
            if (SwingUtilities.isDescendingFrom(component, root)) invalidations++
            super.addInvalidComponent(component)
        }

        @RequiresEdt
        override fun addDirtyRegion(component: JComponent, x: Int, y: Int, width: Int, height: Int) {
            if (SwingUtilities.isDescendingFrom(component, root)) paints++
            super.addDirtyRegion(component, x, y, width, height)
        }
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
