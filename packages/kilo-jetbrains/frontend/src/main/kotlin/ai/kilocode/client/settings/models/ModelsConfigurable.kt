package ai.kilocode.client.settings.models

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.DraftReadyConfigurable
import com.intellij.openapi.project.ProjectManager
import kotlinx.coroutines.CoroutineScope
import javax.swing.JComponent

class ModelsConfigurable : DraftReadyConfigurable<JComponent>() {
    override fun getId(): String = ID

    override fun getDisplayName(): String = KiloBundle.message("settings.models.displayName")

    override fun create(cs: CoroutineScope): JComponent {
        val dir = ProjectManager.getInstance().openProjects.firstOrNull { !it.isDefault }?.basePath
        return ModelsSettingsUi(cs, directory = dir)
    }

    companion object {
        const val ID = "ai.kilocode.jetbrains.settings.models"
    }
}
