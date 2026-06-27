package ai.kilocode.client.settings.agents

import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.SettingsBadge
import ai.kilocode.client.settings.base.SettingsListItem
import ai.kilocode.client.settings.base.SettingsListPanel
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.components.service
import kotlinx.coroutines.CoroutineScope
import javax.swing.JComponent

class WorkflowsConfigurable : AgentBehaviorConfigurableBase<JComponent>() {
    override fun getId(): String = ID
    override fun getDisplayName(): String = KiloBundle.message("settings.agentBehavior.workflows.displayName")
    override fun create(cs: CoroutineScope, dir: String): JComponent = WorkflowsSettingsUi(cs, dir)
    override fun scrollReadyShell() = false

    companion object { const val ID = "ai.kilocode.jetbrains.settings.agentBehavior.workflows" }
}

internal class WorkflowsSettingsUi(cs: CoroutineScope, private val dir: String) : SettingsListPanel(cs) {
    init {
        start()
    }

    override suspend fun fetch(): List<SettingsListItem> {
        return service<KiloAgentBehaviorService>().commands(dir).map { item ->
            object : SettingsListItem {
                override val key = item.name
                override val title = "/${item.name}"
                override val description = item.description ?: item.template
                override val badges = listOfNotNull(item.source?.let { source ->
                    val style = when (source) {
                        "command" -> UiStyle.Badge.Primary
                        "skill" -> UiStyle.Badge.Highlight
                        else -> UiStyle.Badge.Secondary
                    }
                    SettingsBadge(source, style)
                })
            }
        }
    }

    override fun onCell(key: String, cellId: String) = Unit

    override fun searchPlaceholder() = KiloBundle.message("settings.agentBehavior.workflows.search")
}
