package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Compaction
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.SessionStyle
import ai.kilocode.client.ui.UiStyle
import com.intellij.ui.components.JBLabel
import java.awt.BorderLayout
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import com.intellij.util.ui.JBDimension
import com.intellij.util.ui.JBUI
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
    private val text = JBLabel(KiloBundle.message("session.part.compaction")).apply {
        foreground = UiStyle.Colors.weak()
        horizontalAlignment = SwingConstants.CENTER
        border = JBUI.Borders.empty(0, UiStyle.Gap.regular())
    }

    init {
        layout = BorderLayout()
        isOpaque = false
        applyStyle(SessionStyle.current())

        val line = { JPanel().apply {
            background = UiStyle.Colors.line()
            isOpaque = true
            preferredSize = JBDimension(0, JBUI.scale(1))
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

    override fun applyStyle(style: SessionStyle) {
        if (text.font == style.smallUiFont) return
        text.font = style.smallUiFont
        revalidate()
        repaint()
    }

    override fun dumpLabel() = "CompactionView#$contentId"
}
