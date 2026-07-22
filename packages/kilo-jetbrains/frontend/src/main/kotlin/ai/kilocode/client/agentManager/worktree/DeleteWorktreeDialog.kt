package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.FormBuilder
import com.intellij.util.ui.UIUtil
import java.awt.Component
import javax.swing.JComponent

/**
 * Delete-worktree confirmation. For a locked worktree it explains the lock reason and requires an
 * explicit "force" acknowledgement checkbox before the OK button is enabled, so a lock (e.g. an
 * active agent worktree) can't be blown away by a single reflexive confirm.
 */
internal class DeleteWorktreeDialog(
    parent: Component,
    private val item: WorktreeDto,
) : DialogWrapper(parent, false) {
    private val force = JBCheckBox(KiloBundle.message("worktree.delete.force"))

    init {
        title = KiloBundle.message("worktree.delete.confirm.title")
        init()
        initValidation()
    }

    override fun createCenterPanel(): JComponent {
        val builder = FormBuilder.createFormBuilder()
            .addComponent(JBLabel(KiloBundle.message("worktree.delete.confirm.message", item.name)))
        if (item.locked) {
            val reason = item.lockReason?.let { KiloBundle.message("worktree.delete.locked.reason", it) }
                ?: KiloBundle.message("worktree.delete.locked")
            builder.addComponent(JBLabel(reason).apply { foreground = UIUtil.getContextHelpForeground() })
            builder.addComponent(force)
        }
        return builder.panel
    }

    override fun doValidate(): ValidationInfo? =
        if (item.locked && !force.isSelected) ValidationInfo(KiloBundle.message("worktree.delete.force.required"), force)
        else null

    /** True when the user confirmed force-removing a locked worktree. */
    val forceRequested: Boolean get() = item.locked && force.isSelected
}
