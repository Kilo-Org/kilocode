package ai.kilocode.client.settings.sandbox

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.DraftReadyConfigurable
import kotlinx.coroutines.CoroutineScope
import javax.swing.JComponent

class SandboxConfigurable : DraftReadyConfigurable<JComponent>() {
    override fun getId(): String = ID

    override fun getDisplayName(): String = KiloBundle.message("settings.sandbox.displayName")

    override fun create(cs: CoroutineScope): JComponent = SandboxSettingsUi(cs)

    companion object {
        const val ID = "ai.kilocode.jetbrains.settings.sandbox"
    }
}
