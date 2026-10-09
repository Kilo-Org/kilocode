package ai.kilocode.client.actions

import ai.kilocode.client.settings.KiloSettingsConfigurable
import ai.kilocode.client.telemetry.Telemetry
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.ConfigurableWithId
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.ProjectManager
import java.util.function.Predicate

/**
 * Opens the settings dialog on one Kilo page.
 *
 * Subclasses name the page they want; [page] is resolved per invocation rather than at construction so
 * an action can follow state, as the plain Open Settings entry does with the last visited page.
 */
abstract class OpenSettingsPageAction(
    text: String,
    description: String?,
    private val surface: String,
) : DumbAwareAction(text, description, null) {

    /** Internal rather than protected so tests in this module can call it directly. */
    internal abstract fun page(e: AnActionEvent): String

    final override fun actionPerformed(e: AnActionEvent) {
        Telemetry.send("Settings Opened", mapOf("surface" to surface))
        val project = e.project ?: ProjectManager.getInstance().defaultProject
        val target = page(e)
        val util = ShowSettingsUtil.getInstance()
        try {
            util.showSettingsDialog(project, predicate(target), null)
        } catch (err: IllegalStateException) {
            // A page can be absent — not registered, or filtered out of this IDE — and the platform
            // reports that by throwing. Fall back to the Kilo root so the action still opens something,
            // unless the root itself is what failed and there is nothing left to try.
            if (target == KiloSettingsConfigurable.ID) throw err
            util.showSettingsDialog(project, predicate(KiloSettingsConfigurable.ID), null)
        }
    }

    final override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    private fun predicate(id: String) = Predicate { cfg: Configurable ->
        cfg is ConfigurableWithId && cfg.getId() == id
    }
}
