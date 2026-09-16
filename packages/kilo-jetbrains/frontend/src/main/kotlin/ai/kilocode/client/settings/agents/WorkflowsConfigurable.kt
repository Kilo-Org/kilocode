package ai.kilocode.client.settings.agents

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.SettingsDraftPage
import ai.kilocode.client.settings.base.SettingsDraftState
import ai.kilocode.client.settings.base.SettingsListPanel
import ai.kilocode.client.settings.base.SettingsMessageException
import ai.kilocode.client.settings.base.settingsContentScroll
import ai.kilocode.client.settings.base.settingsEditorFileType
import ai.kilocode.client.ui.CodeViewField
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListCell
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.CommandFileDto
import com.intellij.CommonBundle
import com.intellij.icons.AllIcons
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.ui.components.JBScrollPane
import javax.swing.JComponent
import javax.swing.ScrollPaneConstants
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

private val workflowEdt = Dispatchers.EDT + ModalityState.any().asContextElement()

class WorkflowsConfigurable : AgentBehaviorConfigurableBase<JComponent>() {
    override fun getId(): String = ID
    override fun getDisplayName(): String = KiloBundle.message("settings.agentBehavior.workflows.displayName")
    override fun create(cs: CoroutineScope, dir: String): JComponent = WorkflowsSettingsUi(cs, dir)
    override fun update(ui: JComponent, dir: String) {
        (ui as? WorkflowsSettingsUi)?.setDirectory(dir)
    }
    override fun scrollReadyShell() = false

    companion object { const val ID = "ai.kilocode.jetbrains.settings.agentBehavior.workflows" }
}

