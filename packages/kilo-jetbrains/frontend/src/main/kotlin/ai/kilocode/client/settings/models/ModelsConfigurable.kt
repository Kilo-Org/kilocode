package ai.kilocode.client.settings.models

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.KiloReadyConfigurable
import com.intellij.openapi.project.ProjectManager
import kotlinx.coroutines.CoroutineScope
import javax.swing.JComponent

class ModelsConfigurable : KiloReadyConfigurable() {
    private var ui: ModelsSettingsUi? = null

    override fun getId(): String = ID

    override fun getDisplayName(): String = KiloBundle.message("settings.models.displayName")

    override fun createReadyComponent(cs: CoroutineScope): JComponent {
        val dir = ProjectManager.getInstance().openProjects.firstOrNull { !it.isDefault }?.basePath
        val panel = ModelsSettingsUi(cs, directory = dir)
        ui = panel
        return panel
    }

    override fun isModifiedReady(): Boolean = ui?.modified() == true

    override fun applyReady() {
        ui?.applyDraft()
    }

    override fun resetReady() {
        ui?.resetDraft()
    }

    override fun disposeReadyComponent(component: JComponent) {
        val panel = ui ?: return
        ui = null
        panel.dispose()
    }

    companion object {
        const val ID = "ai.kilocode.jetbrains.settings.models"
    }
}
