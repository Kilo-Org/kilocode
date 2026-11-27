package ai.kilocode.client.settings

import ai.kilocode.client.settings.profile.UserProfileConfigurable
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.project.Project

internal object KiloSettingsSelection {
    // IntelliJ persists the selected settings page with SettingsEditor.SELECTED_CONFIGURABLE.
    const val SELECTED_CONFIGURABLE_KEY = "settings.editor.selected.configurable"

    fun target(project: Project): String {
        val id = PropertiesComponent.getInstance(project).getValue(SELECTED_CONFIGURABLE_KEY)
        if (id != null && isKilo(id)) return id
        return UserProfileConfigurable.ID
    }

    private fun isKilo(id: String?): Boolean {
        if (id == KiloSettingsConfigurable.ID) return true
        return id?.startsWith("${KiloSettingsConfigurable.ID}.") == true
    }
}
