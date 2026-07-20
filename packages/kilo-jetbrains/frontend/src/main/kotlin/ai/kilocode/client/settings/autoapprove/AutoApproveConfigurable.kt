package ai.kilocode.client.settings.autoapprove

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.ScrollableDraftReadyConfigurable
import kotlinx.coroutines.CoroutineScope
import javax.swing.JComponent

class AutoApproveConfigurable : ScrollableDraftReadyConfigurable<JComponent>() {
    override fun getId(): String = ID

    override fun getDisplayName(): String = KiloBundle.message("settings.autoApprove.displayName")

    override fun create(cs: CoroutineScope): JComponent = AutoApproveSettingsUi(cs)

    companion object {
        const val ID = "ai.kilocode.jetbrains.settings.autoApprove"
    }
}
