package ai.kilocode.client.ui.tree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveMove
import ai.kilocode.client.ui.active.ActiveReorder
import ai.kilocode.client.ui.active.activeLayout
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUiKind
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.ToggleAction
import com.intellij.openapi.actionSystem.Toggleable
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.ListPopupStep
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.JBColor
import com.intellij.ui.scale.JBUIScale
import com.intellij.ui.tree.ui.DefaultTreeUI
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Point
import java.awt.Rectangle
import java.awt.image.BufferedImage
import javax.swing.Icon
import javax.swing.JPanel
import javax.swing.UIManager
import javax.swing.tree.TreePath

@Suppress("UnstableApiUsage")
class ActiveTreeColorTest : BasePlatformTestCase() {
    private val icons = linkedMapOf<String, Icon?>()

    private data class Row(override val key: String, override val description: String? = null) : ActiveItem {
        override val title = key
    }

    @RequiresEdt
    override fun setUp() {
        super.setUp()
        // DefaultControl paints with a null component, which Metal's collapsed icon cannot handle.
        mapOf(
            "Tree.expandedIcon" to AllIcons.Toolbar.Expand,
            "Tree.collapsedIcon" to AllIcons.Actions.ArrowExpand,
            "Tree.expandedSelectedIcon" to AllIcons.Toolbar.Expand,
            "Tree.collapsedSelectedIcon" to AllIcons.Actions.ArrowExpand,
        ).forEach { (key, icon) ->
            icons[key] = UIManager.getIcon(key)
            UIManager.put(key, icon)
        }
    }

    @RequiresEdt
    override fun tearDown() {
        try {
            super.tearDown()
        } finally {
            icons.forEach { (key, icon) -> UIManager.put(key, icon) }
        }
    }

    fun `test default branches stay uncolored and leaf colors do not change any pixels`() {
        val leaf = ActiveTreeNode(Row("leaf"))
        val section = ActiveTreeNode(Row("section"), listOf(leaf))
        val empty = ActiveTreeNode(Row("empty"), emptyList())
        val outside = ActiveTreeNode(Row("outside"))
        val tree = ActiveTree("")
        tree.update(listOf(section, empty, outside))
        val view = attach(tree)
        val before = paint(view)
        view.hierarchy.entries.values.forEach { assertNull(it.color) }
        for (key in listOf("section", "leaf")) {
            solid(before, rail(view, "section", key), view.background)
        }
        solid(before, rail(view, "empty"), view.background)

        tree.update(listOf(
            section.copy(children = listOf(leaf.copy(color = UiStyle.Colors.sections.getValue("red")))),
            empty,
            outside.copy(color = UiStyle.Colors.sections.getValue("blue")),
        ))

        unchanged(before, paint(view))
    }

    fun `test expanded nested collapsed and empty sections paint only their visible native row rails`() {
        val nested = ActiveTreeNode(Row("nested"), listOf(ActiveTreeNode(Row("deep"))))
        val child = ActiveTreeNode(Row("child", "A taller native leaf row"))
        val section = ActiveTreeNode(Row("section"), listOf(child, nested))
        val empty = ActiveTreeNode(Row("empty"), emptyList())
        val before = ActiveTreeNode(Row("before"))
        val after = ActiveTreeNode(Row("after"))
        val nodes = listOf(before, section, empty, after)
        val red = UiStyle.Colors.sections.getValue("red")
        val blue = UiStyle.Colors.sections.getValue("blue")
        val green = UiStyle.Colors.sections.getValue("green")
        val colored = listOf(before, section.copy(
            color = red,
            children = listOf(child, nested.copy(color = blue)),
        ), empty.copy(color = green), after)
        val tree = ActiveTree("")
        tree.update(nodes)
        val view = attach(tree)
        assertTrue(row(view, "child").height > row(view, "section").height)
        val plain = paint(view)

        tree.update(colored)

        val image = paint(view)
        val outer = listOf("section", "child", "nested", "deep").map { rail(view, "section", it) }
        val inner = listOf("nested", "deep").map { rail(view, "nested", it) }
        outer.forEach { solid(image, it, red) }
        inner.forEach { solid(image, it, blue) }
        solid(image, rail(view, "empty"), green)
        unchanged(plain, image, outer + inner + rail(view, "empty"))

        val path = TreePath(view.hierarchy.entries.getValue("section").path)
        view.collapsePath(path)
        tree.update(nodes)
        val collapsed = paint(view)
        tree.update(colored)
        assertFalse(view.isExpanded(path))
        assertEquals(-1, view.getRowForPath(TreePath(view.hierarchy.entries.getValue("child").path)))
        val compact = paint(view)
        solid(compact, rail(view, "section"), red)
        solid(compact, rail(view, "empty"), green)
        unchanged(collapsed, compact, listOf(rail(view, "section"), rail(view, "empty")))
    }

