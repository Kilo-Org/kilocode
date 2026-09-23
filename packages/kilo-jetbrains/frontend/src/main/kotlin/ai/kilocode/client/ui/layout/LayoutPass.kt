package ai.kilocode.client.ui.layout

import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Container
import java.awt.Dimension
import java.util.IdentityHashMap

internal const val MIN = 0
internal const val PREF = 1
internal const val MAX = 2

/**
 * A scoped size memo for [Stack] and [Align].
 *
 * Swing caches a container's sizes only while the container is valid. Both layouts ask each child for its
 * minimum, preferred and maximum size, so on an invalid tree every nesting level triples the work below it. A
 * list renderer is exactly that tree: one stamp, invalidated wholesale before every row it paints, measured and
 * laid out again for each paint and hit test.
 *
 * Inside [measure], each Stack and Align answers each kind of size once per container and container size. An
 * answer is dropped when the container is resized (both layouts probe children with the space they are given,
 * so a size can depend on it) or when Swing invalidates the container through `invalidateLayout`, and outside
 * [measure] nothing is cached at all.
 *
 * Wrap only a single top-down layout or measuring pass that does not change the content being measured: a
 * content change below a container that is already invalid does not reach it, so its answer would go stale.
 */
object LayoutPass {
    private var memo: IdentityHashMap<Container, Slot>? = null

    @RequiresEdt
    fun <T> measure(block: () -> T): T {
        if (memo != null) return block()
        memo = IdentityHashMap()
        try {
            return block()
        } finally {
            memo = null
        }
    }

    internal fun size(parent: Container, kind: Int, compute: () -> Dimension): Dimension {
        val map = memo ?: return compute()
        val hit = map[parent]?.takeIf { it.width == parent.width && it.height == parent.height }?.sizes?.get(kind)
        if (hit != null) return Dimension(hit)
        val out = compute()
        // Computing may have resized or invalidated [parent] (a probe resizes a child), so the slot is keyed by
        // the size [parent] has now, which is the state the answer was computed from.
        val slot = map[parent]?.takeIf { it.width == parent.width && it.height == parent.height }
            ?: Slot(parent.width, parent.height).also { map[parent] = it }
        slot.sizes[kind] = Dimension(out)
        return out
    }

    internal fun forget(parent: Container) {
        memo?.remove(parent)
    }

    private class Slot(val width: Int, val height: Int) {
        val sizes = arrayOfNulls<Dimension>(3)
    }
}
