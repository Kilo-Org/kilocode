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

    /**
     * Registers a nested scope. Returns false when the nesting would create a cycle — re-opening a
     * composite inside itself, as in `state A { state A { ... } }`. A cycle here is unrecoverable
     * rather than ugly: [path] and the recursive scope layout both walk these links outside any
     * suspend point, so the render timeout could never break the loop.
     */
    fun open(id: String, parent: String): Boolean {
        if (id == parent) return false
        var cur = parent
        while (cur != ROOT) {
            if (cur == id) return false
            cur = parents[cur] ?: ROOT
        }
        parents[id] = parent
        claim(id, parent)
        return true
    }

    fun claim(node: String, scope: String) {
        if (!owner.containsKey(node)) owner[node] = scope
    }

    fun has(node: String) = owner.containsKey(node)

    fun resolve(from: String, to: String): Hop {
        val fp = path(owner[from] ?: ROOT)
        val tp = path(owner[to] ?: ROOT)
        var common = 0
        while (common < fp.size && common < tp.size && fp.getOrNull(common) == tp.getOrNull(common)) common++
        val lca = fp.getOrNull(common - 1) ?: ROOT
        val a = fp.getOrNull(common) ?: from
        val b = tp.getOrNull(common) ?: to
        return Hop(lca, a, b)
    }

    private fun path(scope: String): List<String> {
        val out = ArrayDeque<String>()
        val seen = mutableSetOf<String>()
        var cur = scope
        while (seen.add(cur)) {
            out.addFirst(cur)
            if (cur == ROOT) break
            cur = parents[cur] ?: ROOT
        }
        return out.toList()
    }

    companion object {
        const val ROOT = ""
    }
}

internal data class Hop(val scope: String, val from: String, val to: String)
