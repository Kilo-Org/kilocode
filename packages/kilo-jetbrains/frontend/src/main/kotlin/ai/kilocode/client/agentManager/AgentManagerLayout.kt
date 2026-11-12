package ai.kilocode.client.agentManager

import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveMove
import ai.kilocode.client.ui.tree.ActiveTreeNode
import ai.kilocode.client.ui.tree.ActiveTreeColors
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.diagnostic.logger
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.UUID

/** Project-local organization only; workspace metadata remains owned by git and Cloud. */
@Suppress("TooManyFunctions")
internal class AgentManagerLayout(private val properties: PropertiesComponent? = null) {
    @Serializable
    data class Section(override val key: String, override val title: String, val color: String? = null) : ActiveItem

    @Serializable
    private data class State(
        val sections: List<Section> = emptyList(),
        val membership: Map<String, String> = emptyMap(),
        val order: Map<String, List<String>> = emptyMap(),
    )

    private val json = Json { ignoreUnknownKeys = true }
    private var state = properties?.getValue(STORAGE)?.let { raw ->
        runCatching { json.decodeFromString<State>(raw) }.getOrElse { err ->
            logger<AgentManagerLayout>().warn("Cannot load Agent Manager layout", err)
            State()
        }
    } ?: State()
    private var order = state.order
    private var pinned: String? = null

    fun section(key: String): Section? = state.sections.firstOrNull { it.key == key }

    fun neighbors(key: String): List<String> {
        val keys = order[ROOT].orEmpty().flatMap { id ->
            if (section(id) == null) listOf(id) else order[id].orEmpty()
        }
        val index = keys.indexOf(key)
        if (index < 0) return emptyList()
        return keys.drop(index + 1) + keys.take(index).asReversed()
    }

    @RequiresEdt
    fun prune(keep: (String) -> Boolean) {
        val removed = (order.values.flatten() + state.membership.keys).toSet()
            .filterTo(HashSet()) { section(it) == null && !keep(it) }
        if (removed.isEmpty()) return
        order = order.mapValues { (_, keys) -> keys.filterNot(removed::contains) }
        save(state.copy(
            membership = state.membership - removed,
            order = order,
        ))
    }

    @RequiresEdt
    fun create(name: String): Section {
        val section = Section("kilo:agent-manager:section:${UUID.randomUUID()}", name)
        assign(state.sections + section)
        return requireNotNull(this.section(section.key))
    }

    @RequiresEdt
    fun rename(key: String, name: String) {
        val title = name.trim().takeIf { it.isNotEmpty() } ?: return
        save(state.copy(sections = state.sections.map { if (it.key == key) it.copy(title = title) else it }))
    }

    @RequiresEdt
    fun color(key: String, color: String) {
        if (color !in ActiveTreeColors.keys) return
        save(state.copy(sections = state.sections.map { if (it.key == key) it.copy(color = color) else it }))
    }

    @RequiresEdt
    fun delete(key: String) {
        if (section(key) == null) return
        val members = order[key].orEmpty().filter { state.membership[it] == key }
        val root = order[ROOT].orEmpty().flatMap { if (it == key) members else listOf(it) }
        save(state.copy(
            sections = state.sections.filterNot { it.key == key },
            membership = state.membership.filterValues { it != key },
            order = (order - key) + (ROOT to root.distinct()),
        ))
    }

    @RequiresEdt
    fun move(move: ActiveMove) {
        if (move.key == pinned) return
        if (move.parent != null && (section(move.parent) == null || section(move.key) != null)) return
        val membership = if (move.parent == null) state.membership - move.key
            else state.membership + (move.key to move.parent)
        val source = move.previous ?: ROOT
        val target = move.parent ?: ROOT
        val order = this.order + (source to this.order[source].orEmpty().filterNot { it == move.key })
        val siblings = order[target].orEmpty().filterNot { it == move.key }
        val next = move.keys.drop(move.to + 1).firstOrNull { it in siblings }
        val previous = move.keys.take(move.to).lastOrNull { it in siblings }
        val index = next?.let(siblings::indexOf) ?: previous?.let { siblings.indexOf(it) + 1 } ?: siblings.size
        val keys = siblings.toMutableList().apply { add(index, move.key) }
        save(state.copy(
            membership = membership,
            order = order + (target to keys),
        ))
    }

    @RequiresEdt
    fun nodes(items: List<ActiveItem>, pin: String? = null): List<ActiveTreeNode> {
        pinned = pin ?: pinned
        assign()
        val sections = state.sections.associateBy { it.key }
        val grouped = items.groupBy { state.membership[it.key]?.takeIf(sections::containsKey) ?: ROOT }
        fun sorted(parent: String, rows: List<ActiveItem>): List<ActiveItem> {
            val rank = state.order[parent].orEmpty().withIndex().associate { it.value to it.index }
            return rows.sortedBy { rank[it.key] ?: Int.MAX_VALUE }
        }
        val nodes = sorted(ROOT, grouped[ROOT].orEmpty() + state.sections).map { item ->
            ActiveTreeNode(item, sections[item.key]?.let { section ->
                sorted(section.key, grouped[section.key].orEmpty()).map { ActiveTreeNode(it) }
            }, color = ActiveTreeColors.color(sections[item.key]?.color))
        }
        // Retain temporarily undiscovered Cloud rows so a refresh cannot lose their placement.
        val visible = mapOf(ROOT to nodes.map { it.item.key }) + nodes.mapNotNull { node ->
            node.children?.let { node.item.key to it.map { child -> child.item.key } }
        }
        order = state.order + visible.mapValues { (key, keys) ->
            val prior = order[key].orEmpty()
            keys.toMutableList().apply {
                prior.filterNot { it in keys }.forEach { missing ->
                    val next = prior.drop(prior.indexOf(missing) + 1).firstOrNull { it in this }
                    add(next?.let(::indexOf) ?: size, missing)
                }
            }
        }
        return nodes
    }

    @RequiresEdt
    private fun assign(sections: List<Section> = state.sections) {
        val keys = ActiveTreeColors.keys
        val colors = sections.mapNotNull { it.color?.takeIf(keys::contains) }.toMutableList()
        save(state.copy(sections = sections.map { section ->
            if (section.color in keys) return@map section
            val color = keys.firstOrNull { it !in colors } ?: keys[colors.size % keys.size]
            colors += color
            section.copy(color = color)
        }))
    }

    @RequiresEdt
    private fun save(next: State) {
        val value = pinned?.let { key ->
            next.copy(
                membership = next.membership - key,
                order = next.order.mapValues { (_, keys) -> keys.filterNot { it == key } } +
                    (ROOT to (listOf(key) + next.order[ROOT].orEmpty().filterNot { it == key })),
            )
        } ?: next
        if (value == state) return
        if (value.order != state.order) order = value.order
        state = value
        properties?.setValue(STORAGE, json.encodeToString(value))
    }

    private companion object {
        const val STORAGE = "kilo.agentManager.layout"
        const val ROOT = ""
    }
}
