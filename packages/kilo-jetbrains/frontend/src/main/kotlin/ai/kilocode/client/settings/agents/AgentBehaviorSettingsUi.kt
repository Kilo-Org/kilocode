package ai.kilocode.client.settings.agents

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.BaseSettingsUi
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.client.settings.rules.RulesConfigurable
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.ide.DataManager
import com.intellij.openapi.components.service
import com.intellij.openapi.options.ex.Settings
import com.intellij.ui.TitledSeparator
import com.intellij.ui.components.ActionLink
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CoroutineScope
import javax.swing.JComponent

/**
 * Agent Behavior root page: the Kilo Swarm toggle plus links to the sub-pages. Mirrors VS Code's
 * Agent Behaviour tab, which hosts the same `shared_agent_board` switch.
 */
internal class AgentBehaviorSettingsUi(
    cs: CoroutineScope,
    private val app: KiloAppService = service(),
    workspaces: KiloWorkspaceService = service(),
) : BaseSettingsUi<AgentBehaviorContent, AgentBehaviorDraft, ConfigPatchDto, KiloAppStateDto, Unit>(
    cs,
    AgentBehaviorDraft(),
    app,
    workspaces,
    loginBanner = false,
) {
    init {
        startSettings(AgentBehaviorContent { updateDraft(it) })
    }

    override fun change(from: AgentBehaviorDraft, to: AgentBehaviorDraft): ConfigPatchDto? = patch(from, to)

    override fun save(change: ConfigPatchDto, done: (KiloAppStateDto?) -> Unit) {
        app.updateConfigAsync(change, done)
    }

    override fun base(result: KiloAppStateDto): AgentBehaviorDraft = agentBehaviorDraft(result.config)

    override fun draft(state: KiloAppStateDto): AgentBehaviorDraft = agentBehaviorDraft(state.config)

    override fun saved(base: AgentBehaviorDraft, draft: AgentBehaviorDraft): Boolean = savedMatches(base, draft)

    override fun pendingText(): String = KiloBundle.message("settings.agentBehavior.saving")

    override fun failedText(): String = KiloBundle.message("settings.agentBehavior.save.failed")

    override suspend fun loadWorkspace(root: String) = Unit

    override fun applyWorkspace(result: Unit) = Unit

    override fun logSaveStarted(change: ConfigPatchDto) = LOG.info("agent behavior settings save: started")

    override fun logSaveCompleted(change: ConfigPatchDto) = LOG.info("agent behavior settings save: completed")

    override fun logSaveFailed(change: ConfigPatchDto) = LOG.warn("agent behavior settings save: failed")

    override fun logSaveFailedAfterDispose(change: ConfigPatchDto) =
        LOG.warn("agent behavior settings save: failed after dispose")

    override fun logSaveCompletedAfterDispose(change: ConfigPatchDto) =
        LOG.info("agent behavior settings save: completed after dispose")

    @RequiresEdt
    override fun syncContent() {
        val ready = appState.status == KiloAppStatusDto.READY
        form.sync(draft, ready && !saving)
        top.hideBanner()
        if (saving) {
            showProgress(KiloBundle.message("settings.agentBehavior.saving"))
            return
        }
        val err = saveError
        if (err != null) {
            showError(err)
            return
        }
        if (!ready) {
            showProgress(KiloBundle.message("settings.cli.unavailable.message"))
            return
        }
        clearProgress()
    }

    private companion object {
        val LOG = KiloLog.create(AgentBehaviorSettingsUi::class.java)
    }
}

internal class AgentBehaviorContent(
    private val update: (AgentBehaviorDraft.() -> AgentBehaviorDraft) -> Unit,
) : BaseContentPanel() {
    private val swarm = SettingsToggle { value -> update { copy(swarm = value) } }

    init {
        val rows = section(
            KiloBundle.message("settings.agentBehavior.displayName"),
            KiloBundle.message("settings.agentBehavior.description"),
        )
        listOf(
            KiloBundle.message("settings.agentBehavior.agents.displayName") to AgentsConfigurable.ID,
            KiloBundle.message("settings.agentBehavior.mcp.displayName") to McpConfigurable.ID,
            KiloBundle.message("settings.agentBehavior.skills.displayName") to SkillsConfigurable.ID,
            KiloBundle.message("settings.agentBehavior.workflows.displayName") to WorkflowsConfigurable.ID,
            KiloBundle.message("settings.agentBehavior.rules.displayName") to RulesConfigurable.ID,
        ).forEach { (label, id) ->
            rows.row(ActionLink(label) { e ->
                val src = e.source as? JComponent ?: return@ActionLink
                val settings = Settings.KEY.getData(DataManager.getInstance().getDataContext(src)) ?: return@ActionLink
                settings.find(id)?.let { settings.select(it) }
            }.apply { border = JBUI.Borders.emptyBottom(UiStyle.Gap.sm()) })
        }
        // Own group below the sub-page links, matching AdvancedSettingsUi's separator-per-group idiom.
        rows.row(TitledSeparator(KiloBundle.message("settings.agentBehavior.swarm.title")))
        rows.row(SettingsRow(
            KiloBundle.message("settings.agentBehavior.swarm.enabled"),
            KiloBundle.message("settings.agentBehavior.swarm.description"),
            swarm,
        ))
    }

    @RequiresEdt
    fun sync(draft: AgentBehaviorDraft, enabled: Boolean) {
        swarm.isSelected = draft.swarm
        swarm.isEnabled = enabled
    }
}
