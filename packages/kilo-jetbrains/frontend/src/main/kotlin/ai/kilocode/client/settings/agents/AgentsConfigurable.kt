package ai.kilocode.client.settings.agents

import ai.kilocode.cli.KiloCliParser
import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.session.ui.model.ModelText
import ai.kilocode.client.settings.base.SettingsBadge
import ai.kilocode.client.settings.base.SettingsListCell
import ai.kilocode.client.settings.base.SettingsListItem
import ai.kilocode.client.settings.base.SettingsListPanel
import ai.kilocode.client.settings.base.SettingsListSelection
import ai.kilocode.client.settings.base.SettingsDraftPage
import ai.kilocode.client.settings.base.SettingsDraftState
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.AgentDetailDto
import ai.kilocode.rpc.dto.ProvidersDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.ui.components.JBLabel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.swing.JComponent
import javax.swing.JComboBox

private val edt = Dispatchers.EDT + ModalityState.any().asContextElement()

class AgentsConfigurable : AgentBehaviorConfigurableBase<JComponent>() {
    override fun getId(): String = ID
    override fun getDisplayName(): String = KiloBundle.message("settings.agentBehavior.agents.displayName")
    override fun create(cs: CoroutineScope, dir: String): JComponent = AgentsSettingsUi(cs, dir)
    override fun scrollReadyShell() = false

    companion object { const val ID = "ai.kilocode.jetbrains.settings.agentBehavior.agents" }
}

