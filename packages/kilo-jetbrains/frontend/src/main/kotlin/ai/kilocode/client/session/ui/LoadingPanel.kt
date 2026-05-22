package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.Centerizer
import java.awt.BorderLayout
import javax.swing.JPanel

class LoadingPanel : JPanel(BorderLayout()), SessionEditorStyleTarget {
    private val label = JBLabel(KiloBundle.message("session.empty.loading"))

    init {
        isOpaque = false
        add(Centerizer(label, Centerizer.TYPE.BOTH), BorderLayout.CENTER)
        applyStyle(SessionEditorStyle.current())
    }

    override fun applyStyle(style: SessionEditorStyle) {
        label.font = style.uiFont
        revalidate()
        repaint()
    }
}
