package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.agentManager.AgentManagerDialog
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.HostedWorkspaceProfileDto
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.ui.SimpleListCellRenderer
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Component
import java.awt.GridBagConstraints
import javax.swing.JComponent

internal data class HostedCreatePlan(
    val prompt: String,
    val branch: String?,
    val profileID: String,
    val agent: String,
    val model: String,
    val variant: String?,
)

internal class HostedWorkspaceDialog @RequiresEdt constructor(
    parent: Component,
    project: Project,
    directory: String,
    private val repositoryUrl: String,
    private val profiles: List<HostedWorkspaceProfileDto>,
    private val withWorkspace: Boolean,
    branch: String = "",
    app: KiloAppService = service(),
    workspaces: KiloWorkspaceService = service(),
) : AgentManagerDialog(parent, project, directory, false, app, workspaces) {
    private val branch = JBTextField(branch).apply {
        emptyText.text = KiloBundle.message("hosted.workspace.dialog.branch.placeholder")
    }
    private val repository = ComboBox(arrayOf(hostedRepositoryName(repositoryUrl)))
    private val profile = ComboBox(profiles.toTypedArray()).apply {
        renderer = SimpleListCellRenderer.create("") { it.name }
    }
    private var result: HostedCreatePlan? = null

    init {
        title = KiloBundle.message(if (withWorkspace) "hosted.workspace.dialog.create.title" else "hosted.workspace.dialog.session.title")
        init()
        setOKButtonText(KiloBundle.message(if (withWorkspace) "hosted.workspace.dialog.create" else "hosted.workspace.session.new"))
    }

    override fun createCenterPanel(): JComponent {
        val fields = object : FormBuilder() {
            override fun getFill(component: JComponent) = GridBagConstraints.HORIZONTAL
        }.apply {
            addLabeledComponent(KiloBundle.message("hosted.workspace.dialog.repository"), repository)
            if (withWorkspace) {
                addLabeledComponent(KiloBundle.message("hosted.workspace.dialog.branch"), branch)
                addLabeledComponent(KiloBundle.message("hosted.workspace.dialog.profile"), profile)
            }
        }.panel
        return content(null, fields)
    }

    override fun getPreferredFocusedComponent(): JComponent = prompt.defaultFocusedComponent

    override fun getDimensionServiceKey(): String = "ai.kilocode.HostedWorkspaceDialog.v2"

    override fun doOKAction() = submitCreate(prompt.text())

    override fun submitCreate(text: String) {
        setErrorText(null)
        val picked = pending(text)
        if (picked == null) {
            setErrorText(KiloBundle.message("hosted.workspace.dialog.prompt.required"), prompt)
            return
        }
        val mode = picked.agent
        val model = picked.model
        if (mode == null || model == null || picked.provider != "kilo") {
            setErrorText(KiloBundle.message("hosted.workspace.create.noModel"), prompt)
            return
        }
        val selected = profile.selectedItem as? HostedWorkspaceProfileDto
        if (withWorkspace && (selected == null || selected !in profiles)) {
            setErrorText(KiloBundle.message("hosted.workspace.dialog.profile.required"), profile)
            return
        }
        result = HostedCreatePlan(
            prompt = picked.text,
            branch = branch.text.trim().takeIf { withWorkspace && it.isNotBlank() },
            profileID = selected?.id.orEmpty(),
            agent = mode,
            model = "${picked.provider}/$model",
            variant = picked.variant,
        )
        close(OK_EXIT_CODE)
    }

    fun plan(): HostedCreatePlan? = result
}
