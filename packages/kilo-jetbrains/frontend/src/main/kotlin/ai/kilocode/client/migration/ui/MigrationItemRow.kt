package ai.kilocode.client.migration.ui

import ai.kilocode.client.migration.MigrationItemUiProgress
import ai.kilocode.client.migration.MigrationUiPhase
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.rpc.dto.MigrationItemCategoryDto
import ai.kilocode.rpc.dto.MigrationItemProgressStatusDto
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.CardLayout
import java.awt.Dimension
import javax.swing.JPanel

/**
 * A single row in the migration item list.
 * Shows a checkbox in [MigrationUiPhase.selecting] or a status icon otherwise.
 */
class MigrationItemRow(
    private val label: String,
    private val category: MigrationItemCategoryDto,
) : BorderLayoutPanel() {

    private val check = JBCheckBox()
    private val statusIcon = MigrationStatusIcon()
    private val nameLabel = JBLabel(label)
    private val messageLabel = JBLabel().apply {
        foreground = UiStyle.Colors.weak()
        border = JBUI.Borders.emptyLeft(UiStyle.Gap.sm())
    }
    private val leading = LeadingSlot(check, statusIcon)

    private val row = Stack.horizontal(gap = UiStyle.Gap.sm())
        .next(leading)
        .next(nameLabel)
        .next(messageLabel)

    var selected: Boolean
        get() = check.isSelected
        set(v) { check.isSelected = v }

    var onSelectionChanged: ((Boolean) -> Unit)? = null

    init {
        isOpaque = false
        border = JBUI.Borders.emptyBottom(UiStyle.Gap.xs())

        check.isOpaque = false
        check.addActionListener { onSelectionChanged?.invoke(check.isSelected) }
        statusIcon.update(MigrationItemProgressStatusDto.migrating)

        addToCenter(row)
    }

    fun updatePhase(phase: MigrationUiPhase) {
        leading.display(phase == MigrationUiPhase.selecting)
    }

    fun updateProgress(progress: MigrationItemUiProgress?) {
        if (progress == null) {
            statusIcon.update(MigrationItemProgressStatusDto.migrating)
            messageLabel.text = null
            return
        }
        statusIcon.update(progress.status)
        messageLabel.text = progress.message
    }

    private class LeadingSlot(
        private val check: JBCheckBox,
        icon: MigrationStatusIcon,
    ) : JPanel(CardLayout()) {

        private var size: Dimension? = null

        init {
            isOpaque = false
            add(check, SELECT)
            add(icon.align(HAlign.CENTER, VAlign.CENTER), STATUS)
        }

        fun display(selecting: Boolean) {
            (layout as CardLayout).show(this, if (selecting) SELECT else STATUS)
        }

        override fun updateUI() {
            size = null
            super.updateUI()
        }

        override fun getMinimumSize(): Dimension = stableSize()

        override fun getPreferredSize(): Dimension = stableSize()

        override fun getMaximumSize(): Dimension = stableSize()

        private fun stableSize(): Dimension {
            val cached = size
            if (cached != null) return Dimension(cached)

            val dim = check.preferredSize
            size = Dimension(dim)
            return Dimension(dim)
        }

        private companion object {
            const val SELECT = "select"
            const val STATUS = "status"
        }
    }
}
