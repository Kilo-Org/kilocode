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

internal fun hoverPlaceholder(toolbar: JComponent): JComponent = object : JPanel() {
    init {
        isOpaque = false
    }

    override fun getPreferredSize(): Dimension = Dimension(toolbar.preferredSize)

    override fun getMinimumSize(): Dimension = Dimension(toolbar.minimumSize)

    override fun getMaximumSize(): Dimension = Dimension(toolbar.maximumSize)
}
