package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.app.KiloAppService
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
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.SettingsRows
import ai.kilocode.client.settings.base.SettingsStackedRow
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.ModelsWorkspaceDto
import ai.kilocode.rpc.parsePrUrl
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.components.JBTextField
import com.intellij.ui.tabs.JBTabs
import com.intellij.ui.tabs.JBTabsFactory
import com.intellij.ui.tabs.JBTabsPosition
import com.intellij.ui.tabs.TabInfo
import com.intellij.ui.tabs.TabsListener
import com.intellij.util.ui.FormBuilder
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.awt.Component
import java.awt.GridBagConstraints
import javax.swing.JComponent

private const val NAME_COLUMNS = 67

/** What the user confirmed in the New Worktree dialog. */
sealed interface NewWorktreePlan {
    data class Create(val branch: String, val base: String?, val prompt: PendingPrompt?) : NewWorktreePlan
    data class Branch(val branch: String) : NewWorktreePlan
    data class Pr(val url: String) : NewWorktreePlan
}

/**
 * The New Worktree dialog as seen by its caller: show it, then read what the user confirmed.
 * [result] stays null while the dialog is cancelled or its input never validates.
 */
interface NewWorktreeHandle {
    fun showAndGet(): Boolean
    fun result(): NewWorktreePlan?
}

/**
 * New Worktree dialog with parity to the VS Code Agent Manager dialog, split into three tabs:
 *
 * - **New** creates a branch: a worktree name (top), an initial prompt with the same mode / model /
 *   reasoning pickers as the chat prompt (center), and the branch name + base branch (bottom).
 *   Creating a worktree starts a session automatically with the prompt.
 * - **From PR** checks out a GitHub pull request by URL.
 * - **From Branch** checks out a local branch that no worktree holds yet.
 *
 * Both import tabs carry no initial prompt, so the worktree opens with an empty session. The
 * selected tab alone decides which input the OK button acts on.
 *
 * The dialog performs no worktree work itself — it records the confirmed [result] and closes; the
 * panel then drives the controller, so no view switch or worktree work runs while the modal dialog
 * still owns focus. Mode, model, and reasoning selections are persisted the same way the chat prompt
 * does, so the freshly-started session inherits them.
 */
