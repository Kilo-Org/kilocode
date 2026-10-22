package ai.kilocode.client.session.views.base

import ai.kilocode.client.session.ui.style.SessionUiStyle.View.Header
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import java.awt.BorderLayout
import java.awt.Component
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * Shared session-card header. A [BorderLayout] row with a left group, an optional
 * flexible middle that absorbs remaining width and clips (e.g. a file path), and a
 * right group that hugs the trailing edge.
 *
 * The collapse/expand arrow is owned by [AbstractSessionPartView] and sits to the
 * right of this header, so together they realise the west (left) / center (right
 * group) / east (arrow) layout.
 *
 * All spacing comes from [Header]: [leading] applies the icon-to-title gap, while every
 * other element is separated by the universal [Header.gap]. Text labels center vertically
 * by default, so add them directly. Fixed-size controls (icons, badges, diff bars) must be
 * added via [centered] so they keep their preferred size and stay centered.
 */
class PartHeader : JPanel(BorderLayout(Header.gap(), 0)) {
    val left = Stack.horizontal(Header.gap())
    val right = Stack.horizontal(Header.gap())

    init {
        isOpaque = false
        add(left, BorderLayout.WEST)
        add(right, BorderLayout.EAST)
    }

    /** Adds the leading glyph and reserves the tighter icon-to-title gap before the title. */
    fun leading(icon: Component): PartHeader {
        left.next(icon).gap(Header.icon())
        return this
    }

    /** Reserves the larger title-to-elements gap before the next left element. */
    fun titleGap(): PartHeader {
        left.gap(Header.title())
        return this
    }

    fun left(vararg items: Component): PartHeader {
        items.forEach { left.next(it) }
        return this
    }

    fun right(vararg items: Component): PartHeader {
        items.forEach { right.next(it) }
        return this
    }

    /** Flexible middle that absorbs remaining width and clips its content. */
    fun fill(component: JComponent): PartHeader {
        add(component, BorderLayout.CENTER)
        return this
    }

    companion object {
        /** Wraps a fixed-size control so it keeps its preferred size and stays centered. */
        fun centered(component: Component): JComponent = component.align(HAlign.CENTER, VAlign.CENTER)
    }
}
