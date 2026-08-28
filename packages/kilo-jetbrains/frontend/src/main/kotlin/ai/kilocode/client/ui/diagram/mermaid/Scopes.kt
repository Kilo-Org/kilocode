package ai.kilocode.client.ui.diagram.mermaid

/**
 * Nested-scope bookkeeping for engines with composite blocks (state composites, C4 boundaries).
 *
 * A composite is also a layout node of its parent scope, so an edge that crosses scope boundaries is
 * re-anchored at the lowest common ancestor: each endpoint becomes either the node itself or the
 * composite that contains it there.
 */
internal class Scopes {
    private val parents = linkedMapOf<String, String>()
    private val owner = linkedMapOf<String, String>()

    fun open(id: String, parent: String) {
        parents[id] = parent
        claim(id, parent)
    }

    fun claim(node: String, scope: String) {
        if (!owner.containsKey(node)) owner[node] = scope
    }

    fun has(node: String) = owner.containsKey(node)

    fun resolve(from: String, to: String): Hop {
        val fp = path(owner[from] ?: ROOT)
        val tp = path(owner[to] ?: ROOT)
        var common = 0
        while (common < fp.size && common < tp.size && fp[common] == tp[common]) common++
        val lca = fp[common - 1]
        val a = if (common < fp.size) fp[common] else from
        val b = if (common < tp.size) tp[common] else to
        return Hop(lca, a, b)
    }

    private fun path(scope: String): List<String> {
        val out = ArrayDeque<String>()
        var cur = scope
        while (true) {
            out.addFirst(cur)
            if (cur == ROOT) return out.toList()
            cur = parents[cur] ?: ROOT
        }
    }

    companion object {
        const val ROOT = ""
    }
}

internal data class Hop(val scope: String, val from: String, val to: String)