    fun `test color only refresh retains entries selection and expansion and clears previous paint`() {
        val open = ActiveTreeNode(Row("open"), listOf(ActiveTreeNode(Row("selected"))))
        val closed = ActiveTreeNode(Row("closed"), listOf(ActiveTreeNode(Row("hidden"))))
        val nodes = listOf(open, closed)
        val tree = ActiveTree("")
        tree.update(nodes)
        val view = attach(tree)
        val entries = view.hierarchy.entries.toMap()
        val expanded = TreePath(entries.getValue("open").path)
        val collapsed = TreePath(entries.getValue("closed").path)
        view.collapsePath(collapsed)
        assertTrue(tree.select("selected", false))
        val plain = paint(view)

        for (keys in listOf("red" to "blue", "purple" to "green")) {
            val first = UiStyle.Colors.sections.getValue(keys.first)
            val second = UiStyle.Colors.sections.getValue(keys.second)
            tree.update(listOf(open.copy(color = first), closed.copy(color = second)))

            entries.forEach { (key, entry) -> assertSame(entry, view.hierarchy.entries.getValue(key)) }
            assertSame(entries.getValue("selected"), view.selectionPath.lastPathComponent)
            assertEquals(listOf("selected"), tree.selectedKeys())
            assertTrue(view.isExpanded(expanded))
            assertFalse(view.isExpanded(collapsed))
            val image = paint(view)
            val rails = listOf(rail(view, "open"), rail(view, "open", "selected"), rail(view, "closed"))
            solid(image, rails.first(), first)
            solid(image, rail(view, "open", "selected"), first)
            solid(image, rails.last(), second)
            unchanged(plain, image, rails)
        }

        tree.update(nodes)

        entries.forEach { (key, entry) -> assertSame(entry, view.hierarchy.entries.getValue(key)) }
        assertSame(entries.getValue("selected"), view.selectionPath.lastPathComponent)
        assertTrue(view.isExpanded(expanded))
        assertFalse(view.isExpanded(collapsed))
        view.hierarchy.entries.values.forEach { assertNull(it.color) }
        unchanged(plain, paint(view))
    }

    fun `test child rail only clip paints the ancestor even outside the child frame and header`() {
        val color = UiStyle.Colors.sections.getValue("cyan")
        val tree = ActiveTree("")
        tree.update(listOf(ActiveTreeNode(Row("section"), listOf(ActiveTreeNode(Row("child"))), color)))
        val view = attach(tree)
        val clip = rail(view, "section", "child")
        val child = requireNotNull(view.regions.frame(view.hierarchy.entries.getValue("child")))
        assertFalse("The clip must exclude the child frame", clip.intersects(child))
        assertFalse("The section header must be outside the clip", clip.intersects(row(view, "section")))

        val image = paint(view, clip)

        solid(image, clip, color)
        unchanged(paint(view, Rectangle()), image, listOf(clip))
    }

