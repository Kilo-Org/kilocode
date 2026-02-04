package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.services.KiloAppState
import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloSpacing
import ai.kilo.plugin.toolwindow.KiloTypography
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest
import java.awt.FlowLayout
import java.awt.Font
import javax.swing.JPanel

/**
 * Panel displaying VCS (git) information.
 * Shows the current branch name with a git icon.
 * 
 * Matches the web client pattern of displaying branch info
 * in the format: branch-name
 */
class VcsInfoPanel(
    private val appState: KiloAppState
) : JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.xs, 0)), Disposable {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val branchLabel = JBLabel()

    init {
        isOpaque = false
        border = JBUI.Borders.empty(KiloSpacing.sm, 0)
        isVisible = false // Hidden by default until we have VCS info

        // Branch icon
        val icon = JBLabel(AllIcons.Vcs.Branch).apply {
            foreground = KiloTheme.textWeak
        }
        add(icon)

        // Branch name label
        branchLabel.apply {
            foreground = KiloTheme.textBase
            font = font.deriveFont(Font.PLAIN, KiloTypography.fontSizeSmall)
        }
        add(branchLabel)

        // Subscribe to VCS info
        subscribeToVcsInfo()
    }

    private fun subscribeToVcsInfo() {
        scope.launch {
            appState.vcsInfo.collectLatest { vcsInfo ->
                updateBranch(vcsInfo?.branch)
            }
        }
    }

    private fun updateBranch(branch: String?) {
        if (branch.isNullOrBlank()) {
            isVisible = false
        } else {
            branchLabel.text = branch
            branchLabel.toolTipText = "Current branch: $branch"
            isVisible = true
        }
        revalidate()
        repaint()
    }

    override fun dispose() {
        scope.cancel()
    }
}
