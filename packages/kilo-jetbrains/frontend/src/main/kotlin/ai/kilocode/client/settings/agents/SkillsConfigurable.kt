package ai.kilocode.client.settings.agents

import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.settings.base.SettingsBadge
import ai.kilocode.client.settings.base.SettingsDraftPage
import ai.kilocode.client.settings.base.SettingsDraftState
import ai.kilocode.client.settings.base.SettingsListCell
import ai.kilocode.client.settings.base.SettingsListConfig
import ai.kilocode.client.settings.base.SettingsListItem
import ai.kilocode.client.settings.base.SettingsListPanel
import ai.kilocode.client.settings.base.SettingsListSelection
import ai.kilocode.client.settings.base.SettingsListView
import ai.kilocode.client.settings.base.SettingsMessageException
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.SkillsConfigDto
import ai.kilocode.rpc.dto.SkillsPatchDto
import ai.kilocode.rpc.dto.SkillDto
import com.intellij.CommonBundle
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.fileTypes.UnknownFileType
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.EditorTextField
import com.intellij.ui.TitledSeparator
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.awt.BorderLayout
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.ListSelectionModel

private val edt = Dispatchers.EDT + ModalityState.any().asContextElement()

class SkillsConfigurable : AgentBehaviorConfigurableBase<JComponent>() {
    override fun getId(): String = ID
    override fun getDisplayName(): String = KiloBundle.message("settings.agentBehavior.skills.displayName")
    override fun create(cs: CoroutineScope, dir: String): JComponent = SkillsSettingsUi(cs, dir)
    override fun update(ui: JComponent, dir: String) {
        (ui as? SkillsSettingsUi)?.setDirectory(dir)
    }
    override fun scrollReadyShell() = false

    companion object { const val ID = "ai.kilocode.jetbrains.settings.agentBehavior.skills" }
}

