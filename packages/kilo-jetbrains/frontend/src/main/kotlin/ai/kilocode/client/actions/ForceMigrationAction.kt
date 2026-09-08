package ai.kilocode.client.actions

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.onboarding.KiloOnboardingService
import ai.kilocode.client.onboarding.providers.v5migration.KiloMigrationService
import ai.kilocode.client.onboarding.providers.v5migration.MigrationOnboardingProvider
import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages

class ForceMigrationAction : AnAction(
    KiloBundle.message("action.Kilo.ForceMigration.text"),
    KiloBundle.message("action.Kilo.ForceMigration.description"),
    null,
), DumbAware {
    internal var confirm: (Project?) -> Boolean = { project ->
        Messages.showYesNoDialog(
            project,
            KiloBundle.message("action.Kilo.ForceMigration.confirm.message"),
            KiloBundle.message("action.Kilo.ForceMigration.confirm.title"),
            Messages.getWarningIcon(),
        ) == Messages.YES
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun actionPerformed(e: AnActionEvent) {
        if (!confirm(e.project)) return
        // A previous `Later` defers the step for the rest of the IDE run, which would leave the app
        // stuck in MIGRATION_REQUIRED with no wizard after the restart below.
        service<KiloOnboardingService>().reoffer(MigrationOnboardingProvider.ID)
        service<KiloMigrationService>().resetStatusAndRestart { ok ->
            if (ok) return@resetStatusAndRestart
            KiloNotifications.error(KiloBundle.message("action.Kilo.ForceMigration.failed"))
        }
    }
}
