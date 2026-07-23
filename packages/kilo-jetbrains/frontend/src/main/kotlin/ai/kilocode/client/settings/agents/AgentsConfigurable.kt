package ai.kilocode.client.settings.agents

import ai.kilocode.cli.KiloCliParser
import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.session.ui.model.ModelText
import ai.kilocode.client.settings.base.SettingsDraftPage
import ai.kilocode.client.settings.base.SettingsDraftState
import ai.kilocode.client.settings.base.SettingsListPanel
import ai.kilocode.client.settings.base.SettingsMessageException
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListCell
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListSelection
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
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.components.JBLabel
import java.nio.charset.StandardCharsets
import javax.swing.JComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val edt = Dispatchers.EDT + ModalityState.any().asContextElement()

class AgentsConfigurable : AgentBehaviorConfigurableBase<JComponent>() {
    override fun getId(): String = ID
    override fun getDisplayName(): String = KiloBundle.message("settings.agentBehavior.agents.displayName")
    override fun create(cs: CoroutineScope, dir: String): JComponent = AgentsSettingsUi(cs, dir)
    override fun update(ui: JComponent, dir: String) {
        (ui as? AgentsSettingsUi)?.setDirectory(dir)
    }
    override fun scrollReadyShell() = false

    companion object { const val ID = "ai.kilocode.jetbrains.settings.agentBehavior.agents" }
}

