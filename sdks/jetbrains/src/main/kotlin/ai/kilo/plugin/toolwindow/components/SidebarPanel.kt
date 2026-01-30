package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.services.KiloStateService
import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloSpacing
import ai.kilo.plugin.toolwindow.KiloSizes
import com.intellij.openapi.Disposable
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import javax.swing.BorderFactory
import javax.swing.BoxLayout
import javax.swing.JPanel

/**
 * Right sidebar panel containing:
 * - VCS info panel (shows current git branch)
 * - Todo panel (only visible when incomplete todos exist)
 * - Future: MCP servers section, session stats
 * 
 * Responsive behavior (matching web client):
 * - Wide screens (>600px): Shows as inline panel (fixed 240px width)
 * - Narrow screens: Hidden by default, shows as overlay when toggled
 */
class SidebarPanel(
    private val stateService: KiloStateService
) : JPanel(BorderLayout()), Disposable {

    private val vcsInfoPanel = VcsInfoPanel(stateService)
    private val todoPanel = TodoPanel(stateService)

    init {
        val width = KiloSizes.sidebarWidth // 240px matching web client
        preferredSize = Dimension(width, 0)
        minimumSize = Dimension(width, 0)
        maximumSize = Dimension(width, Int.MAX_VALUE)

        isOpaque = true
        background = KiloTheme.backgroundStronger
        border = BorderFactory.createCompoundBorder(
            JBUI.Borders.customLine(KiloTheme.borderWeak, 0, 1, 0, 0),
            JBUI.Borders.empty(KiloSpacing.md)
        )

        // Content panel with vertical layout
        val contentPanel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
        }

        // Add VCS info panel (shows git branch)
        vcsInfoPanel.alignmentX = LEFT_ALIGNMENT
        contentPanel.add(vcsInfoPanel)

        // Add todo panel
        todoPanel.alignmentX = LEFT_ALIGNMENT
        contentPanel.add(todoPanel)

        // Future: Add MCP servers section here
        // Future: Add session stats section here

        add(contentPanel, BorderLayout.NORTH)
    }

    override fun dispose() {
        vcsInfoPanel.dispose()
        todoPanel.dispose()
    }
}
