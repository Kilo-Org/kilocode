package ai.kilocode.client.ui.tree

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.active.activeIconGap
import com.intellij.ui.tree.ui.Control
import com.intellij.ui.tree.ui.DefaultControl
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Graphics

/**
 * Keeps a tree row on the same compact cell grid as a list row. The selection frame starts at the
 * row cell, the arrow sits one shared content inset inside it, and only one compact native step is
 * added per child level.
 */
object ActiveTreePainter : Control.Painter {
    private fun contentInset() = JBUI.scale(UiStyle.Gap.LG)

    private fun iconGap() = JBUI.scale(activeIconGap())

    /** One compact step for every level above the root, relative to the tree content edge. */
    fun step(depth: Int): Int =
        if (depth <= 0) 0
        else Control.Painter.COMPACT.getRendererOffset(DefaultControl(), depth, true) -
            Control.Painter.COMPACT.getRendererOffset(DefaultControl(), 1, true)

    override fun getRendererOffset(control: Control, depth: Int, leaf: Boolean): Int = when {
        depth <= 0 -> 0
        leaf -> step(depth)
        else -> step(depth) + control.width + iconGap()
    }

    override fun getControlOffset(control: Control, depth: Int, leaf: Boolean): Int =
        if (depth <= 0 || leaf) -1 else step(depth) + contentInset()

    override fun paint(
        c: Component, g: Graphics, x: Int, y: Int, width: Int, height: Int,
        control: Control, depth: Int, leaf: Boolean, expanded: Boolean, selected: Boolean,
    ) {
        val offset = getControlOffset(control, depth, leaf)
        if (offset < 0) return
        control.paint(c, g, x + offset, y, control.width, height, expanded, selected)
    }
}
