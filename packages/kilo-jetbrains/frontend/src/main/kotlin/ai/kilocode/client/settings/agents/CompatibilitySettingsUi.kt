package ai.kilocode.client.settings.agents

import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.SettingsDraftPage
import ai.kilocode.client.settings.base.SettingsDraftState
import ai.kilocode.client.settings.base.SettingsPanel
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ClaudeCompatSettingsDto
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val edt = Dispatchers.EDT + ModalityState.any().asContextElement()

internal class CompatibilitySettingsUi(
    scope: CoroutineScope,
    private val agent: KiloAgentBehaviorService = service(),
) : SettingsPanel(), SettingsDraftPage {
    private val scope = scope
    private val state = SettingsDraftState(ClaudeCompatSettingsDto()) { base, draft -> base == draft }
    private val skills = SettingsToggle { value -> update(skillsCommands = value) }
    private val instructions = SettingsToggle { value -> update(instructions = value) }
    private var closed = false

    init {
        val panel = Stack.vertical(UiStyle.Gap.sm())
        panel.next(SettingsRow(
            KiloBundle.message("settings.agentBehavior.compatibility.skillsCommands.title"),
            KiloBundle.message("settings.agentBehavior.compatibility.skillsCommands.description"),
            skills,
        ))
        panel.next(SettingsRow(
            KiloBundle.message("settings.agentBehavior.compatibility.instructions.title"),
            KiloBundle.message("settings.agentBehavior.compatibility.instructions.description"),
            instructions,
        ))
        setCenter(panel)
        this.scope.launch {
            val loaded = agent.claudeCompatSettings()
            withContext(edt) {
                if (closed) return@withContext
                state.accept(loaded)
                refresh(loaded)
            }
        }
    }

    override fun modified(): Boolean = state.modified()

    override fun resetDraft() {
        state.reset()
        refresh(state.draft)
    }

    override fun applyDraft() {
        val token = state.start() ?: return
        val target = token.target
        showProgress(KiloBundle.message("settings.agentBehavior.compatibility.save.pending"))
        scope.launch {
            val saved = agent.setClaudeCompatSettings(target)
            withContext(edt) {
                if (closed) return@withContext
                state.complete(token, saved)
                refresh(saved)
                clearProgress()
                LOG.info("compatibility settings apply succeeded")
            }
        }
    }

    private fun update(skillsCommands: Boolean? = null, instructions: Boolean? = null) {
        state.update {
            copy(
                skillsCommands = skillsCommands ?: this.skillsCommands,
                instructions = instructions ?: this.instructions,
            )
        }
        refresh(state.draft)
    }

    @RequiresEdt
    private fun refresh(value: ClaudeCompatSettingsDto) {
        skills.isSelected = value.skillsCommands
        instructions.isSelected = value.instructions
    }

    companion object {
        private val LOG = KiloLog.create(CompatibilitySettingsUi::class.java)
    }
}
