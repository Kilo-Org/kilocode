package ai.kilocode.client.settings.rules

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.DraftReadyConfigurable
import kotlinx.coroutines.CoroutineScope
import javax.swing.JComponent

class RulesConfigurable : DraftReadyConfigurable<JComponent>() {
    override fun getId(): String = ID

    override fun getDisplayName(): String = KiloBundle.message("settings.agentBehavior.rules.displayName")

    override fun create(cs: CoroutineScope): JComponent = RulesSettingsUi(cs, root = project?.basePath)

    override fun scrollReadyShell() = false

    companion object {
        const val ID = "ai.kilocode.jetbrains.settings.agentBehavior.rules"
    }
}
