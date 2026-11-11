package ai.kilocode.client.agentManager

import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveMove
import ai.kilocode.client.ui.tree.ActiveTreeNode
import ai.kilocode.client.util.edtWait
import com.intellij.ide.util.PropertiesComponent
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class AgentManagerLayoutTest : BasePlatformTestCase() {
    private data class Row(override val key: String, override val title: String = key) : ActiveItem

    private val current = Row("current", "Current branch")
    private val cloud = Row("cloud", "Cloud workspace")
    private val local = Row("local", "Local worktree")
    private val items = listOf(current, cloud, local)
    private lateinit var layout: AgentManagerLayout
    private var before: String? = null

    override fun setUp() {
        super.setUp()
        edtWait {
            val props = PropertiesComponent.getInstance(project)
            before = props.getValue(STORAGE)
            props.unsetValue(STORAGE)
            layout = AgentManagerLayout(props)
        }
    }

    override fun tearDown() {
        try {
            edtWait { PropertiesComponent.getInstance(project).setValue(STORAGE, before) }
        } finally {
            super.tearDown()
        }
    }

    fun `test initial local cloud and current items are roots without fixed groups`() = edtWait {
        assertTrue(layout.nodes(emptyList()).isEmpty())

        val nodes = layout.nodes(items)

        assertEquals(items, nodes.map { it.item })
        assertTrue(nodes.all { it.children == null })
    }

    fun `test creating sections appends distinct empty root branches`() = edtWait {
        layout.nodes(items)
        val first = layout.create("First")
        val second = layout.create("Second")

        val nodes = layout.nodes(items)

        assertFalse(first.key == second.key)
        assertEquals(listOf(current.key, cloud.key, local.key, first.key, second.key), keys(nodes))
        assertEquals(first, layout.section(first.key))
        assertEquals(second, layout.section(second.key))
        assertEquals(emptyList<ActiveTreeNode>(), children(nodes, first))
        assertEquals(emptyList<ActiveTreeNode>(), children(nodes, second))
    }

    fun `test local cloud and current items move into a section and back`() = edtWait {
        val section = layout.create("Section")
        layout.nodes(items)

        items.forEachIndexed { index, item ->
            val grouped = items.take(index + 1)
            layout.move(ActiveMove(item.key, 0, index, grouped.map { it.key }, parent = section.key))

            val nodes = layout.nodes(items)
            assertEquals(items.drop(index + 1).map { it.key } + section.key, keys(nodes))
            assertEquals(grouped, children(nodes, section).map { it.item })
        }

        items.forEachIndexed { index, item ->
            val roots = items.take(index + 1)
            layout.move(ActiveMove(item.key, 0, index, roots.map { it.key } + section.key, previous = section.key))

            val nodes = layout.nodes(items.reversed())
            assertEquals(roots.map { it.key } + section.key, keys(nodes))
            assertEquals(items.drop(index + 1), children(nodes, section).map { it.item })
            assertTrue(nodes.filter { it.item.key != section.key }.all { it.children == null })
        }
    }

    fun `test moving between sections updates both sibling lists`() = edtWait {
        val first = layout.create("First")
        val second = layout.create("Second")
        layout.nodes(items)
        layout.move(ActiveMove(local.key, 2, 0, listOf(local.key), parent = first.key))
        layout.move(ActiveMove(cloud.key, 1, 0, listOf(cloud.key, local.key), parent = first.key))
        layout.move(ActiveMove(current.key, 0, 0, listOf(current.key), parent = second.key))
        layout.nodes(items)

        layout.move(ActiveMove(cloud.key, 0, 1, listOf(current.key, cloud.key), parent = second.key, previous = first.key))

        val nodes = layout.nodes(items.reversed())
        assertEquals(listOf(first.key, second.key), keys(nodes))
        assertEquals(listOf(local.key), keys(children(nodes, first)))
        assertEquals(listOf(current.key, cloud.key), keys(children(nodes, second)))
    }

    fun `test sibling reordering preserves its section across discovery order changes`() = edtWait {
        val section = layout.create("Section")
        layout.nodes(items)
        items.forEachIndexed { index, item ->
            layout.move(ActiveMove(item.key, 0, index, items.take(index + 1).map { it.key }, parent = section.key))
        }
        layout.nodes(items)

        layout.move(ActiveMove(local.key, 2, 0, listOf(local.key, current.key, cloud.key), parent = section.key, previous = section.key))

        val nodes = layout.nodes(items.reversed())
        assertEquals(listOf(section.key), keys(nodes))
        assertEquals(listOf(local.key, current.key, cloud.key), keys(children(nodes, section)))
    }

    fun `test sections reorder interleaved with root items without losing contents`() = edtWait {
        val first = layout.create("First")
        val second = layout.create("Second")
        layout.nodes(items)
        layout.move(ActiveMove(local.key, 2, 0, listOf(local.key), parent = first.key))
        layout.nodes(items)

        layout.move(ActiveMove(first.key, 2, 1, listOf(current.key, first.key, cloud.key, second.key)))
        layout.move(ActiveMove(second.key, 3, 0, listOf(second.key, current.key, first.key, cloud.key)))

        val nodes = layout.nodes(items.reversed())
        assertEquals(listOf(second.key, current.key, first.key, cloud.key), keys(nodes))
        assertEquals(listOf(local.key), keys(children(nodes, first)))
        assertEquals(emptyList<ActiveTreeNode>(), children(nodes, second))
    }

    fun `test deletion ungroups contents at the original section position in sibling order`() = edtWait {
        val tail = Row("tail")
        val rows = items + tail
        val section = layout.create("Section")
        val other = layout.create("Other")
        layout.nodes(rows)
        layout.move(ActiveMove(local.key, 2, 0, listOf(local.key), parent = section.key))
        layout.move(ActiveMove(cloud.key, 1, 1, listOf(local.key, cloud.key), parent = section.key))
        layout.move(ActiveMove(section.key, 2, 1, listOf(current.key, section.key, tail.key, other.key)))
        val grouped = layout.nodes(rows)
        assertEquals(listOf(local.key, cloud.key), keys(children(grouped, section)))

        layout.delete(section.key)

        val nodes = layout.nodes(rows.reversed())
        assertEquals(listOf(current.key, local.key, cloud.key, tail.key, other.key), keys(nodes))
        assertTrue(nodes.filter { it.item.key != other.key }.all { it.children == null })
        assertEquals(emptyList<ActiveTreeNode>(), children(nodes, other))
        assertNull(layout.section(section.key))
        val restored = AgentManagerLayout(PropertiesComponent.getInstance(project))
        assertEquals(nodes, restored.nodes(rows))
        assertNull(restored.section(section.key))
    }

    fun `test renaming trims names and ignores blank input`() = edtWait {
        val section = layout.create("Original")
        layout.nodes(items)

        layout.rename(section.key, " \t Planning \n ")

        assertEquals(section.copy(title = "Planning"), layout.section(section.key))
        val nodes = layout.nodes(items)
        assertEquals("Planning", nodes.single { it.item.key == section.key }.item.title)
        for (name in listOf("", " \t\n ")) {
            layout.rename(section.key, name)
            assertEquals(nodes, layout.nodes(items))
        }
    }

    fun `test sections cannot be nested and only sections can receive items`() = edtWait {
        val first = layout.create("First")
        val second = layout.create("Second")
        layout.nodes(items)
        layout.move(ActiveMove(local.key, 2, 0, listOf(local.key), parent = first.key))
        val nodes = layout.nodes(items)

        for (move in listOf(
            ActiveMove(first.key, 2, 0, listOf(first.key), parent = second.key),
            ActiveMove(first.key, 2, 1, listOf(local.key, first.key), parent = first.key),
            ActiveMove(cloud.key, 1, 0, listOf(cloud.key), parent = local.key),
            ActiveMove(cloud.key, 1, 0, listOf(cloud.key), parent = "missing"),
        )) {
            layout.move(move)
            assertEquals(nodes, layout.nodes(items))
        }
    }

    fun `test project properties restore names membership and root and sibling order`() = edtWait {
        val section = layout.create("Original")
        val empty = layout.create("Empty")
        layout.nodes(items)
        layout.move(ActiveMove(local.key, 2, 0, listOf(local.key), parent = section.key))
        layout.move(ActiveMove(cloud.key, 1, 1, listOf(local.key, cloud.key), parent = section.key))
        layout.rename(section.key, "  Planning  ")
        layout.move(ActiveMove(empty.key, 2, 0, listOf(empty.key, current.key, section.key)))
        val nodes = layout.nodes(items)
        assertNotNull(PropertiesComponent.getInstance(project).getValue(STORAGE))

        val restored = AgentManagerLayout(PropertiesComponent.getInstance(project))

        assertEquals(section.copy(title = "Planning"), restored.section(section.key))
        assertEquals(empty, restored.section(empty.key))
        assertEquals(nodes, restored.nodes(items.reversed()))
        assertEquals(listOf(empty.key, current.key, section.key), keys(restored.nodes(items)))
        assertEquals(listOf(local.key, cloud.key), keys(children(restored.nodes(items), section)))
    }

    fun `test temporarily missing root and grouped items retain persisted placement`() = edtWait {
        val extra = Row("extra")
        val rows = items + extra
        val section = layout.create("Section")
        layout.nodes(rows)
        layout.move(ActiveMove(cloud.key, 1, 0, listOf(cloud.key), parent = section.key))
        layout.move(ActiveMove(extra.key, 2, 1, listOf(cloud.key, extra.key), parent = section.key))
        layout.move(ActiveMove(section.key, 2, 1, listOf(current.key, section.key, local.key)))
        val nodes = layout.nodes(rows)

        val partial = layout.nodes(listOf(local, extra))
        assertEquals(listOf(section.key, local.key), keys(partial))
        assertEquals(listOf(extra.key), keys(children(partial, section)))
        val absent = layout.nodes(emptyList())
        assertEquals(listOf(section.key), keys(absent))
        assertEquals(emptyList<ActiveTreeNode>(), children(absent, section))

        val restored = AgentManagerLayout(PropertiesComponent.getInstance(project))
        assertEquals(nodes, restored.nodes(rows.reversed()))
    }

    fun `test moving a section while a root item is missing preserves that items placement`() = edtWait {
        val section = layout.create("Section")
        layout.nodes(items)
        layout.nodes(listOf(current, local))

        layout.move(ActiveMove(section.key, 2, 0, listOf(section.key, current.key, local.key)))

        assertEquals(listOf(section.key, current.key, local.key), keys(layout.nodes(listOf(current, local))))
        val restored = AgentManagerLayout(PropertiesComponent.getInstance(project))
        assertEquals(listOf(section.key, current.key, cloud.key, local.key), keys(restored.nodes(items.reversed())))
    }

    private fun keys(nodes: List<ActiveTreeNode>) = nodes.map { it.item.key }

    private fun children(nodes: List<ActiveTreeNode>, section: AgentManagerLayout.Section) =
        requireNotNull(nodes.single { it.item.key == section.key }.children)

    private companion object {
        const val STORAGE = "kilo.agentManager.layout"
    }
}
