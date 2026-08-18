package ai.kilocode.client.session.ui.selection

import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Dimension
import javax.swing.JComponent
import javax.swing.JPanel

internal interface SessionCopyTarget {
    val copyEligible: Boolean get() = true

    val copyAnchor: JComponent

    val copyToolbar: JComponent? get() = null

    @RequiresEdt
    fun copyText(): String?
}

/**
 * Reserves the trailing hover-action button's *width* in a card header so header content never sits
 * under the button, without reserving its height. The button is a hover overlay, so letting it
 * dictate the header height would make action cards (edit, modified files) taller than plain cards.
 * Added to a horizontal header [ai.kilocode.client.ui.layout.Stack] uncentered, it stretches to the
 * row height at layout; the zero preferred height marks it as an inline anchor so the overlay
 * vertically centers the button on the header row (aligned with the change badge).
 */
internal fun hoverPlaceholder(toolbar: JComponent): JComponent = object : JPanel() {
    init {
        isOpaque = false
    }

    override fun getPreferredSize(): Dimension = Dimension(toolbar.preferredSize.width, 0)

    override fun getMinimumSize(): Dimension = Dimension(toolbar.minimumSize.width, 0)

    override fun getMaximumSize(): Dimension = Dimension(toolbar.maximumSize.width, Int.MAX_VALUE)
}