    fun `test rectangular section paint has tiny gaps without resizing rows or breaking the rail`() {
        val keys = listOf("Popup.Selection.arc", "Tree.Selection.arc", "Tree.selectionInactiveBackground")
        val previous = keys.associateWith(UIManager::get)
        val original = JBUIScale.scale(1f)
        try {
            UIManager.put("Tree.Selection.arc", 2)
            UIManager.put("Tree.selectionInactiveBackground", Color(0x626262))
            for (scale in listOf(1f, 2f)) {
                JBUIScale.setUserScaleFactorForTest(scale)
                for (arc in listOf(0, 5, 12)) {
                    UIManager.put("Popup.Selection.arc", arc)
                    val section = ActiveTreeNode(Row("section"), listOf(ActiveTreeNode(Row("child"))))
                    val tree = ActiveTree("")
                    tree.update(listOf(section, ActiveTreeNode(Row("outside"))))
                    val view = attach(tree)
                    val frame = requireNotNull(view.regions.frame(view.hierarchy.entries.getValue("section")))
                    val cell = view.regions.cell(view.hierarchy.entries.getValue("section"))
                    val size = view.preferredSize
                    tree.select("section")
                    val plain = paint(view)
                    val color = requireNotNull(ActiveTreeColors.color("cyan"))

                    tree.update(listOf(section.copy(color = color), ActiveTreeNode(Row("outside"))))

                    val image = paint(view)
                    val gap = UiStyle.Gap.xs()
                    assertEquals(color.rgb, image.getRGB(frame.x, frame.y + gap))
                    assertEquals(UIUtil.getTreeBackground(true, false).rgb,
                        image.getRGB(frame.x + gap, frame.y + gap))
                    solid(image, Rectangle(frame.x, frame.y, frame.width, gap), view.background)
                    solid(image, Rectangle(frame.x + gap, frame.y + frame.height - gap,
                        frame.width - gap, gap), view.background)
                    assertEquals(frame, view.regions.frame(view.hierarchy.entries.getValue("section")))
                    assertEquals(cell, view.regions.cell(view.hierarchy.entries.getValue("section")))
                    assertEquals(size, view.preferredSize)
                    val child = row(view, "child")
                    solid(image, Rectangle(frame.x, child.y, UiStyle.Gap.xs(), child.height), color)
                    unchanged(plain, image, listOf(rail(view, "section"), rail(view, "section", "child")))

                    view.collapsePath(TreePath(view.hierarchy.entries.getValue("section").path))
                    val collapsed = paint(view)
                    solid(collapsed, Rectangle(frame.x, frame.y + frame.height - gap, frame.width, gap), view.background)
                    solid(collapsed, rail(view, "section"), color)
                    assertEquals(frame.height, row(view, "section").height)
                }
            }
        } finally {
            previous.forEach { (key, value) -> UIManager.put(key, value) }
            JBUIScale.setUserScaleFactorForTest(original)
        }
    }

    fun `test selected sections keep inactive backgrounds without changing focused leaf behavior`() {
        val keys = listOf("Tree.selectionBackground", "Tree.selectionInactiveBackground")
        val previous = keys.associateWith(UIManager::get)
        try {
            UIManager.put(keys.first(), Color(0x2857A5))
            UIManager.put(keys.last(), Color(0x626262))
            val tree = ActiveTree("")
            tree.update(listOf(
                ActiveTreeNode(Row("colored"), listOf(ActiveTreeNode(Row("leaf"))), ActiveTreeColors.color("red")),
                ActiveTreeNode(Row("plain"), listOf(ActiveTreeNode(Row("other")))),
                ActiveTreeNode(Row("empty"), emptyList()),
            ))
            val view = attach(tree)
            val inactive = UIUtil.getTreeBackground(true, false)
            val active = UIUtil.getTreeBackground(true, true)
            assertFalse(inactive == active)

            for (focused in listOf(false, true)) {
                for (key in listOf("colored", "plain", "empty")) {
                    val state = view.state(view.hierarchy.entries.getValue(key), true, focused)
                    assertEquals(inactive, state.selectionColor)
                    assertEquals(inactive, state.backdrop)
                    assertEquals(inactive, state.pillBackground)
                    assertEquals(focused, state.focused)
                    assertEquals(focused, state.active)
                }
                val state = view.state(view.hierarchy.entries.getValue("leaf"), true, focused)
                assertEquals(if (focused) active else inactive, state.selectionColor)
                assertEquals(focused, state.focused)
                assertEquals(focused, state.active)
            }
        } finally {
            previous.forEach { (key, value) -> UIManager.put(key, value) }
        }
    }