internal class SkillsSettingsUi(
    scope: CoroutineScope,
    dir: String,
    private val choose: (JComponent) -> String? = ::chooseSkillPath,
    private val input: (String, String) -> String? = ::inputSkillUrl,
    private val edit: (SkillDto, Boolean) -> SkillEditDialogHandle = ::SkillEditDialog,
) : SettingsListPanel(scope, SettingsListConfig.Equal.copy(tooltip = false)), SettingsDraftPage {
    private val cs = scope
    private var dir = dir
    private var skills = emptyMap<String, SkillDto>()
    private val app get() = service<KiloAppService>()
    private val state = SettingsDraftState(skillsDraft(app.state.value.config?.skills ?: SkillsConfigDto()), ::saved)
    private var draft: SkillsDraft
        get() = state.draft
        set(value) {
            state.draft = value
        }
    internal val sources = SkillSourcesView(this, choose, input)

    init {
        start()
        setCenter(skillScroll())
        content.add(sources, BorderLayout.SOUTH)
    }

    fun setDirectory(value: String) {
        if (value == dir) return
        dir = value
        reload()
    }

    override suspend fun fetch(): List<SettingsListItem> {
        val items = withTimeoutOrNull(SKILL_LOAD_TIMEOUT_MS) {
            service<KiloAgentBehaviorService>().skills(dir)
        } ?: throw SettingsMessageException(KiloBundle.message("settings.agentBehavior.skills.load.timeout"))
        withContext(edt) {
            val dirty = state.modified()
            val edit = draft
            state.accept(skillsDraft(config()))
            if (dirty) draft = state.draft.copy(edited = edit.edited, deleted = edit.deleted)
            skills = items.associateBy { key(it) }
            sources.refresh(draft.sources)
        }
        LOG.info("skills settings fetch dir=$dir total=${items.size}")
        return rows(items)
    }

    override fun afterApply() {
        sources.refresh(draft.sources)
    }

    override fun onCell(key: String, cellId: String) {
        val skill = skills[key] ?: return
        when (cellId) {
            OPEN_CELL -> open(skill)
            EDIT_CELL -> edit(skill)
            DELETE_CELL -> remove(skill)
        }
    }

    override fun searchPlaceholder() = KiloBundle.message("settings.agentBehavior.skills.search")

    override fun emptyText() = KiloBundle.message("settings.agentBehavior.skills.empty")

    internal fun updateSources(paths: List<String>, urls: List<String>) {
        state.update { copy(sources = SkillsConfigDto(paths = paths, urls = urls)) }
        sources.refresh(draft.sources)
    }

    override fun modified(): Boolean = state.modified()

    override fun resetDraft() {
        state.reset()
        sources.refresh(draft.sources)
        view.update(rows())
        clearProgress()
    }

    override fun applyDraft() {
        val token = state.start() ?: return
        if (!launch("apply") { id ->
            val target = token.target
            var failed: String? = null
            val behavior = service<KiloAgentBehaviorService>()
            LOG.info("skills settings apply start dir=$dir edited=${target.edited.size} deleted=${target.deleted.size} paths=${target.sources.paths.size} urls=${target.sources.urls.size}")
            for ((location, content) in target.edited) {
                if (!behavior.saveSkill(dir, location, content)) {
                    failed = KiloBundle.message("settings.agentBehavior.save.failed")
                    break
                }
            }
            if (failed == null) {
                for (location in target.deleted) {
                    if (!behavior.removeSkill(dir, location)) {
                        failed = KiloBundle.message("settings.agentBehavior.skills.delete.failed")
                        break
                    }
                }
            }
            if (failed == null && target.sources != token.previous.sources) {
                val patch = ConfigPatchDto(skills = SkillsPatchDto(paths = target.sources.paths, urls = target.sources.urls))
                if (app.updateConfig(patch) == null) failed = KiloBundle.message("settings.agentBehavior.save.failed")
            }
            val items = behavior.skills(dir)
            withContext(edt) {
                if (!active(id)) {
                    if (failed == null) KiloNotifications.info(KiloBundle.message("settings.agentBehavior.skills.saved.notification"))
                    else KiloNotifications.error(failed)
                    return@withContext
                }
                if (failed == null) {
                    skills = items.associateBy { key(it) }
                    val next = skillsDraft(config())
                    state.complete(token, next)
                    sources.refresh(draft.sources)
                    view.update(rows(items))
                    clearProgress()
                    LOG.info("skills settings apply succeeded dir=$dir")
                } else {
                    state.fail(token, failed)
                    sources.refresh(draft.sources)
                    view.update(rows(items))
                    showError(failed)
                    LOG.warn("skills settings apply failed dir=$dir message=$failed")
                }
                setBusy(false)
            }
        }) return
        showProgress(KiloBundle.message("settings.agentBehavior.saving"))
    }

    private fun skillScroll() = JBScrollPane(view).apply {
        border = null
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
    }

    private fun rows(items: List<SkillDto> = skills.values.toList()): List<SettingsListItem> = items.mapNotNull { skill ->
        if (skill.location in draft.deleted) return@mapNotNull null
        item(skill)
    }

    private fun item(skill: SkillDto) = object : SettingsListItem {
        override val key = key(skill)
        override val title = skill.name
        override val note = skill.location.takeUnless { builtin(it) }
        override val description = skill.description
        override val doubleClick = EDIT_CELL
        override val badges = listOf(
            SettingsBadge(KiloBundle.message("settings.agentBehavior.badge.builtin"), UiStyle.Badge.Secondary),
        ).takeIf { builtin(skill.location) } ?: emptyList()
        override val cells = listOfNotNull(
            SettingsListCell(
                OPEN_CELL,
                KiloBundle.message("settings.agentBehavior.skills.openInEditor"),
                primary = true,
            ).takeUnless { builtin(skill.location) },
            SettingsListCell(
                EDIT_CELL,
                KiloBundle.message("settings.agentBehavior.edit"),
                primary = builtin(skill.location),
            ),
            SettingsListCell(
                DELETE_CELL,
                KiloBundle.message("common.delete"),
                icon = AllIcons.Actions.GC,
                iconOnly = true,
            ).takeUnless { builtin(skill.location) },
        )
    }

    private fun edit(skill: SkillDto) {
        val current = skill.copy(content = content(skill))
        val dialog = edit(current, !builtin(skill.location))
        if (!dialog.showAndGet()) return
        state.update { copy(edited = edited + (skill.location to dialog.content())) }
        view.update(rows(), SettingsListSelection.Key(key(skill)))
    }

    private fun open(skill: SkillDto) {
        if (builtin(skill.location)) return
        showProgress(KiloBundle.message("settings.agentBehavior.skills.openInEditor.pending"))
        cs.launch {
            val opened = service<KiloWorkspaceService>().openFile(skill.location)
            if (opened) return@launch
            withContext(edt) { KiloNotifications.error(KiloBundle.message("settings.agentBehavior.skills.openInEditor.failed")) }
        }
    }

    private fun remove(skill: SkillDto) {
        val result = Messages.showYesNoDialog(
            KiloBundle.message("settings.agentBehavior.skills.delete.message", skill.name),
            KiloBundle.message("settings.agentBehavior.skills.delete.title"),
            KiloBundle.message("common.delete"),
            Messages.getCancelButton(),
            Messages.getQuestionIcon(),
        )
        if (result != Messages.YES) return
        state.update { copy(deleted = deleted + skill.location, edited = edited - skill.location) }
        view.update(rows(), selectionIndex())
    }

    private fun content(skill: SkillDto) = draft.edited[skill.location] ?: skill.content

    private fun config() = app.state.value.config?.skills ?: SkillsConfigDto()

    private companion object {
        const val EDIT_CELL = "edit"
        const val OPEN_CELL = "open"
        const val DELETE_CELL = "delete"
        const val BUILTIN = "builtin"
        const val LEGACY_BUILTIN = "<built-in>"
        val LOG = KiloLog.create(SkillsSettingsUi::class.java)

        fun key(skill: SkillDto) = skill.location.ifBlank { skill.name }
        fun builtin(location: String) = location == BUILTIN || location == LEGACY_BUILTIN
    }
}

