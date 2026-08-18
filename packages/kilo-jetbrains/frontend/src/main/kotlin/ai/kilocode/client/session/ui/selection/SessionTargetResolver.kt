package ai.kilocode.client.session.ui.selection

import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Component
import java.awt.Container
import java.awt.Point
import javax.swing.JComponent
import javax.swing.SwingUtilities

internal object SessionTargetResolver {
    @RequiresEdt
    fun target(root: JComponent, src: Component, point: Point, skip: Component? = null): Component? {
        if (!inside(root, src)) return null
        val pt = SwingUtilities.convertPoint(src, point, root)
        if (!root.contains(pt)) return null
        val deep = deepest(root, pt, skip) ?: src
        return provider(root, deep) ?: deep
    }

    @RequiresEdt
    fun copy(root: JComponent, src: Component, point: Point, skip: Component? = null): SessionCopyTarget? {
        if (!inside(root, src)) return null
        val pt = SwingUtilities.convertPoint(src, point, root)
        if (!root.contains(pt)) return null
        return copy(root, deepest(root, pt, skip) ?: src)
    }

    @RequiresEdt
    internal fun inside(root: JComponent, comp: Component): Boolean = comp === root || SwingUtilities.isDescendingFrom(comp, root)

    @RequiresEdt
    private fun deepest(root: JComponent, pt: Point, skip: Component?): Component? {
        if (skip == null || !skip.isVisible) {
            return SwingUtilities.getDeepestComponentAt(root, pt.x, pt.y)?.takeIf { inside(root, it) }
        }
        return deepestSkipping(root, pt, skip)
    }

    @RequiresEdt
    private fun deepestSkipping(container: Container, pt: Point, skip: Component): Component? {
        for (child in container.components.toList().asReversed()) {
            if (child === skip || SwingUtilities.isDescendingFrom(child, skip)) continue
            if (!child.isVisible || !child.contains(SwingUtilities.convertPoint(container, pt, child))) continue
            if (child is Container) {
                val next = deepestSkipping(child, SwingUtilities.convertPoint(container, pt, child), skip)
                if (next != null) return next
            }
            return child
        }
        return if (container === skip) null else container
    }

    @RequiresEdt
    private fun provider(root: JComponent, comp: Component): Component? {
        var current: Component? = comp
        while (current != null && inside(root, current)) {
            if (current is UiDataProvider) return current
            current = current.parent
        }
        return null
    }

    @RequiresEdt
    private fun copy(root: JComponent, comp: Component): SessionCopyTarget? {
        var current: Component? = comp
        val targets = mutableListOf<SessionCopyTarget>()
        while (current != null && inside(root, current)) {
            if (current is SessionCopyTarget && current.copyEligible) targets.add(current)
            current = current.parent
        }
        val toolbar = targets.indexOfFirst { it.copyToolbar != null }
        if (toolbar > 0) return targets.take(toolbar).firstOrNull { it.copyToolbar == null }
        return targets.lastOrNull()
    }
}
