package ai.kilocode.client.util

import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import javax.swing.JComponent
import javax.swing.SwingUtilities

/**
 * Refresh [roots] on Look-and-Feel changes. The subscription is tied to [parent], so it is removed
 * when the owning component is disposed. Replaces the copy/pasted `LafManagerListener` blocks that
 * each panel used to carry.
 */
internal fun bindTheme(parent: Disposable, vararg roots: JComponent) {
    val bus = ApplicationManager.getApplication().messageBus.connect(parent)
    bus.subscribe(LafManagerListener.TOPIC, LafManagerListener {
        ApplicationManager.getApplication().invokeLater {
            roots.forEach { SwingUtilities.updateComponentTreeUI(it) }
        }
    })
}
