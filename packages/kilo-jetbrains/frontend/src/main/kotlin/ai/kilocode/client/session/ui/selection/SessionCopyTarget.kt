package ai.kilocode.client.session.ui.selection

import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JComponent

internal interface SessionCopyTarget {
    val copyAnchor: JComponent

    @RequiresEdt
    fun copyText(): String?
}
