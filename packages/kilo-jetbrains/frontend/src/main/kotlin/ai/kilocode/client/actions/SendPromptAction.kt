package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import com.intellij.codeInsight.lookup.LookupManager
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPromoter
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.IdeActions
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.project.DumbAwareAction

class SendPromptAction : DumbAwareAction(
    KiloBundle.message("action.Kilo.SendPrompt.text"),
    KiloBundle.message("action.Kilo.SendPrompt.description"),
    null,
), ActionPromoter {
    companion object {
        const val ID = "Kilo.SendPrompt"
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val ctx = e.getData(PromptDataKeys.SEND)
        val editor = e.getData(CommonDataKeys.EDITOR)
        e.presentation.isEnabled = ctx != null && ctx.isSendEnabled && !lookup(editor)
    }

    override fun actionPerformed(e: AnActionEvent) {
        val ctx = e.getData(PromptDataKeys.SEND) ?: return
        val editor = e.getData(CommonDataKeys.EDITOR)
        if (!ctx.isSendEnabled) return
        if (lookup(editor)) return
        ctx.send()
    }

    override fun promote(actions: List<AnAction>, context: DataContext): List<AnAction> {
        if (!enabled(context)) return emptyList()
        return if (this in actions) listOf(this) else emptyList()
    }

    override fun suppress(actions: List<AnAction>, context: DataContext): List<AnAction> {
        if (!enabled(context)) return emptyList()
        val manager = ActionManager.getInstance()
        return actions.filter { action ->
            val root = ActionUtil.getDelegateChainRootAction(action)
            manager.getId(root) == IdeActions.ACTION_EDITOR_ENTER
        }
    }

    private fun enabled(context: DataContext): Boolean {
        val ctx = PromptDataKeys.SEND.getData(context) ?: return false
        val editor = CommonDataKeys.EDITOR.getData(context)
        return ctx.isSendEnabled && !lookup(editor)
    }

    private fun lookup(editor: Editor?): Boolean =
        editor != null && LookupManager.getActiveLookup(editor) != null
}
