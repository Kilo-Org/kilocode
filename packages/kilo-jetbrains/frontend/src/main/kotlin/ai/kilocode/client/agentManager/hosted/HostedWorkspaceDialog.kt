package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.agentManager.AgentManagerDialog
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.HostedWorkspaceProfileDto
import ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.ui.HyperlinkLabel
import com.intellij.ui.SimpleListCellRenderer
import com.intellij.ui.components.JBTextField
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.FormBuilder
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.awt.Component
import java.awt.GridBagConstraints
import javax.swing.DefaultComboBoxModel
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
    branch: String = "",
    app: KiloAppService = service(),
    workspaces: KiloWorkspaceService = service(),
    private val load: suspend () -> HostedWorkspaceProfileListDto = { project.service<KiloHostedService>().profiles() },
    private val selection: HostedProfileSelectionStore = service<HostedProfileSelectionService>(),
) : AgentManagerDialog(parent, project, directory, false, app, workspaces) {
    private object None
    private object Loading
    private object Failed

    // An empty prompt creates an empty workspace; sessions are created from the editor instead.
    override val allowEmptyPrompt: Boolean get() = true

    private val branch = JBTextField(branch).apply {
        emptyText.text = KiloBundle.message("hosted.workspace.dialog.branch.placeholder")
    }
    private val repository = ComboBox(arrayOf(hostedRepositoryName(repositoryUrl)))
    private var profiles = HostedWorkspaceProfileListDto()
    private var loading = true
    override val ready: Boolean get() = super.ready && !loading && profiles.error == null
    private val profile = ComboBox<Any>(arrayOf(Loading)).apply {
        renderer = SimpleListCellRenderer.create("") {
            when (it) {
                None -> KiloBundle.message("hosted.workspace.dialog.profile.none")
                Loading -> KiloBundle.message("hosted.workspace.dialog.profile.loading")
                Failed -> KiloBundle.message("hosted.workspace.profiles.failed")
                is HostedWorkspaceProfileDto -> profileLabel(it)
                else -> ""
            }
        }
        isEnabled = false
    }
    private val useDefault = HyperlinkLabel(KiloBundle.message("hosted.workspace.dialog.profile.useDefault")).apply {
        addHyperlinkListener {
            defaultProfile()?.let { profile.selectedItem = it }
        }
    }
    private var result: HostedCreatePlan? = null

    init {
        title = KiloBundle.message("hosted.workspace.dialog.create.title")
        init()
        initValidation()
        prompt.onChange = { syncValidation() }
        profile.addActionListener {
            syncValidation()
            syncUseDefault()
        }
        syncUseDefault()
        syncValidation()
        setOKButtonText(KiloBundle.message("hosted.workspace.dialog.create"))
        scope.launch {
            val loaded = load()
            val remembered = if (loaded.error == null) {
                try {
                    selection.selected(repositoryUrl)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    log.warn("Cloud profile preference load failed", e)
                    null
                }
            } else null
            ui {
                profiles = loaded
                loading = false
                val items = if (loaded.error == null) listOf(None) + loaded.items else listOf(Failed)
                profile.model = DefaultComboBoxModel(items.toTypedArray())
                profile.selectedItem = when {
                    loaded.error != null -> Failed
                    remembered != null -> profileByID(remembered) ?: defaultProfile() ?: None
                    else -> defaultProfile() ?: None
                }
                profile.isEnabled = loaded.error == null
                syncUseDefault()
                syncValidation()
            }
        }
    }

    @RequiresEdt
    override fun syncValidation() {
        val info = doValidate()
        setErrorInfoAll(listOfNotNull(info))
        setOKActionEnabled(info?.okEnabled != false)
        prompt.setReady(ready)
    }

    @RequiresEdt
    override fun doValidate(): ValidationInfo? = when {
        loading -> ValidationInfo("")
        profiles.error != null -> ValidationInfo(
            profiles.error?.message ?: KiloBundle.message("hosted.workspace.profiles.failed"),
        )
        pending()?.let { it.agent == null || it.model == null || it.provider != "kilo" } ?: true ->
            ValidationInfo(KiloBundle.message("hosted.workspace.create.noModel"), prompt)
        profile.selectedItem !== None && profile.selectedItem as? HostedWorkspaceProfileDto !in profiles.items ->
            ValidationInfo(KiloBundle.message("hosted.workspace.dialog.profile.invalid"), profile)
        else -> null
    }

    override fun createCenterPanel(): JComponent {
        val fields = object : FormBuilder() {
            override fun getFill(component: JComponent) = GridBagConstraints.HORIZONTAL
        }.apply {
            addLabeledComponent(KiloBundle.message("hosted.workspace.dialog.repository"), repository)
            addLabeledComponent(KiloBundle.message("hosted.workspace.dialog.branch"), branch)
            addLabeledComponent(
                KiloBundle.message("hosted.workspace.dialog.profile"),
                BorderLayoutPanel().addToCenter(profile).addToRight(
                    Stack.horizontal(gap = UiStyle.Gap.pad()).next(useDefault),
                ),
            )
        }.panel
        return content(null, fields)
    }

    override fun getPreferredFocusedComponent(): JComponent = prompt.defaultFocusedComponent

    override fun getDimensionServiceKey(): String = "ai.kilocode.HostedWorkspaceDialog.v2"

    override fun doOKAction() = submitCreate(prompt.text())

    override fun submitCreate(text: String) {
        if (loading || profiles.error != null) {
            syncValidation()
            return
        }
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
        if (profile.selectedItem !== None && selected !in profiles.items) {
            setErrorText(KiloBundle.message("hosted.workspace.dialog.profile.invalid"), profile)
            return
        }
        result = HostedCreatePlan(
            prompt = picked.text,
            branch = branch.text.trim().takeIf { it.isNotBlank() },
            profileID = selected?.id,
            agent = mode,
            model = "${picked.provider}/$model",
            variant = picked.variant,
        )
        selection.remember(repositoryUrl, selected?.id, defaultProfile()?.id)
        close(OK_EXIT_CODE)
    }

    fun plan(): HostedCreatePlan? = result

    internal fun validationForTest(): ValidationInfo? = doValidate()

    @RequiresEdt
    private fun syncUseDefault() {
        val selected = profile.selectedItem as? HostedWorkspaceProfileDto
        val default = defaultProfile()
        useDefault.isVisible = default != null && selected?.id != default.id
        useDefault.isEnabled = useDefault.isVisible
        profile.repaint()
    }

    private fun profileLabel(profile: HostedWorkspaceProfileDto): String = when {
        organizationDefault(profile) ->
            KiloBundle.message("hosted.workspace.dialog.profile.organizationDefault", profile.name)
        personalDefault(profile) -> KiloBundle.message("hosted.workspace.dialog.profile.personalDefault", profile.name)
        else -> profile.name
    }

    private fun defaultProfile(): HostedWorkspaceProfileDto? =
        organizationDefault()
            ?: personalDefault()
            ?: profiles.effectiveDefaultProfileID?.let(::profileByID)
            ?: profiles.items.find { it.isDefault }

    private fun organizationDefault(): HostedWorkspaceProfileDto? =
        profiles.organizationDefaultProfileID?.let(::profileByID) ?: profiles.items.find { it.isOrganizationDefault }

    private fun personalDefault(): HostedWorkspaceProfileDto? =
        profiles.personalDefaultProfileID?.let(::profileByID) ?: profiles.items.find { it.isPersonalDefault }

    private fun organizationDefault(profile: HostedWorkspaceProfileDto): Boolean =
        organizationDefault()?.id == profile.id

    private fun personalDefault(profile: HostedWorkspaceProfileDto): Boolean = personalDefault()?.id == profile.id

    private fun profileByID(id: String): HostedWorkspaceProfileDto? = profiles.items.find { it.id == id }

    private companion object {
        val log = logger<HostedWorkspaceDialog>()
    }
}