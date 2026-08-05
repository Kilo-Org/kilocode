package ai.kilocode.client.settings.autoapprove

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.settings.base.SettingsListItem
import ai.kilocode.client.settings.base.settingsListCellBounds
import ai.kilocode.client.testing.fire
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBList
import com.intellij.util.ui.UIUtil
import java.awt.Container
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.ListSelectionModel

class SettingsInlineListTest : BasePlatformTestCase() {
    fun `test empty list keeps minimum height for empty text`() {
        edt {
            val list = list()
            list.syncItems(emptyList(), true)
            layout(list)

            assertTrue(jbList(list).minimumSize.height >= UiStyle.Gap.xl())
        }
    }

    fun `test filtering to no rows keeps minimum empty list area`() {
        edt {
            val list = list()
            list.syncItems(listOf("*.env" to "deny", "*.key" to "deny", "*.pem" to "deny"), true)
            layout(list)

            list.filter("nomatch")
            layout(list)

            assertEquals(0, jbList(list).model.size)
            assertTrue(jbList(list).minimumSize.height >= UiStyle.Gap.xl())
        }
    }

    fun `test toolbar delete removes selected rows in bulk`() {
        edt {
            val removed = mutableListOf<String>()
            val list = list(onRemove = { removed += it }, selection = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION)
            list.syncItems(listOf("*.env" to "deny", "*.key" to "deny"), true)
            layout(list)

            val jList = jbList(list)
            jList.setSelectionInterval(0, 1)
            UIUtil.dispatchAllInvocationEvents()
            click(button(list, 1))

            assertEquals(listOf("*.env", "*.key"), removed)
        }
    }

    fun `test toolbar add invokes onAdd with the input override value`() {
        edt {
            val added = mutableListOf<String>()
            val list = list(onAdd = { added += it })
            list.input = { "git *" }
            layout(list)

            click(button(list, 0))

            assertEquals(listOf("git *"), added)
        }
    }

    fun `test toolbar add ignores duplicate input`() {
        edt {
            val added = mutableListOf<String>()
            val list = list(onAdd = { added += it })
            list.syncItems(listOf("git *" to "ask"), true)
            list.input = { "git *" }
            layout(list)

            click(button(list, 0))

            assertTrue(added.isEmpty())
        }
    }

    fun `test row level action changes through picker selection`() {
        edt {
            val changed = mutableListOf<String>()
            val picker = FakePicker { it.first { c -> c is LevelChoice.Level && c.level == "ask" } }
            val list = list(onSet = { _, level -> changed += level }, picker = picker)
            list.syncRows(listOf(PermissionListRow("glob", "Glob", "Search files", "allow")), true)
            layout(list)

            clickLevel(list, "glob")

            assertEquals(listOf(LevelChoice.Level("allow"), LevelChoice.Level("ask"), LevelChoice.Level("deny")), picker.offered)
            assertEquals(listOf("ask"), changed)
        }
    }

    fun `test picker offers default option for inheritable rows`() {
        edt {
            val inherited = mutableListOf<String>()
            val picker = FakePicker { it.first { c -> c is LevelChoice.Default } }
            val list = list(onInherit = { inherited += it }, picker = picker)
            list.syncRows(
                listOf(PermissionListRow("glob", "Glob", "Search files", "allow", inherited = true, canInherit = true)),
                true,
            )
            layout(list)

            clickLevel(list, "glob")

            assertEquals(LevelChoice.Default("allow"), picker.offered.first())
            assertEquals(listOf("glob"), inherited)
        }
    }

    fun `test exception edit action is selected only and double click edits`() {
        edt {
            val edits = mutableListOf<Pair<String, String>>()
            val list = list(onEdit = { from, to -> edits += from to to })
            list.editInput = { "git status" }
            list.syncItems(listOf("git *" to "allow"), true)
            val jList = jbList(list)
            jList.setSize(400, jList.preferredSize.height.coerceAtLeast(50))
            jList.doLayout()

            assertFalse(settingsListCellBounds(jList, 0, false).containsKey("edit"))
            jList.selectedIndex = 0
            assertTrue(settingsListCellBounds(jList, 0, true).containsKey("edit"))

            doubleClickRow(jList, 0)

            assertEquals(listOf("git *" to "git status"), edits)
        }
    }

    fun `test exception edit ignores duplicate target`() {
        edt {
            val edits = mutableListOf<Pair<String, String>>()
            val list = list(onEdit = { from, to -> edits += from to to })
            list.editInput = { "git status" }
            list.syncItems(listOf("git *" to "allow", "git status" to "ask"), true)
            val jList = jbList(list)
            jList.setSize(400, jList.preferredSize.height.coerceAtLeast(50))
            jList.doLayout()

            doubleClickRow(jList, 0)

            assertTrue(edits.isEmpty())
        }
    }

    fun `test syncItems retains the same list view instance across updates`() {
        edt {
            val list = list()
            list.syncItems(listOf("*.env" to "deny"), true)
            val jList = jbList(list)

            list.syncItems(listOf("*.env" to "deny", "*.key" to "deny"), true)

            assertSame(jList, jbList(list))
        }
    }

