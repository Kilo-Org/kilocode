package ai.kilocode.client.settings.models

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.options.SearchableConfigurable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import javax.swing.JComponent

class ModelsConfigurable : SearchableConfigurable, Configurable.NoScroll {
    private var ui: ModelsSettingsUi? = null
    private var scope: CoroutineScope? = null

    override fun getId(): String = ID

    override fun getDisplayName(): String = KiloBundle.message("settings.models.displayName")

    override fun createComponent(): JComponent {
        val cs = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        scope = cs
        val dir = ProjectManager.getInstance().openProjects.firstOrNull { !it.isDefault }?.basePath
        val panel = ModelsSettingsUi(cs, directory = dir)
        ui = panel
        return panel
    }

    override fun isModified(): Boolean = ui?.modified() == true

    override fun apply() {
        ui?.applyDraft()
    }

    override fun reset() {
        ui?.resetDraft()
    }

    override fun disposeUIResources() {
        val panel = ui
        val cs = scope
        ui = null
        scope = null
        val app = ApplicationManager.getApplication()
        if (panel != null && app.isDispatchThread) {
            panel.dispose()
            cs?.cancel()
            return
        }
        if (panel != null) {
            app.invokeLater({
                panel.dispose()
                cs?.cancel()
            }, ModalityState.any())
            return
        }
        cs?.cancel()
    }

    companion object {
        const val ID = "ai.kilocode.jetbrains.settings.models"
    }
}
