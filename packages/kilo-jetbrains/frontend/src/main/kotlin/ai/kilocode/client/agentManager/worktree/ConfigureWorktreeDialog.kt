package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import java.awt.Component
import javax.swing.JComponent

/**
 * Advanced "new worktree" dialog: lets the user set the new branch name and the base branch. Base
 * is free-text because the plugin has no branch-listing RPC; it defaults to the main worktree branch.
 */
internal class ConfigureWorktreeDialog(
    parent: Component,
    defaultBase: String,
) : DialogWrapper(parent, false) {
    private val name = JBTextField()
    private val base = JBTextField(defaultBase)

    init {
        title = KiloBundle.message("worktree.configure.title")
        init()
    }

    override fun createCenterPanel(): JComponent = FormBuilder.createFormBuilder()
        .addLabeledComponent(KiloBundle.message("worktree.configure.branch"), name)
        .addLabeledComponent(KiloBundle.message("worktree.configure.base"), base)
        .panel

    override fun getPreferredFocusedComponent(): JComponent = name

    override fun doValidate(): ValidationInfo? =
        if (name.text.isBlank()) ValidationInfo(KiloBundle.message("worktree.configure.branch.required"), name) else null

    val branch: String get() = name.text.trim()
    val baseBranch: String? get() = base.text.trim().takeIf { it.isNotEmpty() }
}
