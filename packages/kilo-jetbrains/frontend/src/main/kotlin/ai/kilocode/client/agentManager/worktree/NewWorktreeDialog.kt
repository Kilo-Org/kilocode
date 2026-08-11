package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.ReasoningPicker
import ai.kilocode.client.session.ui.mode.modeItems
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.session.ui.model.modelItems
import ai.kilocode.client.session.ui.prompt.KiloPromptCompletionProvider
import ai.kilocode.client.session.ui.prompt.MentionAction
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.prompt.SlashAction
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.ModelsWorkspaceDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTabbedPane
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.awt.Component
import java.awt.event.ActionEvent
import javax.swing.AbstractAction
import javax.swing.DefaultComboBoxModel
import javax.swing.JButton
import javax.swing.JComponent

private const val NAME_COLUMNS = 100

/**
 * New Worktree dialog with parity to the VS Code Agent Manager dialog:
 *
 * - **New** tab: a worktree name (top), an initial prompt with the same mode / model / reasoning
 *   pickers as the chat prompt (center), and the branch name + base branch (bottom). Creating a
 *   worktree here starts a session automatically with the prompt.
 * - **Import** tab: import a worktree from a GitHub pull request URL or from an existing branch.
 *
 * The dialog performs no worktree work itself — it invokes [onCreate], [onImportPr], or
 * [onImportBranch] and closes; the panel drives the controller. Mode, model, and reasoning
 * selections are persisted the same way the chat prompt does, so the freshly-started session
 * inherits them.
 */
