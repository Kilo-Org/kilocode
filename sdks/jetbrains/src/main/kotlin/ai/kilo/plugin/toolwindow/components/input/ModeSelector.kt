package ai.kilo.plugin.toolwindow.components.input

import ai.kilo.plugin.toolwindow.KiloTheme
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.Cursor
import java.awt.FlowLayout
import java.awt.Font
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JLabel
import javax.swing.JMenuItem
import javax.swing.JPanel
import javax.swing.JPopupMenu

private val modeNames = listOf("Code", "Architect", "Ask", "Debug")

class ModeSelector : JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)) {

    private var selectedMode = modeNames[0]
    private val modeLabel = JBLabel("$selectedMode ▾").apply {
        foreground = KiloTheme.textWeak
        font = font.deriveFont(13f)
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    init {
        isOpaque = false
        add(modeLabel)

        modeLabel.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                showModePopup()
            }
            override fun mouseEntered(e: MouseEvent) {
                modeLabel.foreground = KiloTheme.textInteractive
            }
            override fun mouseExited(e: MouseEvent) {
                modeLabel.foreground = KiloTheme.textWeak
            }
        })
    }

    private fun showModePopup() {
        val popup = JPopupMenu().apply {
            add(JLabel("  Mode").apply {
                font = font.deriveFont(Font.BOLD)
                border = JBUI.Borders.empty(8, 8, 4, 8)
            })
            addSeparator()

            for (mode in modeNames) {
                add(JMenuItem(mode).apply {
                    if (mode == selectedMode) {
                        icon = AllIcons.Actions.Checked
                    }
                    addActionListener {
                        selectedMode = mode
                        modeLabel.text = "$mode ▾"
                    }
                })
            }
        }
        popup.show(modeLabel, 0, -popup.preferredSize.height)
    }

    fun getSelectedMode(): String = selectedMode
}
