package ai.kilocode.client.settings.agents

import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.SettingsBadge
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
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.components.service
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.ScrollPaneConstants

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
    cs: CoroutineScope,
    dir: String,
    private val choose: (JComponent) -> String? = ::chooseSkillPath,
    private val input: (String, String) -> String? = ::inputSkillUrl,
) : SettingsListPanel(cs, SettingsListConfig.Equal.copy(tooltip = false)) {
    private var dir = dir
    private var skills = emptyMap<String, SkillDto>()
    internal val sources = SkillSourcesView(this, choose, input)

    init {
        start()
        content.add(sources, BorderLayout.SOUTH)
    }

    fun setDirectory(value: String) {
        if (value == dir) return
        dir = value
        reload()
    }

    override suspend fun fetch(): List<SettingsListItem> {
        val items = service<KiloAgentBehaviorService>().skills(dir)
        val config = config()
        withContext(edt) {
            skills = items.associateBy { key(it) }
            sources.refresh(config)
        }
        LOG.info("skills settings fetch dir=$dir total=${items.size}")
        return items.map(::item)
    }

    override fun afterApply() {
        sources.refresh(config())
    }

    override fun onCell(key: String, cellId: String) {
        val skill = skills[key] ?: return
        when (cellId) {
            OPEN_CELL -> open(skill)
            DELETE_CELL -> remove(skill)
        }
    }

    override fun searchPlaceholder() = KiloBundle.message("settings.agentBehavior.skills.search")

    override fun emptyText() = KiloBundle.message("settings.agentBehavior.skills.empty")

    internal fun updateSources(paths: List<String>, urls: List<String>) {
        mutateAndReload(SettingsListSelection.Preserve, KiloBundle.message("settings.agentBehavior.saving")) {
            val patch = ConfigPatchDto(skills = SkillsPatchDto(paths = paths, urls = urls))
            if (service<KiloAppService>().updateConfig(patch) == null) {
                throw SettingsMessageException(KiloBundle.message("settings.agentBehavior.save.failed"))
            }
            true
        }
    }

    private fun item(skill: SkillDto) = object : SettingsListItem {
        override val key = key(skill)
        override val title = skill.name
        override val note = skill.location.takeUnless { builtin(it) }
        override val description = skill.description
        override val badges = listOf(
            SettingsBadge(KiloBundle.message("settings.agentBehavior.badge.builtin"), UiStyle.Badge.Secondary),
        ).takeIf { builtin(skill.location) } ?: emptyList()
        override val cells = if (builtin(skill.location)) emptyList() else listOf(
            SettingsListCell(
                OPEN_CELL,
                KiloBundle.message("settings.agentBehavior.skills.open"),
                primary = true,
            ),
            SettingsListCell(
                DELETE_CELL,
                KiloBundle.message("common.delete"),
                icon = AllIcons.Actions.GC,
                iconOnly = true,
            ),
        )
    }

    private fun open(skill: SkillDto) {
        launch("open") { id ->
            service<KiloWorkspaceService>().openFile(skill.location)
            finishOpen(id)
        }
    }

    private suspend fun finishOpen(id: Int) {
        withContext(edt) {
            if (!active(id)) return@withContext
            setBusy(false)
            clearProgress()
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
        mutateAndReload(selectionIndex()) {
            if (!service<KiloAgentBehaviorService>().removeSkill(dir, skill.location)) {
                throw SettingsMessageException(KiloBundle.message("settings.agentBehavior.skills.delete.failed"))
            }
            true
        }
    }

    private fun config() = service<KiloAppService>().state.value.config?.skills ?: SkillsConfigDto()

    private companion object {
        const val OPEN_CELL = "open"
        const val DELETE_CELL = "delete"
        const val BUILTIN = "builtin"
        const val LEGACY_BUILTIN = "<built-in>"
        val LOG = KiloLog.create(SkillsSettingsUi::class.java)

        fun key(skill: SkillDto) = skill.location.ifBlank { skill.name }
        fun builtin(location: String) = location == BUILTIN || location == LEGACY_BUILTIN
    }
}

internal class SkillSourcesView(
    private val parent: SkillsSettingsUi,
    private val choose: (JComponent) -> String?,
    private val input: (String, String) -> String?,
) : Stack(ai.kilocode.client.ui.layout.StackAxis.VERTICAL, UiStyle.Gap.sm()) {
    private val view = SettingsListView(
        KiloBundle.message("settings.agentBehavior.skills.sources.empty"),
        SettingsListConfig.Preferred.copy(description = false),
    ) { key, id ->
        if (id == DELETE_CELL) remove(key)
    }
    private var cfg = SkillsConfigDto()

    internal fun sourceList() = view.list

    init {
        border = JBUI.Borders.compound(
            JBUI.Borders.customLineTop(JBUI.CurrentTheme.CustomFrameDecorations.separatorForeground()),
            JBUI.Borders.empty(UiStyle.Gap.pad(), 0, 0, 0),
        )
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
        val group = DefaultActionGroup(AddPathAction(), AddUrlAction())
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
        val paths = config.paths.map { source(PATH_PREFIX, it, KiloBundle.message("settings.agentBehavior.skills.sources.paths")) }
        val urls = config.urls.map { source(URL_PREFIX, it, KiloBundle.message("settings.agentBehavior.skills.sources.urls")) }
        return paths + urls
    }

    private fun source(prefix: String, value: String, section: String) = object : SettingsListItem {
        override val key = prefix + value
        override val title = value
        override val section = section
        override val cells = listOf(SettingsListCell(
            DELETE_CELL,
            KiloBundle.message("common.delete"),
            icon = AllIcons.Actions.GC,
            iconOnly = true,
        ))
    }

    private fun remove(key: String) {
        when {
            key.startsWith(PATH_PREFIX) -> parent.updateSources(cfg.paths - key.removePrefix(PATH_PREFIX), cfg.urls)
            key.startsWith(URL_PREFIX) -> parent.updateSources(cfg.paths, cfg.urls - key.removePrefix(URL_PREFIX))
        }
    }

    private inner class AddPathAction : DumbAwareAction(
        KiloBundle.message("settings.agentBehavior.skills.sources.addPath"),
        null,
        AllIcons.General.Add,
    ) {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT
        override fun actionPerformed(e: AnActionEvent) = addPath()
    }

    private inner class AddUrlAction : DumbAwareAction(
        KiloBundle.message("settings.agentBehavior.skills.sources.addUrl"),
        null,
        AllIcons.General.Add,
    ) {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT
        override fun actionPerformed(e: AnActionEvent) = addUrl()
    }

    private companion object {
        const val DELETE_CELL = "delete"
        const val PATH_PREFIX = "path:"
        const val URL_PREFIX = "url:"
    }
}

private fun chooseSkillPath(parent: JComponent): String? {
    val descriptor = FileChooserDescriptor(false, true, false, false, false, false).apply {
        title = KiloBundle.message("settings.agentBehavior.skills.sources.addPath.title")
        description = KiloBundle.message("settings.agentBehavior.skills.sources.addPath.prompt")
    }
    return FileChooser.chooseFile(descriptor, parent, null, null as VirtualFile?)?.path
}

private fun inputSkillUrl(title: String, prompt: String): String? = Messages.showInputDialog(
    prompt,
    title,
    Messages.getQuestionIcon(),
)