internal class NewWorktreeDialog(
    parent: Component,
    private val project: Project,
    private val directory: String,
    private val suggestedName: String,
    private val defaultBase: String,
    private val branches: List<String>,
    private val onCreate: (branch: String, base: String?, prompt: String) -> Unit,
    private val onImportPr: (url: String) -> Unit,
    private val onImportBranch: (branch: String) -> Unit,
    private val app: KiloAppService = service(),
    private val workspaces: KiloWorkspaceService = service(),
    // Project-scoped; supplied by the panel. When absent, mode selection is not persisted.
    private val sessions: KiloSessionService? = null,
) : DialogWrapper(parent, false) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // A wide name field so the dialog opens wide enough to type long worktree names and prompts.
    private val name = JBTextField(NAME_COLUMNS).apply {
        emptyText.text = KiloBundle.message("worktree.dialog.name.placeholder")
    }
    private val completion = KiloPromptCompletionProvider(
        workspace = workspaces.workspace(directory),
        service = workspaces,
        actions = slashActions(),
        mentions = MentionAction.ALL.map(::mention),
        scope = scope,
    )
    private val prompt = PromptPanel(
        project = project,
        onSend = { text, _ -> submitCreate(text) },
        onAbort = {},
        onEnhance = ::enhance,
        completion = completion,
        cs = scope,
        rounded = false,
        showSubmit = false,
        approve = false,
    )
    private val branch = JBTextField(suggestedName)
    private val base = ComboBox(baseModel(branches, defaultBase)).apply {
        isEditable = true
        selectedItem = defaultBase
    }
    private val prUrl = JBTextField().apply {
        emptyText.text = KiloBundle.message("worktree.import.pr.placeholder")
    }
    private val branchPicker = ComboBox(importBranchModel(branches))

    /** The agent (mode) for the new session; model selections persist against it. */
    private var agent: String? = null

    /** The currently displayed model key, used to key the reasoning selection. */
    private var modelKey: String? = null

    /** The loaded catalog, so mode changes can re-point the model picker without a reload. */
    private var items: List<ModelPicker.Item> = emptyList()

    @Volatile
    private var disposed = false

    private var center: JComponent? = null
    private var tabs: JBTabbedPane? = null

    init {
        title = KiloBundle.message("worktree.configure.title")
        init()
        setOKButtonText(KiloBundle.message("worktree.dialog.create"))
        syncOkEnabled()
    }

    override fun createCenterPanel(): JComponent = JBTabbedPane().apply {
        addTab(KiloBundle.message("worktree.dialog.tab.new"), newTab())
        addTab(KiloBundle.message("worktree.dialog.tab.import"), importTab())
        addChangeListener { syncOkEnabled() }
        tabs = this
    }.also { center = it }

    /** The built tabbed content, so tests can drive the real Swing tree before the dialog is shown. */
    internal fun centerComponent(): JComponent = center ?: error("center panel not built")

    override fun getPreferredFocusedComponent(): JComponent = prompt.defaultFocusedComponent

    override fun getDimensionServiceKey(): String = "ai.kilocode.NewWorktreeDialog"

    // "Create Worktree" is the dialog's default action; it applies only to the New tab.
    override fun doOKAction() = submitCreate()

    override fun dispose() {
        disposed = true
        scope.cancel()
        super.dispose()
    }

    private fun newTab(): JComponent {
        wirePickers()
        val south = FormBuilder.createFormBuilder()
            .addLabeledComponent(KiloBundle.message("worktree.configure.branch"), branch)
            .addLabeledComponent(KiloBundle.message("worktree.configure.base"), base)
            .panel

        val root = BorderLayoutPanel()
        root.border = JBUI.Borders.empty(UiStyle.Gap.sm())
        root.addToTop(name)
        root.addToCenter(prompt)
        root.addToBottom(south)
        loadModels()
        return root
    }

    private fun wirePickers() {
        prompt.mode.onSelect = { item -> selectAgent(item.id) }
        prompt.model.favorites = { app.favorites.value }
        prompt.model.onFavoriteToggle = { item -> app.toggleModelFavorite(item.provider, item.id) }
        prompt.model.onSelect = { item ->
            modelKey = item.key
            agent?.let { app.selectModel(it, item.provider, item.id) }
            syncReasoning(item)
        }
        prompt.reasoning.onSelect = { item -> modelKey?.let { app.selectVariant(it, item.id) } }
    }

    private fun loadModels() {
        app.scope.launch {
            val result = workspaces.models(directory)
            ui { applyModels(result) }
        }
    }

    private fun applyModels(ws: ModelsWorkspaceDto) {
        items = modelItems(ws.providers)
        agent = ws.agents?.default
        prompt.mode.setItems(modeItems(ws.agents?.agents), agent)
        if (items.isEmpty()) {
            prompt.setReady(true)
            return
        }
        val saved = agent?.let { app.models.value.model[it] }?.let { "${it.providerID}/${it.modelID}" }
        prompt.model.setItems(items, saved)
        val current = items.firstOrNull { it.key == saved } ?: items.first()
        modelKey = current.key
        syncReasoning(current)
        prompt.setAttachmentEnabled(current.attachment)
        prompt.setReady(true)
    }

    private fun selectAgent(id: String) {
        agent = id
        sessions?.let { svc -> app.scope.launch { svc.updateConfig(directory, ConfigUpdateDto(agent = id)) } }
        val saved = app.models.value.model[id]?.let { "${it.providerID}/${it.modelID}" }
        if (saved != null && items.any { it.key == saved }) {
            prompt.model.select(saved)
            modelKey = saved
        }
        items.firstOrNull { it.key == modelKey }?.let { syncReasoning(it) }
    }

    private fun syncReasoning(item: ModelPicker.Item) {
        prompt.reasoning.setItems(
            item.variants.map { ReasoningPicker.Item(it, variantTitle(it)) },
            app.models.value.variant[item.key],
        )
    }

    private fun importTab(): JComponent {
        prUrl.addActionListener { submitImportPr() }
        val open = createButton(KiloBundle.message("worktree.import.pr.open")) { submitImportPr() }
        val prRow = BorderLayoutPanel().apply {
            addToCenter(prUrl)
            addToRight(open)
        }
        branchPicker.addActionListener {
            val value = branchPicker.selectedItem as? String ?: return@addActionListener
            if (value.isBlank() || value == importBranchPlaceholder()) return@addActionListener
            onImportBranch(value)
            close(OK_EXIT_CODE)
        }

        val builder = FormBuilder.createFormBuilder()
            .addComponent(sectionLabel(KiloBundle.message("worktree.import.pr.section")))
            .addComponent(prRow)
            .addSeparator()
            .addComponent(sectionLabel(KiloBundle.message("worktree.import.branches.section")))
        if (branches.isEmpty()) {
            builder.addComponent(sectionLabel(KiloBundle.message("worktree.import.branches.empty")))
        } else {
            builder.addComponent(branchPicker)
        }
        val panel = builder.panel
        panel.border = JBUI.Borders.empty(UiStyle.Gap.sm())
        return panel
    }

    private fun submitCreate(text: String = prompt.text()) {
        if (tabs?.selectedIndex != 0) return
        val explicit = branch.text.trim()
        val resolved = explicit.ifEmpty { name.text.trim() }.ifEmpty { suggestedName }
        onCreate(resolved, base.editor.item?.toString()?.trim()?.takeIf { it.isNotEmpty() }, text.trim())
        close(OK_EXIT_CODE)
    }

    private fun enhance(text: String, done: (Result<String>) -> Unit) {
        val svc = sessions ?: return done(Result.failure(IllegalStateException("Session service unavailable")))
        scope.launch {
            val result = runCatching { svc.enhancePrompt(directory, text) }
            ui { if (!project.isDisposed) done(result) }
        }
    }

    // The dialog is modal, so its EDT runs a nested event loop. A plain invokeLater carries the
    // caller's (non-modal) modality and would be deferred until the dialog closes, leaving the
    // pickers empty and enhance disabled. ModalityState.any() lets these UI-only updates run while
    // the dialog is showing.
    private fun ui(block: () -> Unit) {
        ApplicationManager.getApplication().invokeLater({ if (!disposed) block() }, ModalityState.any())
    }

    private fun slashActions(): List<SlashAction> {
        val actions = mapOf(
            SlashAction.MODELS to { prompt.model.open() },
            SlashAction.AGENTS to { prompt.mode.open() },
            SlashAction.VARIANT to { prompt.reasoning.open() },
        )
        return SlashAction.ALL.map { spec ->
            SlashAction(spec.name, KiloBundle.message(spec.descriptionKey), spec.hints, actions[spec] ?: {})
        }
    }

    private fun mention(spec: MentionAction.Spec) = MentionAction(
        spec.name,
        KiloBundle.message(spec.descriptionKey),
        spec.hints,
        spec.available,
    )

    private fun submitImportPr() {
        val url = prUrl.text.trim()
        if (url.isEmpty()) return
        onImportPr(url)
        close(OK_EXIT_CODE)
    }

    /** The New-tab create action is the default button; disable it while the Import tab is active. */
    private fun syncOkEnabled() {
        getOKAction().isEnabled = tabs?.selectedIndex == 0
    }

    private fun sectionLabel(text: String) = JBLabel(text).apply {
        foreground = UIUtil.getContextHelpForeground()
    }

    private fun createButton(text: String, run: () -> Unit) = JButton(object : AbstractAction(text) {
        override fun actionPerformed(e: ActionEvent) = run()
    })

    private fun baseModel(branches: List<String>, default: String): DefaultComboBoxModel<String> {
        val ordered = LinkedHashSet<String>()
        if (default.isNotBlank()) ordered.add(default)
        ordered.addAll(branches)
        return DefaultComboBoxModel(ordered.toTypedArray())
    }

    private fun importBranchModel(branches: List<String>): DefaultComboBoxModel<String> {
        val ordered = mutableListOf(importBranchPlaceholder())
        ordered.addAll(branches)
        return DefaultComboBoxModel(ordered.toTypedArray())
    }

    private fun importBranchPlaceholder() = KiloBundle.message("worktree.import.branches.placeholder")

    private fun variantTitle(value: String): String = value.replaceFirstChar { it.titlecase() }
}
