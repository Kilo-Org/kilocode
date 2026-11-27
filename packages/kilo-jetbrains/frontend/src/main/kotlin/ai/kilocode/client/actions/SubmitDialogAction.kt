package ai.kilocode.client.actions

import ai.kilocode.client.session.views.base.DialogDataKeys
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPromoter
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.project.DumbAwareAction

class SubmitDialogAction : DumbAwareAction(), ActionPromoter {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.getData(DialogDataKeys.DEFAULT_ACTION)?.enabled == true
    }

    override fun actionPerformed(e: AnActionEvent) {
        val action = e.getData(DialogDataKeys.DEFAULT_ACTION) ?: return
        if (action.enabled) action.submit()
    }

    override fun promote(actions: List<AnAction>, context: DataContext): List<AnAction> {
        if (DialogDataKeys.DEFAULT_ACTION.getData(context)?.enabled != true) return emptyList()
        return if (this in actions) listOf(this) else emptyList()
    }

    override fun suppress(actions: List<AnAction>, context: DataContext): List<AnAction> {
        if (DialogDataKeys.DEFAULT_ACTION.getData(context)?.enabled != true) return emptyList()
        val manager = ActionManager.getInstance()
        return actions.filter { manager.getId(it) == SendPromptAction.ID }
    }
}
