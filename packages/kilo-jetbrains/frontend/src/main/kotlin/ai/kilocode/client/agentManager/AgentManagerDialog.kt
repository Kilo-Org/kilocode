package ai.kilocode.client.agentManager

import ai.kilocode.client.actions.reloadCoreSettings
import ai.kilocode.client.agentManager.worktree.PendingPrompt
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.controller.key
import ai.kilocode.client.session.controller.resolveSessionAgent
import ai.kilocode.client.session.controller.resolveSessionDefaultModel
import ai.kilocode.client.session.controller.resolveSessionModel
import ai.kilocode.client.session.ui.ReasoningPicker
import ai.kilocode.client.session.ui.mode.modeItems
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.session.ui.model.modelItems
import ai.kilocode.client.session.ui.prompt.KiloPromptCompletionProvider
import ai.kilocode.client.session.ui.prompt.MentionAction
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.prompt.SlashAction
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.ModelsWorkspaceDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import java.awt.Component
import javax.swing.JComponent

/** Shared prompt and selection lifecycle for Local and Cloud workspace creation. */
internal abstract class AgentManagerDialog @RequiresEdt constructor(
    parent: Component,
    protected val project: Project,
    protected val directory: String,
    private val local: Boolean,
    private val app: KiloAppService,
    private val workspaces: KiloWorkspaceService,
) : DialogWrapper(parent, false) {
    protected val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    protected open val allowEmptyPrompt: Boolean get() = false
    protected open val ready: Boolean get() = workspace != null
    private val completion = if (local) KiloPromptCompletionProvider(
        workspace = workspaces.workspace(directory),
        service = workspaces,
        actions = slashActions(),
        mentions = MentionAction.ALL.map { spec ->
            MentionAction(spec.name, KiloBundle.message(spec.descriptionKey), spec.hints, spec.available)
        },
        scope = scope,
    ) else null
    protected val prompt = PromptPanel(
        project = project,
        onSend = { text, _ -> submitCreate(text) },
        onAbort = {},
        completion = completion,
        cs = scope,
        rounded = false,
        showSubmit = false,
        approve = false,
        showEnhance = false,
        framed = true,
        files = local,
    )
    private var agent: String? = null
    private var model: String? = null
    private var items: List<ModelPicker.Item> = emptyList()
    private var workspace: ModelsWorkspaceDto? = null
    private var variant: String? = null
    @Volatile private var disposed = false

    @RequiresEdt
    protected fun content(above: JComponent?, below: JComponent): JComponent {
        prompt.mode.onSelect = { item ->
            agent = item.id
            syncSelection()
        }
        prompt.model.favorites = { app.favorites.value }
        prompt.model.onFavoriteToggle = { item -> app.toggleModelFavorite(item.provider, item.id) }
        prompt.model.onSelect = { item ->
            model = item.key
            agent?.let { app.selectModel(it, item.provider, item.id) }
            syncReasoning(item)
            prompt.setAttachmentEnabled(local && item.attachment)
        }
        prompt.reasoning.onSelect = { item ->
            variant = item.id
            model?.let { app.selectVariant(it, item.id) }
        }
        scope.launch {
            combine(app.state, app.models) { _, _ -> Unit }.collect { ui(::syncSelection) }
        }
        scope.launch {
            val ws = workspaces.models(directory)
            ui {
                workspace = ws
                items = modelItems(ws.providers).filter { local || it.provider == "kilo" }
                agent = resolveSessionAgent(ws.agents, KiloPluginSettings.getAgent())
                prompt.mode.setItems(modeItems(ws.agents?.agents), agent)
                syncSelection()
                prompt.setReady(ready)
            }
        }
        return BorderLayoutPanel().apply {
            border = JBUI.Borders.empty(UiStyle.Gap.sm())
            above?.let(::addToTop)
            addToCenter(prompt)
            addToBottom(below)
        }
    }

    @RequiresEdt
    protected abstract fun submitCreate(text: String)

    @RequiresEdt
    protected fun pending(text: String = prompt.text()): PendingPrompt? {
        val body = text.trim()
        if (body.isEmpty() && !allowEmptyPrompt) return null
        val item = items.firstOrNull { it.key == model }
        return PendingPrompt(body, agent, item?.provider, item?.id, variant)
    }

    @RequiresEdt
    private fun syncSelection() {
        val ws = workspace ?: return
        val first = items.firstOrNull() ?: return
        val id = agent
        val current = if (id == null) {
            first
        } else {
            val state = app.models.value
            val cfg = app.state.value
            val fallback = resolveSessionDefaultModel(
                providers = ws.providers,
                agent = id,
                state = state,
                config = cfg.config,
                ready = cfg.status == KiloAppStatusDto.READY,
                first = ModelSelectionDto(first.provider, first.id),
            )
            val selection = resolveSessionModel(ws.providers, id, state, cfg.config, fallback)
            items.firstOrNull { it.key == selection?.key } ?: first
        }
        prompt.model.setItems(items, current.key)
        model = current.key
        syncReasoning(current)
        prompt.setAttachmentEnabled(local && current.attachment)
        syncValidation()
    }

    /** Re-runs dialog validation after the prompt, agent, or model selection changes. */
    protected open fun syncValidation() {}

    @RequiresEdt
    private fun syncReasoning(item: ModelPicker.Item) {
        val saved = app.models.value.variant[item.key]?.takeIf { it in item.variants }
        variant = saved ?: item.variants.firstOrNull()
        prompt.reasoning.setItems(
            item.variants.map { ReasoningPicker.Item(it, it.replaceFirstChar { char -> char.titlecase() }) },
            variant,
        )
    }

    // Modal dialogs need UI updates in their nested event loop, not after they close.
    protected fun ui(block: () -> Unit) {
        ApplicationManager.getApplication().invokeLater({ if (!disposed) block() }, ModalityState.any())
    }

    private fun slashActions(): List<SlashAction> {
        val actions = mapOf(
            SlashAction.MODELS to { prompt.model.open() },
            SlashAction.AGENTS to { prompt.mode.open() },
            SlashAction.VARIANT to { prompt.reasoning.open() },
            SlashAction.RELOAD to { reloadCoreSettings(workspaces, directory, project, "slash_command") },
        )
        return SlashAction.ALL.map { spec ->
            SlashAction(spec.name, KiloBundle.message(spec.descriptionKey), spec.hints, actions[spec] ?: {})
        }
    }

    override fun dispose() {
        disposed = true
        scope.cancel()
        super.dispose()
    }
}
