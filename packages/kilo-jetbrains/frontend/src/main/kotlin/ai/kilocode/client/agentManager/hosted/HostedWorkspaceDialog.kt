package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.HostedWorkspaceProfileDto
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import java.awt.Component
import javax.swing.JComboBox
import javax.swing.JComponent

internal data class HostedCreatePlan(
    val prompt: String,
    val branch: String?,
    val profileID: String,
    val agent: String,
    val model: String,
)

internal class HostedWorkspaceDialog(
    parent: Component,
    private val repositoryUrl: String,
    private val profiles: List<HostedWorkspaceProfileDto>,
    private val agent: String,
    private val model: String,
    private val withWorkspace: Boolean,
) : DialogWrapper(parent, false) {
    private val branch = JBTextField().apply {
        emptyText.text = KiloBundle.message("hosted.workspace.dialog.branch.placeholder")
    }
    private val profile = JComboBox(profiles.map { it.name }.toTypedArray())
    private val prompt = JBTextArea(6, 48).apply {
        lineWrap = true
        wrapStyleWord = true
    }
    private val mode = JBTextField(agent)
    private val chosen = JBTextField(model)
    private var result: HostedCreatePlan? = null

    init {
        title = KiloBundle.message(if (withWorkspace) "hosted.workspace.dialog.create.title" else "hosted.workspace.dialog.session.title")
        init()
    }

    override fun createCenterPanel(): JComponent = FormBuilder.createFormBuilder()
        .addLabeledComponent(KiloBundle.message("hosted.workspace.dialog.repository"), JBTextField(repositoryUrl).apply { isEnabled = false })
        .apply {
            if (withWorkspace) {
                addLabeledComponent(KiloBundle.message("hosted.workspace.dialog.branch"), branch)
                addLabeledComponent(KiloBundle.message("hosted.workspace.dialog.profile"), profile)
            }
        }
        .addLabeledComponent(KiloBundle.message("hosted.workspace.dialog.prompt"), JBScrollPane(prompt))
        .addLabeledComponent(KiloBundle.message("hosted.workspace.dialog.agent"), mode)
        .addLabeledComponent(KiloBundle.message("hosted.workspace.dialog.model"), chosen)
        .panel

    override fun doValidate(): ValidationInfo? {
        if (prompt.text.isBlank()) return ValidationInfo(KiloBundle.message("hosted.workspace.dialog.prompt.required"), prompt)
        if (mode.text.isBlank()) return ValidationInfo(KiloBundle.message("hosted.workspace.dialog.agent.required"), mode)
        if (chosen.text.isBlank()) return ValidationInfo(KiloBundle.message("hosted.workspace.dialog.model.required"), chosen)
        if (withWorkspace && profiles.isEmpty()) return ValidationInfo(KiloBundle.message("hosted.workspace.dialog.profile.required"), profile)
        if (withWorkspace && profiles.none { it.id == selectedProfileID() }) {
            return ValidationInfo(KiloBundle.message("hosted.workspace.dialog.profile.invalid"), profile)
        }
        return null
    }

    override fun doOKAction() {
        val selected = if (withWorkspace) selectedProfileID() else ""
        result = HostedCreatePlan(
            prompt = prompt.text.trim(),
            branch = branch.text.trim().takeIf { withWorkspace && it.isNotBlank() },
            profileID = selected,
            agent = mode.text.trim(),
            model = chosen.text.trim(),
        )
        super.doOKAction()
    }

    fun plan(): HostedCreatePlan? = result

    private fun selectedProfileID(): String =
        profiles.getOrNull(profile.selectedIndex)?.id.orEmpty()
}
