package ai.kilocode.client.settings.agents

import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.SettingsDraftPage
import ai.kilocode.client.settings.base.SettingsDraftState
import ai.kilocode.client.settings.base.SettingsListEditor
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.rpc.dto.ConfigPatchDto
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class RulesConfigurable : AgentBehaviorConfigurableBase<RulesSettingsUi>() {
    override fun getId(): String = ID
    override fun getDisplayName(): String = KiloBundle.message("settings.agentBehavior.rules.displayName")
    override fun create(cs: CoroutineScope, dir: String) = RulesSettingsUi(cs)

    companion object { const val ID = "ai.kilocode.jetbrains.settings.agentBehavior.rules" }
}

class RulesSettingsUi(private val cs: CoroutineScope) : BaseContentPanel(), SettingsDraftPage {
    private val state = SettingsDraftState(service<KiloAppService>().state.value.config?.instructions.orEmpty())
    private var draft: List<String>
        get() = state.draft
        set(value) {
            state.draft = value
        }
    private val editor = SettingsListEditor(draft) { state.update { it } }

    init {
        val rows = section(KiloBundle.message("settings.agentBehavior.rules.instructions.title"), KiloBundle.message("settings.agentBehavior.rules.instructions.description"))
        rows.row(SettingsRow(KiloBundle.message("settings.agentBehavior.rules.instructions.row"), value = editor))
        val compat = section(KiloBundle.message("settings.agentBehavior.rules.claude.title"), KiloBundle.message("settings.agentBehavior.rules.claude.description"))
        compat.row(SettingsRow(KiloBundle.message("settings.agentBehavior.rules.claude.toggle"), KiloBundle.message("settings.agentBehavior.rules.claude.restart"), SettingsToggle(false) { value ->
            cs.launch { service<KiloAgentBehaviorService>().setClaudeCodeCompat(value) }
        }))
        cs.launch {
            val value = service<KiloAgentBehaviorService>().claudeCodeCompat()
            withContext(Dispatchers.EDT + ModalityState.any().asContextElement()) {
                compat.removeAll()
                compat.row(SettingsRow(KiloBundle.message("settings.agentBehavior.rules.claude.toggle"), KiloBundle.message("settings.agentBehavior.rules.claude.restart"), SettingsToggle(value) { next ->
                    cs.launch { service<KiloAgentBehaviorService>().setClaudeCodeCompat(next) }
                }))
            }
        }
    }

    override fun modified(): Boolean = state.modified()

    override fun applyDraft() {
        val token = state.start() ?: return
        cs.launch {
            val state = service<KiloAppService>().updateConfig(ConfigPatchDto(instructions = token.target))
            withContext(Dispatchers.EDT + ModalityState.any().asContextElement()) {
                if (state == null) {
                    this@RulesSettingsUi.state.fail(token, KiloBundle.message("settings.agentBehavior.save.failed"))
                    return@withContext
                }
                this@RulesSettingsUi.state.complete(token, state.config?.instructions.orEmpty())
                editor.update(draft)
            }
        }
    }

    override fun resetDraft() {
        state.reset()
        editor.update(draft)
    }
}
