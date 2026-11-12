package ai.kilocode.client.agentManager

import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveMove
import ai.kilocode.client.ui.tree.ActiveTreeNode
import ai.kilocode.client.ui.tree.ActiveTreeColors
import ai.kilocode.client.util.edtWait
import com.intellij.ide.util.PropertiesComponent
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

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

    fun `test section colors follow the palette and cycle using persisted color keys`() = edtWait {
        val keys = listOf("red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta", "red", "orange")
        val sections = keys.mapIndexed { index, _ -> layout.create("Section $index") }

        assertEquals(keys, sections.map { it.color })
        val props = PropertiesComponent.getInstance(project)
        val saved = Json.parseToJsonElement(props.getValue(STORAGE)!!).jsonObject.getValue("sections").jsonArray
        assertEquals(keys, saved.map { it.jsonObject.getValue("color").jsonPrimitive.content })
        val restored = AgentManagerLayout(props)
        assertEquals(sections, sections.map { restored.section(it.key) })
        assertEquals(keys.map(ActiveTreeColors::color), restored.nodes(emptyList()).map { it.color })
    }

    fun `test uncolored and unknown section colors receive the next unused color without losing layout`() = edtWait {
        val props = PropertiesComponent.getInstance(project)
        props.setValue(STORAGE, """{
            "sections":[{"key":"first","title":"First"},{"key":"second","title":"Second","color":"blue"},
                {"key":"third","title":"Third","color":"unknown"}],
            "membership":{"local":"first"},
            "order":{"": ["third","first","cloud","second"],"first":["local"]}
        }""")
        val restored = AgentManagerLayout(props)

        val nodes = restored.nodes(listOf(local, cloud))

        assertEquals(listOf("third", "first", "cloud", "second"), keys(nodes))
        assertEquals("red", restored.section("first")!!.color)
        assertEquals("blue", restored.section("second")!!.color)
        assertEquals("orange", restored.section("third")!!.color)
        assertEquals(listOf(local.key), keys(nodes.single { it.item.key == "first" }.children!!))
        assertEquals(nodes, AgentManagerLayout(props).nodes(listOf(cloud, local)))
        assertEquals("yellow", restored.create("New").color)
    }

    fun `test choosing a section color persists without changing order membership or other colors`() = edtWait {
        val section = layout.create("Planning")
        val other = layout.create("Other")
        layout.nodes(items)
        layout.move(ActiveMove(local.key, 2, 0, listOf(local.key), parent = section.key))
        val before = layout.nodes(items)

        layout.color(section.key, "cyan")

        val props = PropertiesComponent.getInstance(project)
        val restored = AgentManagerLayout(props)
        val nodes = restored.nodes(items.reversed())
        assertEquals(keys(before), keys(nodes))
        assertEquals(children(before, section), children(nodes, section))
        assertEquals(section.copy(color = "cyan"), restored.section(section.key))
        assertEquals(other, restored.section(other.key))
        assertEquals(ActiveTreeColors.color("cyan"), nodes.single { it.item.key == section.key }.color)
        val saved = props.getValue(STORAGE)
        restored.color(section.key, "invalid")
        restored.color("missing", "red")
        assertEquals(saved, props.getValue(STORAGE))
    }

    fun `test deleting a section makes its palette color available without recoloring survivors`() = edtWait {
        val first = layout.create("First")
        val second = layout.create("Second")

        layout.delete(first.key)

        assertEquals("red", layout.create("Third").color)
        assertEquals(second, layout.section(second.key))
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

    fun `test pruning removes root and grouped keys from memory and project properties`() = edtWait {
        val section = layout.create("Section")
        layout.nodes(items)
        layout.move(ActiveMove(local.key, 2, 0, listOf(local.key), parent = section.key))
        layout.nodes(items)

        layout.prune { it == current.key }

        assertEquals(emptyList<String>(), layout.neighbors(local.key))
        assertEquals(emptyList<String>(), layout.neighbors(cloud.key))
        val props = PropertiesComponent.getInstance(project)
        assertFalse(props.getValue(STORAGE)!!.contains("\"${local.key}\""))
        assertFalse(props.getValue(STORAGE)!!.contains("\"${cloud.key}\""))
        val restored = AgentManagerLayout(props)
        assertEquals(section, restored.section(section.key))
        assertEquals(listOf(current.key, section.key), keys(restored.nodes(listOf(current))))
        assertEquals(emptyList<ActiveTreeNode>(), children(restored.nodes(listOf(current)), section))
        assertEquals(listOf(current.key, section.key, cloud.key, local.key), keys(restored.nodes(items)))
    }

    fun `test pruning a pending row survives later moves and section deletion without losing missing cloud placement`() = edtWait {
        val pending = Row("pending:branch:1")
        val section = layout.create("Section")
        layout.nodes(items)
        layout.move(ActiveMove(cloud.key, 1, 0, listOf(cloud.key), parent = section.key))
        layout.nodes(items + pending)
        layout.nodes(listOf(current, local))

        layout.prune { it != pending.key }
        assertEquals(emptyList<String>(), layout.neighbors(pending.key))
        layout.move(ActiveMove(section.key, 2, 0, listOf(section.key, current.key, local.key)))
        layout.delete(section.key)

        val props = PropertiesComponent.getInstance(project)
        assertFalse(props.getValue(STORAGE)!!.contains(pending.key))
        val restored = AgentManagerLayout(props)
        assertEquals(listOf(cloud.key, current.key, local.key), keys(restored.nodes(items.reversed())))
        assertEquals(listOf(current.key, local.key), restored.neighbors(cloud.key))
    }

    fun `test pinning repairs persisted primary membership and duplicate orders without losing other layout data`() = edtWait {
        val props = PropertiesComponent.getInstance(project)
        props.setValue(STORAGE, """{
            "sections":[{"key":"first","title":"Planning","color":"cyan"},
                {"key":"second","title":"Other","color":"magenta"}],
            "membership":{"current":"first","local":"first","cloud":"second","hidden":"second"},
            "order":{"": ["second","extra","current","first","current","missing"],
                "first":["current","local","current","missing:first"],
                "second":["current","cloud","current","hidden"]}
        }""")
        val restored = AgentManagerLayout(props)
        val rows = items + Row("extra")

        val nodes = restored.nodes(rows.reversed(), pin = current.key)

        val first = requireNotNull(restored.section("first"))
        val second = requireNotNull(restored.section("second"))
        assertEquals(listOf(current.key, second.key, "extra", first.key), keys(nodes))
        assertNull(nodes.first().children)
        assertEquals(listOf(local.key), keys(children(nodes, first)))
        assertEquals(listOf(cloud.key), keys(children(nodes, second)))
        assertEquals(AgentManagerLayout.Section("first", "Planning", "cyan"), first)
        assertEquals(AgentManagerLayout.Section("second", "Other", "magenta"), second)
        assertEquals(ActiveTreeColors.color("cyan"), nodes.single { it.item.key == first.key }.color)
        assertEquals(ActiveTreeColors.color("magenta"), nodes.single { it.item.key == second.key }.color)
        val saved = props.getValue(STORAGE)!!
        val data = Json.parseToJsonElement(saved).jsonObject
        assertEquals(Json.parseToJsonElement("""{"local":"first","cloud":"second","hidden":"second"}"""),
            data.getValue("membership"))
        val order = data.getValue("order").jsonObject
        assertEquals(listOf(current.key, second.key, "extra", first.key, "missing"),
            order.getValue("").jsonArray.map { it.jsonPrimitive.content })
        assertEquals(listOf(local.key, "missing:first"),
            order.getValue(first.key).jsonArray.map { it.jsonPrimitive.content })
        assertEquals(listOf(cloud.key, "hidden"),
            order.getValue(second.key).jsonArray.map { it.jsonPrimitive.content })
        assertEquals(nodes, restored.nodes(rows))
        assertEquals(nodes, AgentManagerLayout(props).nodes(rows.reversed()))
        assertEquals(saved, props.getValue(STORAGE))
    }

    fun `test forged moves of the remembered primary checkout are ignored`() = edtWait {
        val section = layout.create("Planning")
        val nodes = layout.nodes(items, pin = current.key)
        val props = PropertiesComponent.getInstance(project)
        val saved = props.getValue(STORAGE)

        for (move in listOf(
            ActiveMove(current.key, 0, 2, listOf(cloud.key, local.key, current.key, section.key)),
            ActiveMove(current.key, 0, 0, listOf(current.key), parent = section.key),
        )) {
            layout.nodes(items)
            layout.move(move)

            assertEquals(saved, props.getValue(STORAGE))
            assertEquals(nodes, layout.nodes(items))
        }
    }

    fun `test other moves and section deletion save the primary checkout first`() = edtWait {
        val first = layout.create("Planning")
        val second = layout.create("Other")
        layout.nodes(items, pin = current.key)
        layout.move(ActiveMove(local.key, 2, 0, listOf(local.key), parent = first.key))
        layout.move(ActiveMove(cloud.key, 1, 1, listOf(local.key, cloud.key), parent = first.key))
        layout.nodes(items)
        val props = PropertiesComponent.getInstance(project)

        layout.move(ActiveMove(second.key, 2, 0, listOf(second.key, current.key, first.key)))

        val grouped = listOf(current.key, second.key, first.key)
        assertEquals(grouped, Json.parseToJsonElement(props.getValue(STORAGE)!!).jsonObject
            .getValue("order").jsonObject.getValue("").jsonArray.map { it.jsonPrimitive.content })
        assertEquals(grouped, keys(layout.nodes(items.reversed())))
        assertEquals(listOf(local.key, cloud.key), keys(children(layout.nodes(items), first)))

        layout.move(ActiveMove(cloud.key, 1, 0, listOf(cloud.key, current.key, second.key, first.key), previous = first.key))

        val ungrouped = listOf(current.key, cloud.key, second.key, first.key)
        assertEquals(ungrouped, Json.parseToJsonElement(props.getValue(STORAGE)!!).jsonObject
            .getValue("order").jsonObject.getValue("").jsonArray.map { it.jsonPrimitive.content })
        assertEquals(ungrouped, keys(layout.nodes(items)))
        layout.delete(first.key)
        layout.rename(second.key, "Renamed")
        layout.color(second.key, "blue")
        val added = layout.create("New")
        layout.nodes(items)
        layout.prune { it != cloud.key }

        val roots = listOf(current.key, second.key, local.key, added.key)
        assertEquals(roots, Json.parseToJsonElement(props.getValue(STORAGE)!!).jsonObject
            .getValue("order").jsonObject.getValue("").jsonArray.map { it.jsonPrimitive.content })
        val restored = AgentManagerLayout(props)
        assertEquals(roots, keys(restored.nodes(listOf(local, current), pin = current.key)))
        assertNull(restored.section(first.key))
        assertEquals(second.copy(title = "Renamed", color = "blue"), restored.section(second.key))
    }

    fun `test delayed pin discovery stays remembered through missing listings and later saves`() = edtWait {
        val section = layout.create("Planning")
        layout.nodes(listOf(cloud, local))
        layout.move(ActiveMove(section.key, 2, 0, listOf(section.key, cloud.key, local.key)))
        assertEquals(listOf(section.key), keys(layout.nodes(emptyList())))

        assertEquals(listOf(current.key, section.key, cloud.key, local.key),
            keys(layout.nodes(items.reversed(), pin = current.key)))
        assertEquals(listOf(section.key, cloud.key, local.key), keys(layout.nodes(listOf(local, cloud))))

        layout.move(ActiveMove(local.key, 2, 0, listOf(local.key, section.key, cloud.key)))
        layout.rename(section.key, "Renamed")

        val props = PropertiesComponent.getInstance(project)
        val roots = listOf(current.key, local.key, section.key, cloud.key)
        assertEquals(roots, Json.parseToJsonElement(props.getValue(STORAGE)!!).jsonObject
            .getValue("order").jsonObject.getValue("").jsonArray.map { it.jsonPrimitive.content })
        assertEquals(roots, keys(layout.nodes(items)))
        assertEquals(roots, keys(AgentManagerLayout(props).nodes(items.reversed(), pin = current.key)))
    }

    private fun keys(nodes: List<ActiveTreeNode>) = nodes.map { it.item.key }

    private fun children(nodes: List<ActiveTreeNode>, section: AgentManagerLayout.Section) =
        requireNotNull(nodes.single { it.item.key == section.key }.children)

    private companion object {
        const val STORAGE = "kilo.agentManager.layout"
    }
}