    fun `test drag placeholder rails follow the live parent and cancellation restores their original section`() {
        val moves = mutableListOf<ActiveMove>()
        val tree = ActiveTree("", reorder = ActiveReorder(
            movable = { it.key !in listOf("first", "second") },
            onMove = { moves += it },
            reparent = { _, parent -> parent != null && parent.key in listOf("first", "second") },
        ))
        val red = UiStyle.Colors.sections.getValue("red")
        val blue = UiStyle.Colors.sections.getValue("blue")
        tree.update(listOf(
            ActiveTreeNode(Row("first"), listOf(ActiveTreeNode(Row("a")), ActiveTreeNode(Row("b"))), red),
            ActiveTreeNode(Row("second"), listOf(ActiveTreeNode(Row("c"))), blue),
        ))
        val view = attach(tree)
        val entry = view.hierarchy.entries.getValue("a")
        val first = view.hierarchy.entries.getValue("first")
        val second = view.hierarchy.entries.getValue("second")
        val path = TreePath(second.path)
        view.collapsePath(path)
        assertTrue(tree.select("a", false))
        val original = paint(view)
        val cell = view.regions.cell(second)

        view.over("a", Point(cell.x + cell.width / 2, cell.y + cell.height / 2))

        assertSame(second, entry.parent)
        assertTrue(view.placeholder(entry))
        assertTrue(view.isExpanded(path))
        val preview = paint(view)
        solid(preview, rail(view, "first", "b"), red)
        solid(preview, rail(view, "second", "c"), blue)
        solid(preview, rail(view, "second", "a"), blue)

        tree.setLocked(true)

        assertSame(first, entry.parent)
        assertFalse(view.placeholder(entry))
        assertFalse(view.isExpanded(path))
        assertSame(entry, view.selectionPath.lastPathComponent)
        assertEquals(listOf("a"), tree.selectedKeys())
        tree.setLocked(false)
        unchanged(original, paint(view))
        view.drop()
        assertEmpty(moves)
    }

    fun `test palette has exact stable keys and retained colors resolve live theme overrides`() {
        val keys = listOf("red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta")
        assertEquals(keys, ActiveTreeColors.keys)
        assertEquals(keys, UiStyle.Colors.sections.keys.toList())
        assertNull(ActiveTreeColors.color(null))
        assertNull(ActiveTreeColors.color(""))
        assertNull(ActiveTreeColors.color("Red"))
        assertNull(ActiveTreeColors.color("missing"))
        keys.forEach { key ->
            val color = requireNotNull(ActiveTreeColors.color(key))
            assertSame(UiStyle.Colors.sections.getValue(key), color)
            assertTrue("$key must remain theme-aware", color is JBColor)
        }
        val color = requireNotNull(ActiveTreeColors.color("red"))
        val tree = ActiveTree("")
        tree.update(listOf(ActiveTreeNode(Row("section"), listOf(ActiveTreeNode(Row("child"))), color)))
        val view = attach(tree)
        val previous = UIManager.get("Kilo.Section.red")
        try {
            for (value in listOf(Color(0x176A95), Color(0x9B4271))) {
                UIManager.put("Kilo.Section.red", value)

                assertSame(color, ActiveTreeColors.color("red"))
                assertEquals(value.rgb, color.rgb)
                val image = paint(view)
                solid(image, rail(view, "section"), value)
                solid(image, rail(view, "section", "child"), value)
            }
        } finally {
            UIManager.put("Kilo.Section.red", previous)
        }
    }