internal class AgentsSettingsUi(
    private val cs: CoroutineScope,
    private var dir: String,
    private val create: (Collection<String>) -> AgentCreateDialogHandle = ::AgentCreateDialog,
    private val choose: (JComponent) -> VirtualFile? = ::chooseImportFile,
) : SettingsListPanel(cs, ActiveListConfig.Equal), SettingsDraftPage {
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
    private lateinit var picker: ComboBox<String>
    private var syncing = false

    init {
        start()
    }

    fun setDirectory(value: String) {
        if (value == dir) return
        dir = value
        reload()
    }

    override suspend fun fetch(): List<ActiveListItem> {
        val agents = service<KiloAgentBehaviorService>().agents(dir)
        models = items(service<KiloWorkspaceService>().models(dir).providers)
        val next = agentsDraft(service<KiloAppService>().state.value.config, agents)
        val dirty = state.modified()
        val edit = draft
        state.accept(next)
        if (dirty) draft = rebaseAgents(next, edit)
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

    private fun makePicker(): ComboBox<String> {
        if (::picker.isInitialized) return picker
        picker = ComboBox(names.toTypedArray()).apply {
            selectedItem = draft.defaultAgent.orEmpty()
            addActionListener {
                if (syncing) return@addActionListener
                state.update { copy(defaultAgent = (selectedItem as? String)?.takeIf { it.isNotBlank() }) }
            }
        }
        return picker
    }

    override fun onCell(key: String, cellId: String) {
        if (cellId == UNDO_CELL) {
            undo(key)
            return
        }
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
        val token = state.start() ?: return
        syncNames()
        syncPicker()
        view.update(rows())
        if (!launch("apply") { id ->
            val target = token.target
            var pending = target
            var failed: String? = null
            var changed = false
            val behavior = service<KiloAgentBehaviorService>()
            val app = service<KiloAppService>()
            for (name in target.deleted) {
                if (!behavior.removeAgent(dir, name)) {
                    failed = KiloBundle.message("settings.agentBehavior.agents.delete.failed")
                    break
                }
                pending = pending.copy(
                    defaultAgent = pending.defaultAgent.takeUnless { it == name },
                    agents = pending.agents - name,
                    deleted = pending.deleted - name,
                )
                changed = true
            }
            if (failed == null) {
                for ((name, input) in target.created) {
                    if (!behavior.createAgent(dir, input)) {
                        failed = KiloBundle.message("settings.agentBehavior.agents.create.failed")
                        break
                    }
                    pending = pending.copy(created = pending.created - name)
                    changed = true
                }
            }
            if (failed == null) {
                for ((name, item) in target.imported) {
                    if (app.updateConfig(item) == null) {
                        failed = KiloBundle.message("settings.agentBehavior.agents.import.failed")
                        break
                    }
                    pending = pending.copy(imported = pending.imported - name)
                    changed = true
                }
            }
            if (failed == null) {
                val change = patch(base, target)
                if (change != null && app.updateConfig(change) == null) {
                    failed = KiloBundle.message("settings.agentBehavior.save.failed")
                }
                if (failed == null && change != null) changed = true
            }
            if (changed) waitForReady()
            val agents = behavior.agents(dir)
            val next = agentsDraft(app.state.value.config, agents)
            withContext(edt) {
                if (!active(id)) {
                    if (failed != null) KiloNotifications.error(failed)
                    return@withContext
                }
                details = agents
                if (failed != null) {
                    draft = rebaseAgents(next, pending)
                    this@AgentsSettingsUi.state.fail(token, failed)
                    showError(failed)
                } else {
                    this@AgentsSettingsUi.state.complete(token, token.target)
                    this@AgentsSettingsUi.state.accept(next)
                    clearProgress()
                }
                syncNames()
                syncPicker()
                view.update(rows())
                setBusy(false)
            }
        }) return
        showProgress(KiloBundle.message("settings.agentBehavior.saving"))
    }

    override fun resetDraft() {
        state.reset()
        syncNames()
        syncPicker()
        view.update(rows())
    }

    private fun rows(): List<ActiveListItem> = displayRows(base, draft).map { row ->
        val item = row.agent
        object : ActiveListItem {
            override val key = item.name
            override val title = item.displayName ?: item.name
            override val description = item.description
            override val badges = listOfNotNull(
                ActiveListBadge(
                    KiloBundle.message("settings.agentBehavior.badge.notApplied"),
                    UiStyle.Badge.Secondary,
                ).takeIf { row.intent == AgentIntent.Modified || row.intent == AgentIntent.New },
                ActiveListBadge(
                    KiloBundle.message("settings.agentBehavior.badge.willRemove"),
                    UiStyle.Badge.Alert,
                ).takeIf { row.intent == AgentIntent.PendingDelete },
                ActiveListBadge(
                    KiloBundle.message("settings.agentBehavior.badge.subagent"),
                    UiStyle.Badge.Highlight,
                ).takeIf { KiloCliParser.isSubagent(item.mode) },
                ActiveListBadge(
                    KiloBundle.message("settings.agentBehavior.badge.custom"),
                    UiStyle.Badge.Primary,
                ).takeIf { canDelete(item) },
                ActiveListBadge(KiloBundle.message("settings.agentBehavior.badge.hidden")).takeIf { item.hidden },
                ActiveListBadge(KiloBundle.message("settings.agentBehavior.badge.disabled")).takeIf { item.disable },
                ActiveListBadge(
                    KiloBundle.message("settings.agentBehavior.badge.deprecated"),
                    UiStyle.Badge.Alert,
                ).takeIf { item.deprecated },
            )
            override val cells = when (row.intent) {
                AgentIntent.New,
                AgentIntent.PendingDelete,
                -> listOf(ActiveListCell(UNDO_CELL, KiloBundle.message("settings.agentBehavior.undo"), primary = true))
                AgentIntent.Unchanged,
                AgentIntent.Modified,
                -> listOfNotNull(
                    ActiveListCell(EDIT_CELL, KiloBundle.message("settings.agentBehavior.edit")),
                    ActiveListCell(
                    DELETE_CELL,
                    KiloBundle.message("common.delete"),
                    icon = AllIcons.Actions.GC,
                    iconOnly = true,
                    ).takeIf { canDelete(item) },
                )
            }
        }
    }

    private fun remove(agent: AgentEditDraft) {
        if (!canDelete(agent)) return
        state.update {
            copy(
                defaultAgent = defaultAgent.takeUnless { it == agent.name },
                deleted = deleted + agent.name,
            )
        }
        syncNames()
        syncPicker()
        view.update(rows(), ActiveListSelection.Key(agent.name))
    }

    private fun undo(name: String) {
        state.update {
            copy(
                defaultAgent = if (defaultAgent == null && base.defaultAgent == name) name else defaultAgent.takeUnless { it == name && name !in agents },
                created = created - name,
                imported = imported - name,
                deleted = deleted - name,
            )
        }
        syncNames()
        syncPicker()
        view.update(rows(), ActiveListSelection.Key(name))
    }

    private fun syncNames() {
        names = listOf("") + displayRows(base, draft)
            .filter { it.intent != AgentIntent.PendingDelete }
            .map { it.agent }
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
        add(ImportAction())
    }

    internal inner class CreateAction : DumbAwareAction(KiloBundle.message("settings.agentBehavior.agents.create")) {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT

        override fun actionPerformed(e: AnActionEvent) = perform()

        internal fun perform() {
            val dialog = create(taken())
            if (!dialog.showAndGet()) return
            val input = dialog.result()
            state.update {
                copy(created = created + (input.name to input))
            }
            syncNames()
            syncPicker()
            view.update(rows(), ActiveListSelection.Key(input.name))
        }
    }

    internal inner class ImportAction : DumbAwareAction(KiloBundle.message("settings.agentBehavior.agents.import")) {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT

        override fun actionPerformed(e: AnActionEvent) = perform()

        internal fun perform(file: VirtualFile? = choose(this@AgentsSettingsUi)) {
            val source = file ?: return
            val names = taken()
            if (!launch("import") { id ->
                val input = withContext(Dispatchers.IO) { load(source, names) }
                withContext(edt) {
                    if (!active(id)) return@withContext
                    this@AgentsSettingsUi.state.update { copy(imported = imported + (input.name to input.patch)) }
                    syncNames()
                    syncPicker()
                    view.update(rows(), ActiveListSelection.Key(input.name))
                    setBusy(false)
                    clearProgress()
                }
            }) return
            showProgress(KiloBundle.message("settings.agentBehavior.agents.import.progress"))
        }

        private fun load(file: VirtualFile, names: Collection<String>): AgentImport {
            if (file.length > MAX_AGENT_IMPORT_SIZE) {
                throw SettingsMessageException(KiloBundle.message(AgentImportError.TOO_LARGE.key))
            }
            val text = String(file.contentsToByteArray(), StandardCharsets.UTF_8)
            return try {
                parseAgentImport(text, names)
            } catch (e: AgentImportException) {
                throw SettingsMessageException(KiloBundle.message(e.error.key))
            }
        }
    }

    private companion object {
        const val EDIT_CELL = "edit"
        const val DELETE_CELL = "delete"
        const val UNDO_CELL = "undo"
        const val KILO_PROVIDER = "kilo"
    }

    private fun taken(): Collection<String> = draft.agents.keys + draft.created.keys + draft.imported.keys

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

private fun chooseImportFile(_parent: JComponent): VirtualFile? {
    val descriptor = FileChooserDescriptor(true, false, false, false, false, false).apply {
        title = KiloBundle.message("settings.agentBehavior.agents.import.title")
        description = KiloBundle.message("settings.agentBehavior.agents.import.description")
        withFileFilter { file -> !file.isDirectory && file.extension.equals("json", ignoreCase = true) }
    }
    return FileChooser.chooseFile(descriptor, null, null as VirtualFile?)
}
