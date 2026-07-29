package ai.kilocode.client.settings.agents

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.components.service
import kotlinx.coroutines.CoroutineScope
import javax.swing.JComponent

class CompatibilityConfigurable : AgentBehaviorConfigurableBase<JComponent>() {
    override fun getId(): String = ID
    override fun getDisplayName(): String = KiloBundle.message("settings.agentBehavior.compatibility.displayName")
    override fun create(cs: CoroutineScope, dir: String): JComponent = CompatibilitySettingsUi(cs, service())

    companion object {
        const val ID = "ai.kilocode.jetbrains.settings.agentBehavior.compatibility"
    }
}