internal class WorkflowsSettingsUi(
    scope: CoroutineScope,
    dir: String,
    private val edit: (CommandFileDto, Boolean) -> WorkflowEditDialogHandle = ::WorkflowEditDialog,
) : SettingsListPanel(scope, ActiveListConfig.Equal.copy(tooltip = false)), SettingsDraftPage {
    private var dir = dir
    private var flows = emptyMap<String, CommandFileDto>()
    private val state = SettingsDraftState(workflowsDraft(), ::saved)
    private var draft: WorkflowsDraft
        get() = state.draft
        set(value) {
            state.draft = value
        }

    init {
        start()
        setCenter(workflowsScroll())
    }

    fun setDirectory(value: String) {
        if (value == dir) return
        dir = value
        reload()
    }

    override suspend fun fetch(): List<ActiveListItem> {
        val items = withTimeoutOrNull(WORKFLOW_LOAD_TIMEOUT_MS) {
            service<KiloAgentBehaviorService>().loadCommandFiles(dir)
        } ?: throw SettingsMessageException(KiloBundle.message("settings.agentBehavior.workflows.load.timeout"))
        withContext(workflowEdt) {
            val dirty = state.modified()
            val edit = draft
            state.accept(workflowsDraft())
            if (dirty) draft = state.draft.copy(edited = edit.edited, deleted = edit.deleted)
            flows = items.associateBy { key(it) }
        }
        LOG.info("workflows settings fetch dir=$dir total=${items.size}")
        return rows(items)
    }

    override fun onCell(key: String, cellId: String) {
        val flow = flows[key] ?: return
        when (cellId) {
            OPEN_CELL -> open(flow)
            EDIT_CELL -> edit(flow)
            DELETE_CELL -> remove(flow)
        }
    }

    override fun searchPlaceholder() = KiloBundle.message("settings.agentBehavior.workflows.search")

    override fun emptyText() = KiloBundle.message("settings.agentBehavior.workflows.empty")

    override fun modified(): Boolean = state.modified()

    override fun resetDraft() {
        state.reset()
        view.update(rows())
        clearProgress()
    }

    override fun applyDraft() {
        val token = state.start() ?: return
        val fallback = workflowFallback(token.target)
        if (!launch("apply") { id ->
            val target = token.target
            var failed: String? = null
            val behavior = service<KiloAgentBehaviorService>()
            LOG.info("workflows settings apply start dir=$dir edited=${target.edited.size} deleted=${target.deleted.size}")
            if (target.edited.isNotEmpty() && !behavior.saveCommands(dir, target.edited)) {
                failed = KiloBundle.message("settings.agentBehavior.save.failed")
            }
            if (failed == null) {
                for (location in target.deleted) {
                    if (!behavior.removeCommand(dir, location)) {
                        failed = KiloBundle.message("settings.agentBehavior.workflows.delete.failed")
                        break
                    }
                }
            }
            val reloaded = if (failed == null) behavior.reloadCommands(dir) else true
            val items = behavior.refreshCommandFiles(dir, fallback)
            withContext(workflowEdt) {
                if (!active(id)) {
                    if (failed == null) KiloNotifications.info(KiloBundle.message("settings.agentBehavior.workflows.saved.notification"))
                    else KiloNotifications.error(failed)
                    return@withContext
                }
                if (failed == null) {
                    flows = items.associateBy { key(it) }
                    state.complete(token, workflowsDraft())
                    view.update(rows(items))
                    if (reloaded) clearProgress() else showProgress(KiloBundle.message("settings.agentBehavior.workflows.reload.blocked"))
                    LOG.info("workflows settings apply succeeded dir=$dir")
                } else {
                    state.fail(token, failed)
                    view.update(rows(items))
                    showError(failed)
                    LOG.warn("workflows settings apply failed dir=$dir message=$failed")
                }
                setBusy(false)
            }
        }) {
            val failed = KiloBundle.message("settings.agentBehavior.save.failed")
            state.fail(token, failed)
            showError(failed)
            return
        }
        showProgress(KiloBundle.message("settings.agentBehavior.saving"))
    }

    private fun workflowsScroll() = JBScrollPane(view).apply {
        border = null
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
    }

    private fun rows(items: List<CommandFileDto> = flows.values.toList()): List<ActiveListItem> = items.mapNotNull { flow ->
        if (flow.location in draft.deleted) return@mapNotNull null
        item(flow)
    }

    private fun workflowFallback(target: WorkflowsDraft): List<CommandFileDto> = flows.values.mapNotNull { flow ->
        if (flow.location in target.deleted) return@mapNotNull null
        target.edited[flow.location]?.let { flow.copy(content = it) } ?: flow
    }

    private fun item(flow: CommandFileDto) = object : ActiveListItem {
        override val key = key(flow)
        override val title = "/${flow.name}"
        override val note = flow.location.takeUnless { builtin(flow) }
        override val description = flow.description
        override val doubleClick = EDIT_CELL
        override val badges = listOf(
            ActiveListBadge(KiloBundle.message("settings.agentBehavior.badge.builtin"), UiStyle.Badge.Secondary),
        ).takeIf { builtin(flow) } ?: emptyList()
        override val cells = listOfNotNull(
            ActiveListCell(
                OPEN_CELL,
                KiloBundle.message("settings.agentBehavior.workflows.openInEditor"),
                primary = true,
            ).takeIf { flow.editable },
            ActiveListCell(
                EDIT_CELL,
                KiloBundle.message(if (flow.editable) "settings.agentBehavior.edit" else "common.open"),
                primary = !flow.editable,
            ),
            ActiveListCell(
                DELETE_CELL,
                KiloBundle.message("common.delete"),
                icon = AllIcons.Actions.GC,
                iconOnly = true,
            ).takeIf { flow.editable },
        )
    }

    private fun edit(flow: CommandFileDto) {
        val current = flow.copy(content = content(flow))
        val dialog = edit(current, flow.editable)
        if (!flow.editable) {
            dialog.showAndGet()
            return
        }
        if (!dialog.showAndGet()) return
        state.update { copy(edited = edited + (flow.location to dialog.content())) }
        view.update(rows(), ActiveListSelection.Key(key(flow)))
    }

    private fun open(flow: CommandFileDto) {
        if (!flow.editable) return
        if (!launch("open") { id ->
            val opened = service<KiloWorkspaceService>().openFile(flow.location)
            withContext(workflowEdt) {
                if (!active(id)) return@withContext
                setBusy(false)
                if (opened) return@withContext
                clearProgress()
                KiloNotifications.error(KiloBundle.message("settings.agentBehavior.workflows.openInEditor.failed"))
            }
        }) return
        showProgress(KiloBundle.message("settings.agentBehavior.workflows.openInEditor.pending"))
    }

    private fun remove(flow: CommandFileDto) {
        val result = Messages.showYesNoDialog(
            KiloBundle.message("settings.agentBehavior.workflows.delete.message", flow.name),
            KiloBundle.message("settings.agentBehavior.workflows.delete.title"),
            KiloBundle.message("common.delete"),
            Messages.getCancelButton(),
            Messages.getQuestionIcon(),
        )
        if (result != Messages.YES) return
        state.update { copy(deleted = deleted + flow.location, edited = edited - flow.location) }
        view.update(rows(), ActiveListSelection.Slide)
    }

    private fun content(flow: CommandFileDto) = draft.edited[flow.location] ?: flow.content

    private companion object {
        const val EDIT_CELL = "edit"
        const val OPEN_CELL = "open"
        const val DELETE_CELL = "delete"
        const val BUILTIN = "builtin"
        const val LEGACY_BUILTIN = "<built-in>"
        val LOG = KiloLog.create(WorkflowsSettingsUi::class.java)

        fun key(flow: CommandFileDto) = if (builtin(flow)) {
            listOf("builtin", flow.source.orEmpty(), flow.name).joinToString(":")
        } else {
            flow.location.ifBlank { flow.name }
        }
        fun builtin(flow: CommandFileDto) = flow.builtin || flow.location == BUILTIN || flow.location == LEGACY_BUILTIN
    }
}

