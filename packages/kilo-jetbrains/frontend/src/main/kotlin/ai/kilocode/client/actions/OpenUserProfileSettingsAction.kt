package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.profile.UserProfileConfigurable
import com.intellij.openapi.actionSystem.AnActionEvent

class OpenUserProfileSettingsAction : OpenSettingsPageAction(
    KiloBundle.message("action.Kilo.OpenUserProfileSettings.text"),
    KiloBundle.message("action.Kilo.OpenUserProfileSettings.description"),
    surface = "tool_window_profile",
) {
    override fun page(e: AnActionEvent): String = UserProfileConfigurable.ID
}