    fun `test row height stays stable across level changes and reload`() {
        edt {
            val list = list()
            list.syncRows(listOf(PermissionListRow("git log *", "git log *", level = "allow")), true)
            val jList = jbList(list)
            jList.selectedIndex = 0
            val height = jList.fixedCellHeight

            list.syncRows(listOf(PermissionListRow("git log *", "git log *", level = "ask")), true)
            assertEquals(height, jList.fixedCellHeight)

            list.syncRows(listOf(PermissionListRow("git log *", "git log *", level = "ask")), false)
            list.syncRows(listOf(PermissionListRow("git log *", "git log *", level = "deny")), true)
            assertEquals(height, jList.fixedCellHeight)
        }
    }

    fun `test setEnabled disables add and list`() {
        edt {
            val list = list()
            list.syncItems(listOf("*.env" to "deny"), true)

            list.setEnabled(false)

            assertFalse(button(list, 0).isEnabled)
            assertFalse(jbList(list).isEnabled)
        }
    }

    private fun list(
        onAdd: (String) -> Unit = {},
        onSet: (String, String) -> Unit = { _, _ -> },
        onInherit: (String) -> Unit = {},
        onEdit: (String, String) -> Unit = { _, _ -> },
        onRemove: (List<String>) -> Unit = {},
        picker: LevelPicker = PopupLevelPicker,
        selection: Int = ListSelectionModel.SINGLE_SELECTION,
    ): SettingsInlineList = SettingsInlineList(
        empty = "Empty",
        addLabel = "Add",
        placeholder = "e.g. *.env",
        onAdd = onAdd,
        onSetLevel = onSet,
        onInherit = onInherit,
        onEdit = onEdit,
        onRemove = onRemove,
        picker = picker,
        selectionMode = selection,
    )

    private class FakePicker(private val select: (List<LevelChoice>) -> LevelChoice) : LevelPicker {
        var offered: List<LevelChoice> = emptyList()
            private set

        override fun popup(choices: List<LevelChoice>, choose: (LevelChoice) -> Unit): JBPopup? {
            offered = choices
            choose(select(choices))
            return null
        }
    }

    private fun jbList(list: SettingsInlineList): JBList<*> = components(list).filterIsInstance<JBList<*>>().single()

    private fun layout(root: Container) {
        root.setSize(400, root.preferredSize.height.coerceAtLeast(50))
        root.doLayout()
        root.components.filterIsInstance<Container>().forEach { layout(it) }
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun button(list: SettingsInlineList, index: Int): JComponent = components(list)
        .filterIsInstance<JComponent>()
        .filter { it.javaClass.name.endsWith("ActionButton") }
        .let { it[index] }

    private fun click(target: JComponent) {
        target.setSize(target.preferredSize)
        val point = Point(target.width.coerceAtLeast(2) / 2, target.height.coerceAtLeast(2) / 2)
        click(target, point)
    }

    private fun clickLevel(list: SettingsInlineList, key: String) {
        val jList = jbList(list)
        val model = jList.model
        val idx = (0 until model.size).first { (model.getElementAt(it) as SettingsListItem).key == key }
        jList.selectedIndex = idx
        jList.setSize(400, jList.preferredSize.height.coerceAtLeast(50))
        jList.doLayout()
        val bounds = settingsListCellBounds(jList, idx, true)["level"] ?: error("missing level cell for $key")
        click(jList, Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
    }

    private fun click(target: JComponent, point: Point) {
        val press = MouseEvent(
            target,
            MouseEvent.MOUSE_PRESSED,
            System.currentTimeMillis(),
            InputEvent.BUTTON1_DOWN_MASK,
            point.x,
            point.y,
            1,
            false,
            MouseEvent.BUTTON1,
        )
        val release = MouseEvent(
            target,
            MouseEvent.MOUSE_RELEASED,
            System.currentTimeMillis(),
            0,
            point.x,
            point.y,
            1,
            false,
            MouseEvent.BUTTON1,
        )
        val clicked = MouseEvent(
            target,
            MouseEvent.MOUSE_CLICKED,
            System.currentTimeMillis(),
            0,
            point.x,
            point.y,
            1,
            false,
            MouseEvent.BUTTON1,
        )
        dispatch(target, press)
        dispatch(target, release)
        dispatch(target, clicked)
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun dispatch(target: JComponent, event: MouseEvent) {
        if (target is JBList<*>) {
            fire(target, event)
            return
        }
        target.dispatchEvent(event)
    }

    private fun doubleClickRow(list: JBList<*>, idx: Int) {
        val bounds = list.getCellBounds(idx, idx)
        click(list, Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2), count = 2)
    }

    private fun click(target: JComponent, point: Point, count: Int) {
        val event = MouseEvent(
            target,
            MouseEvent.MOUSE_CLICKED,
            System.currentTimeMillis(),
            0,
            point.x,
            point.y,
            count,
            false,
            MouseEvent.BUTTON1,
        )
        target.dispatchEvent(event)
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun components(root: java.awt.Component): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        fun visit(item: java.awt.Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }
}
