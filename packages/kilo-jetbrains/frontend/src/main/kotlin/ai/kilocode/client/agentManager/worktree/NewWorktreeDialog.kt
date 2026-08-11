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
import ai.kilocode.client.session.ui.prompt.PromptFuzzyRanker
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.prompt.SlashAction
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.ModelsWorkspaceDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.awt.Component
import java.awt.GridBagConstraints
import java.awt.event.FocusAdapter
import java.awt.event.FocusEvent
import javax.swing.ComboBoxModel
import javax.swing.DefaultComboBoxModel
import javax.swing.JComponent
import javax.swing.JTextField
import javax.swing.event.DocumentEvent
import javax.swing.plaf.basic.BasicComboPopup

private const val NAME_COLUMNS = 100

/**
 * New Worktree dialog with parity to the VS Code Agent Manager dialog: a worktree name (top), an
 * initial prompt with the same mode / model / reasoning pickers as the chat prompt (center), and the
 * branch name + base branch (bottom). Creating a worktree starts a session automatically with the
 * prompt.
 *
 * The dialog performs no worktree work itself — it invokes [onCreate] and closes; the panel drives
 * the controller. Mode, model, and reasoning selections are persisted the same way the chat prompt
 * does, so the freshly-started session inherits them.
 */
internal class NewWorktreeDialog(
    parent: Component,
    private val project: Project,
    private val directory: String,
    private val suggestedName: String,
    private val defaultBase: String,
    private val branches: List<String>,
    private val onCreate: (branch: String, base: String?, prompt: PendingPrompt?) -> Unit,
    private val app: KiloAppService = service(),
    private val workspaces: KiloWorkspaceService = service(),
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
        completion = completion,
        cs = scope,
        rounded = false,
        showSubmit = false,
        approve = false,
        showEnhance = false,
    )
    private val branch = JBTextField(suggestedName)
    private val bases = baseBranches(branches, defaultBase)
    private val baseSet = bases.toSet()
    private val base = ComboBox(baseModel(bases)).apply {
        isEditable = true
        selectedItem = defaultBase
    }
    private var syncing = false

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
        wireBase()
        title = KiloBundle.message("worktree.configure.title")
        init()
        setOKButtonText(KiloBundle.message("worktree.dialog.create"))
    }

    override fun createCenterPanel(): JComponent = content().also { center = it }

    /** The built content, so tests can drive the real Swing tree before the dialog is shown. */
    internal fun centerComponent(): JComponent = center ?: error("center panel not built")

    override fun getPreferredFocusedComponent(): JComponent = prompt.defaultFocusedComponent

    override fun getDimensionServiceKey(): String = "ai.kilocode.NewWorktreeDialog"

    override fun doOKAction() = submitCreate()

    override fun dispose() {
        disposed = true
        scope.cancel()
        super.dispose()
    }

    private fun content(): JComponent {
        wirePickers()
        loadModels()
        return Stack.vertical(gap = UiStyle.Gap.pad())
            .next(name)
            .next(prompt)
            .next(fields())
            .apply { border = JBUI.Borders.empty(UiStyle.Gap.sm()) }
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

    private fun wireBase() {
        val field = baseField() ?: return
        field.document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(e: DocumentEvent) {
                if (!syncing) syncBase(field.text, popup = true)
            }
        })
        field.addFocusListener(object : FocusAdapter() {
            override fun focusLost(e: FocusEvent) {
                restoreBase()
            }
        })
    }

    private fun restoreBase() {
        if (baseText().isNotEmpty() || defaultBase.isBlank()) return
        setBase(defaultBase)
    }

    private fun syncBase(text: String, popup: Boolean) {
        val value = text.trim()
        if (value.isEmpty()) return
        if (popup && base.isShowing && !base.isPopupVisible) {
            base.isPopupVisible = true
        }
        val idx = matchBase(value) ?: return
        val list = popupList() ?: return
        if (list.selectedIndex != idx) list.selectedIndex = idx
        list.ensureIndexIsVisible(idx)
    }

    private fun matchBase(text: String): Int? {
        val rank = PromptFuzzyRanker(text)
        return bases.withIndex().mapNotNull { item ->
            rank.score(item.value, emptyList())?.let { score -> item.index to score }
        }.maxByOrNull { it.second }?.first
    }

    private fun popupList() = (base.accessibleContext?.getAccessibleChild(0) as? BasicComboPopup)?.list

    private fun baseField() = base.editor.editorComponent as? JTextField

    private fun baseText() = baseField()?.text?.trim()
        ?: base.editor.item?.toString()?.trim().orEmpty()

    private fun setBase(value: String) {
        syncing = true
        try {
            base.selectedItem = value
            baseField()?.text = value
        } finally {
            syncing = false
        }
    }

    private fun resolvedBase(): String? {
        val value = baseText()
        if (value.isEmpty()) {
            val fallback = defaultBase.trim()
            if (fallback.isNotEmpty()) setBase(fallback)
            return fallback.takeIf { it.isNotEmpty() }
        }
        if (value in baseSet) return value
        val idx = matchBase(value) ?: return value
        val target = bases[idx]
        setBase(target)
        return target
    }

    private fun validBase(value: String?): Boolean {
        if (value == null || value in baseSet) return true
        KiloNotifications.error(
            project,
            KiloBundle.message("worktree.configure.base.invalid.title"),
            KiloBundle.message("worktree.configure.base.invalid.content", value),
        )
        baseField()?.apply {
            requestFocusInWindow()
            selectAll()
        }
        syncBase(value, popup = true)
        return false
    }

    private fun submitCreate(text: String = prompt.text()) {
        val explicit = branch.text.trim()
        val resolved = explicit.ifEmpty { name.text.trim() }.ifEmpty { suggestedName }
        val target = resolvedBase()
        if (!validBase(target)) return
        onCreate(resolved, target, pending(text))
        close(OK_EXIT_CODE)
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

    private fun baseBranches(branches: List<String>, default: String): List<String> {
        val ordered = LinkedHashSet<String>()
        if (default.isNotBlank()) ordered.add(default)
        ordered.addAll(branches)
        return ordered.toList()
    }

    private fun baseModel(branches: List<String>): ComboBoxModel<String> {
        return DefaultComboBoxModel(branches.toTypedArray())
    }

    private fun variantTitle(value: String): String = value.replaceFirstChar { it.titlecase() }
}
