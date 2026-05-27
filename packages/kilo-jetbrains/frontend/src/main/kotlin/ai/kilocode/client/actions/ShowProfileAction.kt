package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.profile.UserProfileConfigurable
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.remoting.ActionRemoteBehaviorSpecification
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.ConfigurableWithId
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.DumbAwareAction
import java.util.function.Predicate

/**
 * Toolbar action that opens the Kilo User Profile settings page.
 *
 * Uses a predicate-based lookup so settings open correctly in JetBrains
 * Remote Development where configurables may be wrapped.
 */
class ShowProfileAction : DumbAwareAction(
    KiloBundle.message("action.Kilo.ShowProfile.text"),
    KiloBundle.message("action.Kilo.ShowProfile.description"),
    AllIcons.General.User,
), ActionRemoteBehaviorSpecification.Frontend {

    override fun actionPerformed(e: AnActionEvent) {
        ShowSettingsUtil.getInstance().showSettingsDialog(
            e.project,
            Predicate { cfg: Configurable ->
                cfg is ConfigurableWithId && cfg.getId() == UserProfileConfigurable.ID
            },
            { cfg: Configurable -> cfg.focusOn(UserProfileConfigurable.FOCUS_ACCOUNT_COMBO) },
        )
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT
}