internal interface WorkflowEditDialogHandle {
    fun showAndGet(): Boolean
    fun content(): String
}

private data class WorkflowsDraft(
    val edited: Map<String, String> = emptyMap(),
    val deleted: Set<String> = emptySet(),
)

private fun workflowsDraft() = WorkflowsDraft()

private fun saved(base: WorkflowsDraft, draft: WorkflowsDraft): Boolean = base == draft

internal class WorkflowEditDialog(private val flow: CommandFileDto, private val savable: Boolean) : DialogWrapper(true), WorkflowEditDialogHandle {
    private val base = initial()
    private val editor = CodeViewField(base, workflowFileType(flow.location, base), savable)

    init {
        title = "/${flow.name}"
        setOKButtonText(CommonBundle.getOkButtonText())
        setCancelButtonText(CommonBundle.getCloseButtonText())
        init()
        isOKActionEnabled = false
        editor.document.addDocumentListener(object : DocumentListener {
            override fun documentChanged(event: DocumentEvent) {
                isOKActionEnabled = savable && editor.text != base
            }
        })
    }

    override fun createCenterPanel(): JComponent = settingsContentScroll(editor)

    override fun createActions() = if (savable) arrayOf(okAction, cancelAction) else arrayOf(cancelAction)

    override fun content() = editor.text

    private fun initial() = flow.content?.takeIf { it.isNotBlank() }
        ?: flow.description?.takeIf { it.isNotBlank() }
        ?: KiloBundle.message("settings.agentBehavior.workflows.content.empty")
}

internal fun workflowFileType(location: String, content: String? = null): FileType =
    settingsEditorFileType(location.ifBlank { WORKFLOW_FILE }, content)

private const val WORKFLOW_FILE = "workflow.md"
private const val WORKFLOW_LOAD_TIMEOUT_MS = 10_000L
