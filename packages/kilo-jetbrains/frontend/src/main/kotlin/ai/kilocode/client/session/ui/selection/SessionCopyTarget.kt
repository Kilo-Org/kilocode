package ai.kilocode.client.session.ui.selection

import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JComponent

internal interface SessionCopyTarget {
    val copyEligible: Boolean get() = true

    val copyAnchor: JComponent

    val copyToolbar: JComponent? get() = null

    @RequiresEdt
    fun copyText(): String?
}