internal interface SkillEditDialogHandle {
    fun showAndGet(): Boolean
    fun content(): String
}

private data class SkillsDraft(
    val sources: SkillsConfigDto,
    val edited: Map<String, String> = emptyMap(),
    val deleted: Set<String> = emptySet(),
)

private fun skillsDraft(sources: SkillsConfigDto) = SkillsDraft(sources)

private fun saved(base: SkillsDraft, draft: SkillsDraft): Boolean = base == draft

internal class SkillEditDialog(private val skill: SkillDto, private val savable: Boolean) : DialogWrapper(true), SkillEditDialogHandle {
    private val base = initial()
    private val editor = SkillEditor(base, skill.location, savable)

    init {
        title = skill.name
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

    override fun createCenterPanel(): JComponent = JBScrollPane(editor).apply {
        viewportBorder = editorPad()
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        preferredSize = JBUI.size(720, 520)
    }

    override fun createActions() = if (savable) arrayOf(okAction, cancelAction) else arrayOf(cancelAction)

    override fun content() = editor.text

    private fun initial() = skill.content?.takeIf { it.isNotBlank() }
        ?: skill.description?.takeIf { it.isNotBlank() }
        ?: KiloBundle.message("settings.agentBehavior.skills.content.empty")

    private class SkillEditor(value: String, location: String, editable: Boolean) : EditorTextField(
        EditorFactory.getInstance().createDocument(value),
        ProjectManager.getInstance().defaultProject,
        skillFileType(location),
        false,
        !editable,
    ) {
        init {
            border = JBUI.Borders.empty()
            setOneLineMode(false)
            addSettingsProvider { ed ->
                ed.setBorder(JBUI.Borders.empty())
                ed.scrollPane.border = JBUI.Borders.empty()
                ed.scrollPane.viewportBorder = JBUI.Borders.empty()
                ed.settings.isUseSoftWraps = true
                ed.settings.isPaintSoftWraps = false
                ed.settings.isAdditionalPageAtBottom = false
                ed.scrollPane.horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
                ed.scrollPane.verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
            }
        }
    }
}

internal class SkillSourcesView(
    private val parent: SkillsSettingsUi,
    private val choose: (JComponent) -> String?,
    private val input: (String, String) -> String?,
) : Stack(ai.kilocode.client.ui.layout.StackAxis.VERTICAL, UiStyle.Gap.sm()) {
    private val view = SettingsListView(
        KiloBundle.message("settings.agentBehavior.skills.sources.empty"),
        SettingsListConfig.Preferred.copy(description = false, selection = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION),
    ) { key, id ->
        if (id == EDIT_CELL) edit(key)
    }
    private var cfg = SkillsConfigDto()

    internal fun sourceList() = view.list

    init {
        border = JBUI.Borders.empty(UiStyle.Gap.pad(), 0, 0, 0)
        next(TitledSeparator(KiloBundle.message("settings.agentBehavior.skills.sources.title")))
        next(toolbar())
        next(JBScrollPane(view).apply {
            border = null
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            preferredSize = JBUI.size(0, JBUI.scale(160))
            maximumSize = JBUI.size(Int.MAX_VALUE, JBUI.scale(160))
        })
    }

    fun refresh(config: SkillsConfigDto) {
        cfg = config
        view.update(rows(config))
    }

    private fun toolbar(): JComponent {
        val add = DefaultActionGroup(KiloBundle.message("settings.agentBehavior.skills.sources.add"), true).apply {
            templatePresentation.icon = AllIcons.General.Add
            add(AddPathAction())
            add(AddUrlAction())
        }
        val group = DefaultActionGroup(add, RemoveAction())
        val toolbar = ActionManager.getInstance().createActionToolbar(ActionPlaces.TOOLBAR, group, true)
        toolbar.targetComponent = this
        toolbar.updateActionsImmediately()
        return toolbar.component
    }

    internal fun addPath() {
        val path = choose(parent)?.trim()?.takeIf { it.isNotBlank() } ?: return
        if (path in cfg.paths) return
        parent.updateSources(cfg.paths + path, cfg.urls)
    }

    internal fun addUrl() {
        val url = input(
            KiloBundle.message("settings.agentBehavior.skills.sources.addUrl.title"),
            KiloBundle.message("settings.agentBehavior.skills.sources.addUrl.prompt"),
        )?.trim()?.takeIf { it.isNotBlank() } ?: return
        if (url in cfg.urls) return
        parent.updateSources(cfg.paths, cfg.urls + url)
    }

    private fun rows(config: SkillsConfigDto): List<SettingsListItem> {
        val paths = config.paths.map { source(PATH_PREFIX, it) }
        val urls = config.urls.map { source(URL_PREFIX, it) }
        return paths + urls
    }

    private fun source(prefix: String, value: String) = object : SettingsListItem {
        override val key = prefix + value
        override val title = value
        override val doubleClick = EDIT_CELL
    }

    internal fun removeSelected() {
        val keys = view.selectedItems().map { it.key }.toSet()
        if (keys.isEmpty()) return
        val paths = cfg.paths.filterNot { PATH_PREFIX + it in keys }
        val urls = cfg.urls.filterNot { URL_PREFIX + it in keys }
        parent.updateSources(paths, urls)
    }

    private fun edit(key: String) {
        val path = key.startsWith(PATH_PREFIX)
        val old = key.removePrefix(if (path) PATH_PREFIX else URL_PREFIX)
        val dialog = SkillSourceDialog(old, path, choose)
        if (!dialog.showAndGet()) return
        val next = dialog.value().trim().takeIf { it.isNotBlank() } ?: return
        if (path) {
            parent.updateSources(cfg.paths.map { if (it == old) next else it }.distinct(), cfg.urls)
            return
        }
        parent.updateSources(cfg.paths, cfg.urls.map { if (it == old) next else it }.distinct())
    }

    private inner class AddPathAction : DumbAwareAction(
        KiloBundle.message("settings.agentBehavior.skills.sources.addPath"),
        null,
        null,
    ) {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT
        override fun actionPerformed(e: AnActionEvent) = addPath()
    }

    private inner class AddUrlAction : DumbAwareAction(
        KiloBundle.message("settings.agentBehavior.skills.sources.addUrl"),
        null,
        null,
    ) {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT
        override fun actionPerformed(e: AnActionEvent) = addUrl()
    }

    private inner class RemoveAction : DumbAwareAction(
        KiloBundle.message("common.delete"),
        null,
        AllIcons.General.Remove,
    ) {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT
        override fun update(e: AnActionEvent) {
            e.presentation.isEnabled = view.selectedItems().isNotEmpty()
        }
        override fun actionPerformed(e: AnActionEvent) = removeSelected()
    }

    private companion object {
        const val EDIT_CELL = "edit"
        const val PATH_PREFIX = "path:"
        const val URL_PREFIX = "url:"
    }
}

private class SkillSourceDialog(
    value: String,
    private val path: Boolean,
    private val choose: (JComponent) -> String?,
) : DialogWrapper(true) {
    private val field = JBTextField(value)

    init {
        title = if (path) KiloBundle.message("settings.agentBehavior.skills.sources.editPath.title")
        else KiloBundle.message("settings.agentBehavior.skills.sources.editUrl.title")
        setOKButtonText(KiloBundle.message("common.save"))
        init()
    }

    override fun createCenterPanel(): JComponent {
        if (!path) return field.apply { columns = SOURCE_COLUMNS }
        return JPanel(BorderLayout(UiStyle.Gap.sm(), 0)).apply {
            add(field.apply { columns = SOURCE_COLUMNS }, BorderLayout.CENTER)
            add(JButton("...").apply {
                addActionListener {
                    choose(this)?.let { field.text = it }
                }
            }, BorderLayout.EAST)
        }
    }

    fun value() = field.text
}

private fun chooseSkillPath(parent: JComponent): String? {
    return FileChooser.chooseFile(skillPathDescriptor(), parent, null, null as VirtualFile?)?.path
}

internal fun skillPathDescriptor() = FileChooserDescriptor(false, true, false, false, false, false).apply {
    title = KiloBundle.message("settings.agentBehavior.skills.sources.addPath.title")
    description = KiloBundle.message("settings.agentBehavior.skills.sources.addPath.prompt")
}

internal fun skillFileType(location: String): FileType {
    val name = location.substringAfterLast('/').substringAfterLast('\\').ifBlank { SKILL_FILE }
    val type = FileTypeManager.getInstance().getFileTypeByFileName(name)
    if (type == UnknownFileType.INSTANCE) return PlainTextFileType.INSTANCE
    return type
}

private fun inputSkillUrl(title: String, prompt: String): String? = Messages.showInputDialog(
    prompt,
    title,
    Messages.getQuestionIcon(),
)

private fun editorPad() = JBUI.Borders.empty(
    JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
    JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
    JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
    JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
)

private const val SOURCE_COLUMNS = 60
private const val SKILL_FILE = "SKILL.md"
private const val SKILL_LOAD_TIMEOUT_MS = 10_000L