internal class NewWorktreeDialog(
    parent: Component,
    private val project: Project,
    private val directory: String,
    private val suggestedName: String,
    private val defaultBase: String,
    private val branches: List<String>,
    private val app: KiloAppService = service(),
    private val workspaces: KiloWorkspaceService = service(),
) : DialogWrapper(parent, false), NewWorktreeHandle {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // Sizes the dialog: the name field is its widest fixed-width child.
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
        completion = completion,
        cs = scope,
        rounded = false,
        showSubmit = false,
        approve = false,
        showEnhance = false,
    )
    private val branch = JBTextField(suggestedName)
    private val base = BranchPicker(branches, defaultBase)
    private val url = JBTextField().apply {
        emptyText.text = KiloBundle.message("worktree.import.pr.placeholder")
    }
    private val pick = BranchPicker(branches)
    private var tab = DialogTab.NEW

    private var plan: NewWorktreePlan? = null

    /** The agent (mode) for the new session; model selections persist against it. */
    private var agent: String? = null

    /** The currently displayed model key, used to key the reasoning selection. */
    private var modelKey: String? = null

    /** The loaded catalog, so mode changes can re-point the model picker without a reload. */
    private var items: List<ModelPicker.Item> = emptyList()

    @Volatile
    private var disposed = false

    private var center: JComponent? = null

    init {
        if (pick.empty) pick.isEnabled = false
        title = KiloBundle.message("worktree.configure.title")
        init()
        setOKButtonText(KiloBundle.message("worktree.dialog.create"))
    }

    override fun createCenterPanel(): JComponent = tabs().also { center = it }

    /** The built content, so tests can drive the real Swing tree before the dialog is shown. */
    internal fun centerComponent(): JComponent = center ?: error("center panel not built")

    override fun result(): NewWorktreePlan? = plan

    override fun getPreferredFocusedComponent(): JComponent = focus()

    // Versioned: DialogWrapper persists the size per key, so a stale entry would keep the old width.
    override fun getDimensionServiceKey(): String = "ai.kilocode.NewWorktreeDialog.v3"

    override fun doOKAction() = submit()

    override fun dispose() {
        disposed = true
        scope.cancel()
        super.dispose()
    }

    internal fun submit() {
        setErrorText(null)
        when (tab) {
            DialogTab.PR -> submitPr()
            DialogTab.BRANCH -> submitBranch()
            DialogTab.NEW -> submitCreate()
        }
    }

    private fun tabs(): JComponent {
        val fresh = TabInfo(newContent()).setText(KiloBundle.message("worktree.dialog.tab.new"))
        val pr = TabInfo(prContent()).setText(KiloBundle.message("worktree.dialog.tab.pr"))
        val local = TabInfo(branchContent()).setText(KiloBundle.message("worktree.dialog.tab.branch"))
        val tabs: JBTabs = JBTabsFactory.createTabs(project, disposable).apply {
            presentation.setSingleRow(true)
            presentation.setTabsPosition(JBTabsPosition.top)
            presentation.showBorder = false
            addTab(fresh).setPreferredFocusableComponent(prompt.defaultFocusedComponent)
            addTab(pr).setPreferredFocusableComponent(url)
            addTab(local).setPreferredFocusableComponent(pick)
            addListener(object : TabsListener {
                override fun beforeSelectionChanged(oldSelection: TabInfo?, newSelection: TabInfo?) {
                    // JBTabs defers removing the old body while focus settles, and that body keeps
                    // its previous bounds. Hide it before layout so stale content cannot paint over
                    // the newly selected tab.
                    newSelection?.component?.isVisible = true
                    oldSelection?.component?.isVisible = false
                }

                override fun selectionChanged(oldSelection: TabInfo?, newSelection: TabInfo?) {
                    tab = when {
                        newSelection === pr -> DialogTab.PR
                        newSelection === local -> DialogTab.BRANCH
                        else -> DialogTab.NEW
                    }
                    setOKButtonText(KiloBundle.message(if (tab == DialogTab.NEW) "worktree.dialog.create" else "worktree.dialog.import"))
                    ui { focus().requestFocusInWindow() }
                }
            }, disposable)
        }
        return tabs.component
    }

    private fun newContent(): JComponent {
        wirePickers()
        loadModels()
        return Stack.vertical(gap = UiStyle.Gap.pad())
            .next(name)
            .next(prompt)
            .next(fields())
            .apply { border = JBUI.Borders.empty(UiStyle.Gap.sm()) }
    }

    private fun prContent(): JComponent = importContent(SettingsStackedRow(
        KiloBundle.message("worktree.import.pr.section"),
        description = KiloBundle.message("worktree.import.pr.description"),
        value = url,
    ))

    private fun branchContent(): JComponent = importContent(SettingsStackedRow(
        KiloBundle.message("worktree.import.branch.section"),
        description = KiloBundle.message(if (pick.empty) "worktree.import.branch.empty" else "worktree.import.branch.description"),
        value = pick,
    ))

    private fun importContent(row: JComponent): JComponent {
        val body = BaseContentPanel().apply {
            border = JBUI.Borders.empty(UiStyle.Gap.pad(), UiStyle.Gap.sm(), UiStyle.Gap.pad(), UiStyle.Gap.sm())
        }
        body.next(SettingsRows().row(row))
        // Pinned to the top: the import forms are shorter than the New tab, which sizes the dialog.
        return BorderLayoutPanel().apply { addToTop(body) }
    }

    // A FormBuilder that stretches every field to the full width, so the base-branch combo matches
    // the name field and prompt above it.
    private fun fields(): JComponent = object : FormBuilder() {
        override fun getFill(component: JComponent) = GridBagConstraints.HORIZONTAL
    }
        .addLabeledComponent(KiloBundle.message("worktree.configure.branch"), branch)
        .addLabeledComponent(KiloBundle.message("worktree.configure.base"), base)
        .panel

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
        // The picked agent travels with the initial prompt (see submitCreate), so the dialog no
        // longer writes default_agent to the global config here — doing so changed the mode for
        // every other workspace and raced the new session's own model load.
        agent = id
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

    private fun validBase(value: String?): Boolean {
        if (base.known(value)) return true
        KiloNotifications.error(
            project,
            KiloBundle.message("worktree.configure.base.invalid.title"),
            KiloBundle.message("worktree.configure.base.invalid.content", value.orEmpty()),
        )
        base.focusText()
        return false
    }

    private fun submitCreate(text: String = prompt.text()) {
        val explicit = branch.text.trim()
        val resolved = explicit.ifEmpty { name.text.trim() }.ifEmpty { suggestedName }
        val target = base.resolve()
        if (!validBase(target)) return
        plan = NewWorktreePlan.Create(resolved, target, pending(text))
        close(OK_EXIT_CODE)
    }

    private fun submitPr() {
        val value = url.text.trim()
        if (value.isEmpty()) {
            setErrorText(KiloBundle.message("worktree.import.pr.required"), url)
            url.requestFocusInWindow()
            return
        }
        if (parsePrUrl(value) == null) {
            setErrorText(KiloBundle.message("worktree.import.pr.invalid"), url)
            url.requestFocusInWindow()
            url.selectAll()
            return
        }
        plan = NewWorktreePlan.Pr(value)
        close(OK_EXIT_CODE)
    }

    private fun submitBranch() {
        val target = pick.resolve()
        if (target == null || !pick.known(target)) {
            setErrorText(KiloBundle.message("worktree.import.branch.invalid"), pick)
            pick.focusText()
            return
        }
        plan = NewWorktreePlan.Branch(target)
        close(OK_EXIT_CODE)
    }

    private fun focus(): JComponent = when (tab) {
        DialogTab.PR -> url
        DialogTab.BRANCH -> pick
        DialogTab.NEW -> prompt.defaultFocusedComponent
    }

    /** Bundles the typed prompt with the picked mode / model / reasoning, or null when empty. */
    private fun pending(text: String): PendingPrompt? {
        val body = text.trim()
        if (body.isEmpty()) return null
        val item = items.firstOrNull { it.key == modelKey }
        return PendingPrompt(
            text = body,
            agent = agent,
            provider = item?.provider,
            model = item?.id,
            variant = modelKey?.let { app.models.value.variant[it] },
        )
    }

    // The dialog is modal, so its EDT runs a nested event loop. A plain invokeLater carries the
    // caller's (non-modal) modality and would be deferred until the dialog closes, leaving the
    // pickers empty. ModalityState.any() lets these UI-only updates run while the dialog is showing.
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

    private fun variantTitle(value: String): String = value.replaceFirstChar { it.titlecase() }

    private enum class DialogTab { NEW, PR, BRANCH }
}
