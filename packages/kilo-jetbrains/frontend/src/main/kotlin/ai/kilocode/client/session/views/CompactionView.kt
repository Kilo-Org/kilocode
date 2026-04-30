package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Compaction
import ai.kilocode.client.session.model.Content
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import javax.swing.JPanel
import javax.swing.SwingConstants

/**
 * Renders a [Compaction] part as a horizontal divider with a centred label,
 * mirroring VS Code's compaction marker.
 *
 * Layout:
 * ```
 *  ─────────────  context compacted  ─────────────
 * ```
 */
class CompactionView(@Suppress("UNUSED_PARAMETER") compaction: Compaction) : PartView() {

    override val contentId: String = compaction.id

    init {
        layout = BorderLayout()
        isOpaque = false
        border = JBUI.Borders.empty(JBUI.scale(6), 0)

        val text = JBLabel("context compacted").apply {
            foreground = UIUtil.getContextHelpForeground()
            font = JBUI.Fonts.smallFont()
            horizontalAlignment = SwingConstants.CENTER
            border = JBUI.Borders.empty(0, JBUI.scale(8))
        }

        val line = { JPanel().apply {
            background = JBColor.border()
            isOpaque = true
            preferredSize = java.awt.Dimension(0, JBUI.scale(1))
        } }

        val row = JPanel(GridBagLayout()).apply {
            isOpaque = false
            val gc = GridBagConstraints()

            gc.fill = GridBagConstraints.HORIZONTAL
            gc.weightx = 1.0
            add(line(), gc)

            gc.weightx = 0.0
            gc.fill = GridBagConstraints.NONE
            add(text, gc)

            gc.fill = GridBagConstraints.HORIZONTAL
            gc.weightx = 1.0
            add(line(), gc)
        }

        add(row, BorderLayout.CENTER)
    }

    override fun update(content: Content) {}  // compaction has no mutable state

    override fun dumpLabel() = "CompactionView#$contentId"
}
