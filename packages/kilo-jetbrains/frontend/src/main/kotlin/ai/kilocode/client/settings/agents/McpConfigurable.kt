package ai.kilocode.client.settings.agents

import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.rpc.dto.ConfigPatchDto
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.swing.JButton

class McpConfigurable : AgentBehaviorConfigurableBase<McpSettingsUi>() {
    override fun getId(): String = ID
    override fun getDisplayName(): String = KiloBundle.message("settings.agentBehavior.mcp.displayName")
    override fun create(cs: CoroutineScope, dir: String) = McpSettingsUi(cs, dir)

    companion object { const val ID = "ai.kilocode.jetbrains.settings.agentBehavior.mcp" }
}

class McpSettingsUi(private val cs: CoroutineScope, private val dir: String) : BaseContentPanel() {
    private val rows = section(KiloBundle.message("settings.agentBehavior.mcp.displayName"))

    init {
        load()
    }

    private fun load() {
        cs.launch {
            val cfg = service<KiloAppService>().state.value.config?.mcp.orEmpty()
            val statuses = service<KiloAgentBehaviorService>().mcpStatus(dir).associateBy { it.name }
            withContext(Dispatchers.EDT + ModalityState.any().asContextElement()) {
                rows.removeAll()
                if (cfg.isEmpty()) rows.row(SettingsRow(KiloBundle.message("settings.agentBehavior.empty")))
                cfg.forEach { (name, server) ->
                    val status = statuses[name]?.status ?: "configured"
                    val actions = JButton(KiloBundle.message("settings.agentBehavior.remove")).apply {
                        addActionListener {
                            cs.launch {
                                service<KiloAppService>().updateConfig(ConfigPatchDto(mcp = mapOf(name to null)))
                                load()
                            }
                        }
                    }
                    rows.row(SettingsRow(name, listOfNotNull(status, server.type, server.url, server.command?.joinToString(" ")).joinToString(" - "), actions))
                }
            }
        }
    }
}