    fun `test palette menu updates native selected state routes changes to event keys and disables missing context`() {
        val data = DataKey.create<String>("ActiveTreeColorTest.section")
        val state = linkedMapOf("first" to "red", "second" to "blue")
        val calls = mutableListOf<Pair<String, String>>()
        val group = ActiveTreeColors.group(data, state::get) { key, color ->
            calls += key to color
            state[key] = color
        }
        assertFalse(group.isPopup)
        assertNull(group.templateText)
        val actions = group.getChildren(null).map { it as ToggleAction }
        assertEquals(ActiveTreeColors.keys.map { KiloBundle.message("activeTree.color.$it") },
            actions.map { it.templateText })
        val choices = ActiveTreeColors.keys.zip(actions).toMap()
        choices.forEach { (key, action) ->
            assertEquals(ActionUpdateThread.EDT, action.actionUpdateThread)
            val first = event(action, data, "first")
            val second = event(action, data, "second")
            ActionUtil.updateAction(action, first)
            ActionUtil.updateAction(action, second)
            assertTrue(first.presentation.isEnabledAndVisible)
            assertTrue(second.presentation.isEnabledAndVisible)
            assertEquals(key == "red", Toggleable.isSelected(first.presentation))
            assertEquals(key == "blue", Toggleable.isSelected(second.presentation))

            val missing = event(action, data, null)
            ActionUtil.updateAction(action, missing)
            assertFalse(missing.presentation.isEnabled)
            assertFalse(Toggleable.isSelected(missing.presentation))
            action.setSelected(missing, true)
            action.actionPerformed(missing)
        }
        assertEmpty(calls)

        val red = choices.getValue("red")
        val selected = event(red, data, "first")
        red.actionPerformed(selected)
        ActionUtil.updateAction(red, selected)
        assertTrue("Clicking the selected choice must not clear its color", Toggleable.isSelected(selected.presentation))
        assertEmpty(calls)

        val green = choices.getValue("green")
        val first = event(green, data, "first")
        green.setSelected(first, false)
        assertEmpty(calls)
        green.actionPerformed(first)
        assertEquals(mapOf("first" to "green", "second" to "blue"), state)
        val purple = choices.getValue("purple")
        val second = event(purple, data, "second")
        purple.setSelected(second, true)
        assertEquals(mapOf("first" to "green", "second" to "purple"), state)
        assertEquals(listOf("first" to "green", "second" to "purple"), calls)
        ActionUtil.updateAction(green, first)
        ActionUtil.updateAction(purple, second)
        assertTrue(Toggleable.isSelected(first.presentation))
        assertTrue(Toggleable.isSelected(second.presentation))
        ActionUtil.updateAction(red, selected)
        assertFalse(Toggleable.isSelected(selected.presentation))
    }

    fun `test leading swatches paint actual circular palette colors and scale exactly once`() {
        val data = DataKey.create<String>("ActiveTreeColorTest.swatch")
        val group = ActiveTreeColors.group(data, { "red" }) { _, _ -> fail("Updating swatches must not change a color") }
        val choices = ActiveTreeColors.keys.zip(group.getChildren(null).map { it as ToggleAction })
        val original = JBUIScale.scale(1f)
        try {
            for (scale in listOf(1f, 1.5f, 2f)) {
                JBUIScale.setUserScaleFactorForTest(scale)
                choices.forEach { (key, action) ->
                    val event = event(action, data, "section")
                    ActionUtil.updateAction(action, event)
                    assertNull(event.presentation.getClientProperty(ActionUtil.SECONDARY_ICON))
                    val icon = requireNotNull(event.presentation.icon)
                    assertEquals("$key swatch width at $scale", JBUI.scale(16), icon.iconWidth)
                    assertEquals("$key swatch height at $scale", JBUI.scale(16), icon.iconHeight)
                    val image = BufferedImage(icon.iconWidth, icon.iconHeight, BufferedImage.TYPE_INT_ARGB)
                    val graphics = image.createGraphics()
                    try {
                        icon.paintIcon(null, graphics, 0, 0)
                    } finally {
                        graphics.dispose()
                    }
                    val ink = (0 until image.width).filter { x ->
                        (0 until image.height).any { y -> image.getRGB(x, y).ushr(24) != 0 }
                    }
                    val margin = (image.width - JBUI.scale(12)) / 2
                    assertEquals("$key dot diameter at $scale", JBUI.scale(12), ink.size)
                    assertEquals("$key dot is centered at $scale", margin, ink.first())
                    assertEquals(0, image.getRGB(margin, margin).ushr(24))
                    assertEquals(UiStyle.Colors.sections.getValue(key).rgb,
                        image.getRGB(image.width / 2, image.height / 2))
                }
            }
        } finally {
            JBUIScale.setUserScaleFactorForTest(original)
        }
    }

