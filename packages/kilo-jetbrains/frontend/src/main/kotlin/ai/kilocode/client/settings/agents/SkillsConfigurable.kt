package ai.kilocode.client.settings.agents

import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.SettingsDraftPage
import ai.kilocode.client.settings.base.SettingsDraftState
import ai.kilocode.client.settings.base.SettingsBadge
import ai.kilocode.client.settings.base.SettingsListCell
import ai.kilocode.client.settings.base.SettingsListItem
import ai.kilocode.client.settings.base.SettingsListPanel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.SkillsPatchDto
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.swing.JComponent

class SkillsConfigurable : AgentBehaviorConfigurableBase<JComponent>() {
    override fun getId(): String = ID
    override fun getDisplayName(): String = KiloBundle.message("settings.agentBehavior.skills.displayName")
    override fun create(cs: CoroutineScope, dir: String): JComponent = SkillsSettingsUi(cs, dir)
    override fun scrollReadyShell() = false

    companion object { const val ID = "ai.kilocode.jetbrains.settings.agentBehavior.skills" }
}

internal class SkillsSettingsUi(private val cs: CoroutineScope, private val dir: String) : SettingsListPanel(cs), SettingsDraftPage {
    private val state = SettingsDraftState(skillsDraft())
    private var draft: SkillsDraft
        get() = state.draft
        set(value) {
            state.draft = value
        }

    init {
        start()
    }

    override suspend fun fetch(): List<SettingsListItem> {
        val config = service<KiloAppService>().state.value.config?.skills
        state.accept(SkillsDraft(config?.paths.orEmpty(), config?.urls.orEmpty()))
        val discovered = service<KiloAgentBehaviorService>().skills(dir)
        return localRows() + discovered.map { skill ->
            val builtin = skill.location == "builtin"
            object : SettingsListItem {
                override val key = "skill:${skill.location}"
                override val title = skill.name
                override val description = skill.description ?: skill.location
                override val badges = listOf(
                    if (builtin) SettingsBadge(KiloBundle.message("settings.agentBehavior.badge.builtin"))
                    else SettingsBadge(KiloBundle.message("settings.agentBehavior.badge.custom"), UiStyle.Badge.Primary),
                )
                override val cells = if (builtin) emptyList() else listOf(removeCell())
            }
        }
    }

    private fun localRows(): List<SettingsListItem> {
        val pathRows = draft.paths.mapIndexed { index, value -> local("path:$index", value, KiloBundle.message("settings.agentBehavior.skills.paths")) }
        val urlRows = draft.urls.mapIndexed { index, value -> local("url:$index", value, KiloBundle.message("settings.agentBehavior.skills.urls")) }
        return pathRows + urlRows
    }

    private fun local(key: String, value: String, section: String) = object : SettingsListItem {
        override val key = key
        override val title = value
        override val section = section
        override val cells = listOf(removeCell())
    }

    override fun onCell(key: String, cellId: String) {
        if (cellId != REMOVE_CELL) return
        when {
            key.startsWith("path:") -> {
                val index = key.removePrefix("path:").toIntOrNull() ?: return
                state.update { copy(paths = paths.filterIndexed { idx, _ -> idx != index }) }
                reload()
            }
            key.startsWith("url:") -> {
                val index = key.removePrefix("url:").toIntOrNull() ?: return
                state.update { copy(urls = urls.filterIndexed { idx, _ -> idx != index }) }
                reload()
            }
            key.startsWith("skill:") -> {
                val location = key.removePrefix("skill:")
                mutateAndReload(selectionIndex()) {
                    service<KiloAgentBehaviorService>().removeSkill(dir, location)
                }
            }
        }
    }

    override fun searchPlaceholder() = KiloBundle.message("settings.agentBehavior.skills.search")

    override fun modified(): Boolean = state.modified()

    override fun applyDraft() {
        val token = state.start() ?: return
        cs.launch {
            val patch = ConfigPatchDto(skills = SkillsPatchDto(paths = token.target.paths, urls = token.target.urls))
            val state = service<KiloAppService>().updateConfig(patch)
            withContext(Dispatchers.EDT + ModalityState.any().asContextElement()) {
                if (state == null) {
                    this@SkillsSettingsUi.state.fail(token, KiloBundle.message("settings.agentBehavior.save.failed"))
                    return@withContext
                }
                this@SkillsSettingsUi.state.complete(token, skillsDraft())
                reload()
            }
        }
    }

    override fun resetDraft() {
        state.reset()
        reload()
    }

    private fun removeCell() = SettingsListCell(REMOVE_CELL, KiloBundle.message("settings.agentBehavior.remove"))

    private companion object { const val REMOVE_CELL = "remove" }
}

private data class SkillsDraft(
    val paths: List<String> = emptyList(),
    val urls: List<String> = emptyList(),
)

private fun skillsDraft(): SkillsDraft {
    val cfg = service<KiloAppService>().state.value.config?.skills
    return SkillsDraft(cfg?.paths.orEmpty(), cfg?.urls.orEmpty())
}
