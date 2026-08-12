package ai.kilocode.client.settings.context

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.DraftReadyConfigurable
import kotlinx.coroutines.CoroutineScope
import javax.swing.JComponent

class ContextConfigurable : DraftReadyConfigurable<JComponent>() {
    override fun getId(): String = ID

    override fun getDisplayName(): String = KiloBundle.message("settings.context.displayName")

    override fun create(cs: CoroutineScope): JComponent = ContextSettingsUi(cs)

    companion object {
        const val ID = "ai.kilocode.jetbrains.settings.context"
    }
}
