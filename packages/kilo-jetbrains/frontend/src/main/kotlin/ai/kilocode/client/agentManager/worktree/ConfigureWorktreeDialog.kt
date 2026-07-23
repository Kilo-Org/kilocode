package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import java.awt.Component
import java.awt.event.FocusAdapter
import java.awt.event.FocusEvent
import javax.swing.DefaultComboBoxModel
import javax.swing.JComponent

/**
 * Advanced "new worktree" dialog: the branch name is pre-filled with a generated suggestion
 * (focused and selected so it can be typed over), and the base branch is an editable picker seeded
 * with the repo's local branches (still free-text for any ref the plugin can't enumerate).
 */
internal class ConfigureWorktreeDialog(
    parent: Component,
    suggestedName: String,
    defaultBase: String,
    branches: List<String>,
) : DialogWrapper(parent, false) {
    private val name = JBTextField(suggestedName, 35).apply {
        addFocusListener(object : FocusAdapter() {
            override fun focusGained(e: FocusEvent) {
                selectAll()
                removeFocusListener(this)
            }
        })
    }

    private val base = ComboBox(baseModel(branches, defaultBase)).apply {
        isEditable = true
        selectedItem = defaultBase
    }

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
    val baseBranch: String? get() = base.editor.item?.toString()?.trim()?.takeIf { it.isNotEmpty() }

    private fun baseModel(branches: List<String>, default: String): DefaultComboBoxModel<String> {
        val ordered = LinkedHashSet<String>()
        if (default.isNotBlank()) ordered.add(default)
        ordered.addAll(branches)
        return DefaultComboBoxModel(ordered.toTypedArray())
    }
}