internal class AgentsSettingsUi(
    private val cs: CoroutineScope,
    private val dir: String,
    private val create: (Collection<String>) -> AgentCreateDialogHandle = ::AgentCreateDialog,
) : SettingsListPanel(cs), SettingsDraftPage {
    private val app get() = service<KiloAppService>()
    private val state = SettingsDraftState(agentsDraft(app.state.value.config, emptyList()), ::savedMatches)
    private var draft: AgentsDraft
        get() = state.draft
        set(value) {
            state.draft = value
        }
    private val base get() = state.baseline
    private var details = emptyList<AgentDetailDto>()
    private var models = emptyList<ModelPicker.Item>()
    private var names = emptyList<String>()
    private lateinit var picker: JComboBox<String>
    private var syncing = false

    init {
        start()
    }

    override suspend fun fetch(): List<SettingsListItem> {
        val agents = service<KiloAgentBehaviorService>().agents(dir)
        models = items(service<KiloWorkspaceService>().models(dir).providers)
        val next = agentsDraft(service<KiloAppService>().state.value.config, agents)
        val dirty = state.modified()
        val edit = draft
        state.accept(next)
        if (dirty) draft = edit.copy(agents = next.agents + edit.agents)
        details = agents
        syncNames()
        return rows()
    }

    override fun extraActions(): List<AnAction> = listOf(addAction())

    override fun toolbarRight(): JComponent = Stack.horizontal(UiStyle.Gap.sm())
        .next(JBLabel(KiloBundle.message("settings.agentBehavior.agents.default")))
        .next(makePicker())

    override fun afterApply() {
        syncPicker()
    }

    private fun makePicker(): JComboBox<String> {
        if (::picker.isInitialized) return picker
        picker = JComboBox(names.toTypedArray()).apply {
            selectedItem = draft.defaultAgent.orEmpty()
            addActionListener {
                if (syncing) return@addActionListener
                state.update { copy(defaultAgent = (selectedItem as? String)?.takeIf { it.isNotBlank() }) }
            }
        }
        return picker
    }

    override fun onCell(key: String, cellId: String) {
        val agent = draft.agents[key] ?: return
        if (cellId == DELETE_CELL) {
            remove(agent)
            return
        }
        if (cellId != EDIT_CELL) return
        val dialog = AgentEditDialog(agent, service(), models)
        if (!dialog.showAndGet()) return
        state.update { updateAgent(this, dialog.result()) }
        syncNames()
        syncPicker()
        view.update(rows())
    }

    override fun searchPlaceholder() = KiloBundle.message("settings.agentBehavior.agents.search")

    override fun modified(): Boolean = state.modified()

    override fun applyDraft() {
        val change = patch(base, draft) ?: return
        val token = state.start() ?: return
        syncNames()
        syncPicker()
        view.update(rows())
        cs.launch {
            val state = service<KiloAppService>().updateConfig(change)
            withContext(edt) {
                if (state == null) {
                    this@AgentsSettingsUi.state.fail(token, KiloBundle.message("settings.agentBehavior.save.failed"))
                } else {
                    val next = agentsDraft(state.config, details)
                    this@AgentsSettingsUi.state.complete(token, next)
                }
                syncNames()
                syncPicker()
                view.update(rows())
            }
        }
    }

    override fun resetDraft() {
        state.reset()
        syncNames()
        syncPicker()
        view.update(rows())
    }

    private fun rows(): List<SettingsListItem> = draft.agents.values.map { item ->
        object : SettingsListItem {
            override val key = item.name
            override val title = item.displayName ?: item.name
            override val description = item.description
            override val badges = listOfNotNull(
                SettingsBadge(
                    KiloBundle.message("settings.agentBehavior.badge.subagent"),
                    UiStyle.Badge.Highlight,
                ).takeIf { KiloCliParser.isSubagent(item.mode) },
                SettingsBadge(
                    KiloBundle.message("settings.agentBehavior.badge.custom"),
                    UiStyle.Badge.Primary,
                ).takeIf { canDelete(item) },
                SettingsBadge(KiloBundle.message("settings.agentBehavior.badge.hidden")).takeIf { item.hidden },
                SettingsBadge(KiloBundle.message("settings.agentBehavior.badge.disabled")).takeIf { item.disable },
                SettingsBadge(
                    KiloBundle.message("settings.agentBehavior.badge.deprecated"),
                    UiStyle.Badge.Alert,
                ).takeIf { item.deprecated },
            )
            override val cells = listOfNotNull(
                SettingsListCell(EDIT_CELL, KiloBundle.message("settings.agentBehavior.edit")),
                SettingsListCell(
                    DELETE_CELL,
                    KiloBundle.message("common.delete"),
                    icon = AllIcons.Actions.GC,
                    iconOnly = true,
                ).takeIf { canDelete(item) },
            )
        }
    }

    private fun remove(agent: AgentEditDraft) {
        if (!canDelete(agent)) return
        val result = Messages.showYesNoDialog(
            KiloBundle.message("settings.agentBehavior.agents.delete.message", agent.displayName ?: agent.name),
            KiloBundle.message("settings.agentBehavior.agents.delete.title"),
            KiloBundle.message("common.delete"),
            Messages.getCancelButton(),
            Messages.getQuestionIcon(),
        )
        if (result != Messages.YES) return
        val selection = selectionIndex()
        mutateAndReload(selection) {
            val removed = service<KiloAgentBehaviorService>().removeAgent(dir, agent.name)
            if (!removed) return@mutateAndReload false
            withContext(edt) {
                prune(agent.name)
            }
            true
        }
    }

    private fun prune(name: String) {
        state.accept(base.copy(
            defaultAgent = base.defaultAgent.takeUnless { it == name },
            agents = base.agents - name,
        ))
        draft = draft.copy(
            defaultAgent = draft.defaultAgent.takeUnless { it == name },
            agents = draft.agents - name,
        )
        details = details.filter { it.name != name }
        syncNames()
        syncPicker()
    }

    private fun syncNames() {
        names = listOf("") + draft.agents.values
            .filter { KiloCliParser.defaultAgentCandidate(it.mode, it.hidden) && !it.disable }
            .map { it.name }
    }

    private fun syncPicker() {
        if (!::picker.isInitialized) return
        syncing = true
        try {
            picker.removeAllItems()
            names.forEach { picker.addItem(it) }
            picker.selectedItem = draft.defaultAgent.orEmpty()
        } finally {
            syncing = false
        }
    }

    private fun addAction(): DefaultActionGroup = DefaultActionGroup(
        KiloBundle.message("settings.agentBehavior.agents.add"),
        true,
    ).apply {
        templatePresentation.icon = AllIcons.General.Add
        add(CreateAction())
        add(PlaceholderAction(KiloBundle.message("settings.agentBehavior.agents.import")))
    }

    internal inner class CreateAction : DumbAwareAction(KiloBundle.message("settings.agentBehavior.agents.create")) {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT

        override fun actionPerformed(e: AnActionEvent) = perform()

        internal fun perform() {
            val dialog = create(draft.agents.keys)
            if (!dialog.showAndGet()) return
            val input = dialog.result()
            mutateAndReload(SettingsListSelection.Key(input.name)) {
                service<KiloAgentBehaviorService>().createAgent(dir, input)
            }
        }
    }

    private companion object {
        const val EDIT_CELL = "edit"
        const val DELETE_CELL = "delete"
        const val KILO_PROVIDER = "kilo"
    }

    private fun items(providers: ProvidersDto?): List<ModelPicker.Item> {
        val cfg = providers ?: return emptyList()
        return cfg.providers
            .filter { it.id == KILO_PROVIDER || it.id in cfg.connected }
            .flatMap { provider ->
                provider.models.mapNotNull { (id, item) ->
                    val model = ModelPicker.Item(
                        id,
                        item.name,
                        provider.id,
                        provider.name,
                        item.recommendedIndex,
                        free = item.free,
                        byok = item.byok,
                        variants = item.variants,
                        mayTrainOnYourPrompts = item.mayTrainOnYourPrompts,
                    )
                    if (ModelText.small(model)) return@mapNotNull null
                    model
                }
            }
    }
}

private class PlaceholderAction(text: String) : DumbAwareAction(text) {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun actionPerformed(e: AnActionEvent) = Unit
}
