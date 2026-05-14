package ai.kilocode.client.actions

import ai.kilocode.client.fs.KiloEditorService
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware

class ShowProfileAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        e.project?.service<KiloEditorService>()?.openProfile()
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project != null
    }
}
