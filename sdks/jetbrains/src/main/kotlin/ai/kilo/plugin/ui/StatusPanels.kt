package ai.kilo.plugin.ui

import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import java.awt.GridBagLayout
import javax.swing.SwingConstants

/**
 * Panel shown while the Kilo service is initializing.
 */
class LoadingPanel : JBPanel<LoadingPanel>(GridBagLayout()) {
    init {
        add(JBLabel("Starting Kilo1...", SwingConstants.CENTER))
    }
}

/**
 * Panel shown when the Kilo service fails to initialize.
 */
class ErrorPanel(message: String) : JBPanel<ErrorPanel>(GridBagLayout()) {
    init {
        add(JBLabel(message, SwingConstants.CENTER))
    }
}