    fun `test real popup shows colors as final inline rows with leading swatches`() {
        val data = DataKey.create<String>("ActiveTreeColorTest.popup")
        val context = SimpleDataContext.builder().add(data, "section").build()
        val group = ActiveTreeColors.group(data, { "red" }) { _, _ -> fail("Showing a menu must not change a color") }
        val popup = JBPopupFactory.getInstance().createActionGroupPopup(
            null, group, context, JBPopupFactory.ActionSelectionAid.SPEEDSEARCH, true,
        )
        Disposer.register(testRootDisposable, popup)

        fun <T> check(step: ListPopupStep<T>) {
            assertEquals(ActiveTreeColors.keys.map { KiloBundle.message("activeTree.color.$it") },
                step.values.map(step::getTextFor))
            step.values.forEachIndexed { index, value ->
                assertFalse(step.hasSubstep(value))
                val icon = requireNotNull(step.getIconFor(value))
                assertEquals(JBUI.scale(16), icon.iconWidth)
                assertEquals(JBUI.scale(16), icon.iconHeight)
                val image = BufferedImage(icon.iconWidth, icon.iconHeight, BufferedImage.TYPE_INT_ARGB)
                val graphics = image.createGraphics()
                try {
                    icon.paintIcon(null, graphics, 0, 0)
                } finally {
                    graphics.dispose()
                }
                assertEquals(ActiveTreeColors.color(ActiveTreeColors.keys[index])!!.rgb,
                    image.getRGB(image.width / 2, image.height / 2))
            }
        }

        check(popup.listStep)
    }

    @RequiresEdt
    private fun attach(tree: ActiveTree): ActiveTreeView {
        val view = tree.preferredFocus() as ActiveTreeView
        view.setUI(DefaultTreeUI())
        val host = JPanel(BorderLayout())
        host.add(tree)
        host.size = JBUI.size(400, 400)
        host.addNotify()
        Disposer.register(testRootDisposable) { host.removeNotify() }
        activeLayout(host)
        UIUtil.dispatchAllInvocationEvents()
        return view
    }

    @RequiresEdt
    private fun row(view: ActiveTreeView, key: String): Rectangle {
        val index = view.getRowForPath(TreePath(view.hierarchy.entries.getValue(key).path))
        assertTrue("Expected a visible native row for $key", index >= 0)
        return requireNotNull(view.getRowBounds(index))
    }

    @RequiresEdt
    private fun rail(view: ActiveTreeView, section: String, key: String = section): Rectangle {
        val entry = view.hierarchy.entries.getValue(section)
        val frame = requireNotNull(view.regions.frame(entry))
        val bounds = row(view, key)
        val gap = UiStyle.Gap.xs()
        val top = if (key == section) gap else 0
        val bottom = if (key == section && (entry.childCount == 0 || !view.isExpanded(TreePath(entry.path)))) gap else 0
        return Rectangle(frame.x, bounds.y + top, gap, bounds.height - top - bottom)
    }

    @RequiresEdt
    private fun paint(view: ActiveTreeView, clip: Rectangle? = null): BufferedImage {
        val image = BufferedImage(view.width, view.height, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        try {
            graphics.color = view.background
            graphics.fillRect(0, 0, image.width, image.height)
            graphics.clip = clip ?: Rectangle(0, 0, image.width, image.height)
            view.paint(graphics)
        } finally {
            graphics.dispose()
        }
        return image
    }

    private fun solid(image: BufferedImage, bounds: Rectangle, color: Color) {
        assertFalse("Expected a nonempty painted rail", bounds.isEmpty)
        for (y in bounds.y until bounds.y + bounds.height) for (x in bounds.x until bounds.x + bounds.width) {
            assertEquals("Rail pixel at $x,$y", color.rgb, image.getRGB(x, y))
        }
    }

    private fun unchanged(before: BufferedImage, after: BufferedImage, except: List<Rectangle> = emptyList()) {
        assertEquals(before.width, after.width)
        assertEquals(before.height, after.height)
        for (y in 0 until before.height) for (x in 0 until before.width) {
            if (except.any { it.contains(x, y) }) continue
            assertEquals("Unexpected pixel change outside the rails at $x,$y", before.getRGB(x, y), after.getRGB(x, y))
        }
    }

    @RequiresEdt
    private fun event(action: ToggleAction, data: DataKey<String>, key: String?): AnActionEvent {
        val context = SimpleDataContext.builder()
        if (key != null) context.add(data, key)
        return AnActionEvent.createEvent(action, context.build(), null, ActionPlaces.POPUP, ActionUiKind.POPUP, null)
    }
}
