package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.agentManager.AgentManagerDialog
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.HostedFailureDto
import ai.kilocode.rpc.dto.HostedProfileDefaultDto
import ai.kilocode.rpc.dto.HostedWorkspaceProfileDto
import ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.ui.HyperlinkLabel
import com.intellij.ui.SimpleListCellRenderer
import com.intellij.ui.components.JBTextField
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.FormBuilder
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.launch
import java.awt.Component
import java.awt.GridBagConstraints
import javax.swing.JComponent

internal data class HostedCreatePlan(
    val prompt: String,
    val branch: String?,
    val profileID: String?,
    val agent: String,
    val model: String,
    val variant: String?,
)

internal class HostedWorkspaceDialog @RequiresEdt constructor(
    parent: Component,
    project: Project,
    directory: String,
    private val repositoryUrl: String,
    private val profiles: HostedWorkspaceProfileListDto,
    private val withWorkspace: Boolean,
    branch: String = "",
    app: KiloAppService = service(),
    workspaces: KiloWorkspaceService = service(),
    private val saveDefault: (suspend (String) -> HostedProfileDefaultDto)? = null,
) : AgentManagerDialog(parent, project, directory, false, app, workspaces) {
    private object None

    override val allowEmptyPrompt: Boolean get() = withWorkspace

    private val branch = JBTextField(branch).apply {
        emptyText.text = KiloBundle.message("hosted.workspace.dialog.branch.placeholder")
    }
    private val repository = ComboBox(arrayOf(hostedRepositoryName(repositoryUrl)))
    private var personalDefaultProfileID = profiles.personalDefaultProfileID
    private val initialProfile = defaultProfile()
    private val profile = ComboBox((listOf(None) + profiles.items).toTypedArray()).apply {
        renderer = SimpleListCellRenderer.create("") {
            when (it) {
                None -> KiloBundle.message("hosted.workspace.dialog.profile.none")
                is HostedWorkspaceProfileDto -> profileLabel(it)
                else -> ""
            }
        }
        selectedItem = initialProfile ?: None
    }
    private val useDefault = HyperlinkLabel(KiloBundle.message("hosted.workspace.dialog.profile.useDefault")).apply {
        addHyperlinkListener {
            defaultProfile()?.let { profile.selectedItem = it }
        }
    }
    private val setDefault = HyperlinkLabel(KiloBundle.message("hosted.workspace.dialog.profile.setDefault")).apply {
        addHyperlinkListener {
            val selected = profile.selectedItem as? HostedWorkspaceProfileDto ?: return@addHyperlinkListener
            if (!isEnabled || savingDefault) return@addHyperlinkListener
            savingDefault = true
            syncDefaultLinks()
            scope.launch {
                val result = runCatching { saveDefaultValue(selected.id) }.getOrElse {
                    HostedProfileDefaultDto(failure = HostedFailureDto("unavailable", it.message.orEmpty(), retryable = true))
                }
                ApplicationManager.getApplication().invokeLater {
                    if (isDisposed) return@invokeLater
                    savingDefault = false
                    if (result.success) {
                        personalDefaultProfileID = selected.id
                    } else {
                        setErrorText(
                            result.failure?.message
                                ?: KiloBundle.message("hosted.workspace.dialog.profile.default.failed"),
                        )
                    }
                    syncDefaultLinks()
                }
            }
        }
    }
    private var savingDefault = false
    private var result: HostedCreatePlan? = null

    init {
        title = KiloBundle.message(if (withWorkspace) "hosted.workspace.dialog.create.title" else "hosted.workspace.dialog.session.title")
        init()
        initValidation()
        prompt.onChange = { syncValidation() }
        profile.addActionListener {
            syncValidation()
            syncDefaultLinks()
        }
        syncDefaultLinks()
        syncValidation()
        setOKButtonText(KiloBundle.message(if (withWorkspace) "hosted.workspace.dialog.create" else "hosted.workspace.session.new"))
    }

    override fun syncValidation() {
        setOKActionEnabled(doValidate() == null)
    }

    override fun doValidate(): ValidationInfo? = when {
        !allowEmptyPrompt && prompt.text().isEmpty() ->
            ValidationInfo(KiloBundle.message("hosted.workspace.dialog.prompt.required"), prompt)
        pending()?.let { it.agent == null || it.model == null || it.provider != "kilo" } ?: true ->
            ValidationInfo(KiloBundle.message("hosted.workspace.create.noModel"), prompt)
        !withWorkspace -> null
        profile.selectedItem !== None && profile.selectedItem as? HostedWorkspaceProfileDto !in profiles.items ->
            ValidationInfo(KiloBundle.message("hosted.workspace.dialog.profile.invalid"), profile)
        else -> null
    }

    override fun createCenterPanel(): JComponent {
        val fields = object : FormBuilder() {
            override fun getFill(component: JComponent) = GridBagConstraints.HORIZONTAL
        }.apply {
            addLabeledComponent(KiloBundle.message("hosted.workspace.dialog.repository"), repository)
            if (withWorkspace) {
                addLabeledComponent(KiloBundle.message("hosted.workspace.dialog.branch"), branch)
                addLabeledComponent(
                    KiloBundle.message("hosted.workspace.dialog.profile"),
                    BorderLayoutPanel().addToCenter(profile).addToRight(
                        Stack.horizontal(gap = UiStyle.Gap.pad()).next(useDefault).next(setDefault),
                    ),
                )
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
            setErrorText(KiloBundle.message("hosted.workspace.create.noModel"), prompt)
            return
        }
        val mode = picked.agent
        val model = picked.model
        if (mode == null || model == null || picked.provider != "kilo") {
            setErrorText(KiloBundle.message("hosted.workspace.create.noModel"), prompt)
            return
        }
        val selected = profile.selectedItem as? HostedWorkspaceProfileDto
        if (withWorkspace && profile.selectedItem !== None && selected !in profiles.items) {
            setErrorText(KiloBundle.message("hosted.workspace.dialog.profile.invalid"), profile)
            return
        }
        result = HostedCreatePlan(
            prompt = picked.text,
            branch = branch.text.trim().takeIf { withWorkspace && it.isNotBlank() },
            profileID = selected?.id.takeIf { withWorkspace },
            agent = mode,
            model = "${picked.provider}/$model",
            variant = picked.variant,
        )
        close(OK_EXIT_CODE)
    }

    fun plan(): HostedCreatePlan? = result

    internal fun validationForTest(): ValidationInfo? = doValidate()

    private fun syncDefaultLinks() {
        val selected = profile.selectedItem as? HostedWorkspaceProfileDto
        val default = defaultProfile()
        val current = selected != null && personalDefault(selected)
        setDefault.isVisible = withWorkspace
        setDefault.isEnabled =
            withWorkspace && selected != null && selected.ownerType != "organization" && !current && !savingDefault
        useDefault.isVisible = withWorkspace && default != null && selected?.id != default.id
        useDefault.isEnabled = useDefault.isVisible
        profile.repaint()
    }

    private fun profileLabel(profile: HostedWorkspaceProfileDto): String = when {
        personalDefault(profile) -> KiloBundle.message("hosted.workspace.dialog.profile.personalDefault", profile.name)
        organizationDefault(profile) ->
            KiloBundle.message("hosted.workspace.dialog.profile.organizationDefault", profile.name)
        else -> profile.name
    }

    private fun defaultProfile(): HostedWorkspaceProfileDto? =
        personalDefault()
            ?: organizationDefault()
            ?: profiles.effectiveDefaultProfileID?.let(::profileByID)
            ?: profiles.items.find { it.isDefault }

    private fun personalDefault(): HostedWorkspaceProfileDto? =
        personalDefaultProfileID?.let(::profileByID) ?: profiles.items.find { it.isPersonalDefault }

    private fun organizationDefault(): HostedWorkspaceProfileDto? =
        profiles.organizationDefaultProfileID?.let(::profileByID) ?: profiles.items.find { it.isOrganizationDefault }

    private fun personalDefault(profile: HostedWorkspaceProfileDto): Boolean = personalDefault()?.id == profile.id

    private fun organizationDefault(profile: HostedWorkspaceProfileDto): Boolean =
        organizationDefault()?.id == profile.id

    private fun profileByID(id: String): HostedWorkspaceProfileDto? = profiles.items.find { it.id == id }

    private suspend fun saveDefaultValue(profileID: String): HostedProfileDefaultDto =
        saveDefault?.invoke(profileID) ?: project.service<KiloHostedService>().setDefaultProfile(profileID)
}
