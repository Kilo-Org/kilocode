package ai.kilocode.client.settings.checkpoints

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.DraftReadyConfigurable
import com.intellij.platform.project.projectIdOrNull
import kotlinx.coroutines.CoroutineScope
import javax.swing.JComponent

class CheckpointsConfigurable : DraftReadyConfigurable<JComponent>() {
    override fun getId(): String = ID

    override fun getDisplayName(): String = KiloBundle.message("settings.checkpoints.displayName")

    override fun create(cs: CoroutineScope): JComponent = CheckpointsSettingsUi(
        cs,
        hint = project?.basePath,
        projectId = project?.projectIdOrNull(),
    )

    companion object {
        const val ID = "ai.kilocode.jetbrains.settings.checkpoints"
    }
}
