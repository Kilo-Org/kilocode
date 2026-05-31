package ai.kilocode.client.session.views.permission

import ai.kilocode.client.session.model.PermissionFileDiff
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.client.ui.UiStyle
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.FlowLayout

/**
 * Renders a single [PermissionFileDiff] inside a permission card as a compact diff-stat badge.
 * Patch content and file path are intentionally not displayed here; the permission target row
 * already shows the path.
 */
class PermissionDiffView(
    private val diff: PermissionFileDiff,
) : BorderLayoutPanel(), SessionEditorStyleTarget {

    private val badge = DiffStatBadge(diff.additions, diff.deletions)

    init {
        isOpaque = false

        val row = buildRow()
        addToCenter(row)
    }

    override fun applyStyle(style: SessionEditorStyle) {
        // Badge colors are theme-derived and update through Swing repainting.
    }

    private fun buildRow() = JBUI.Panels.simplePanel().apply {
        isOpaque = false
        border = JBUI.Borders.empty()

        val inner = object : javax.swing.JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)) {
            init { isOpaque = false }
        }
        inner.add(badge)
        addToCenter(inner)
    }

    // Test helpers
    internal fun badgeForTest() = badge
}
