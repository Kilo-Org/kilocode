package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPromoter
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.project.DumbAwareAction

class SpeechInputAction : DumbAwareAction(
    KiloBundle.message("action.Kilo.SpeechInput.text"),
    KiloBundle.message("action.Kilo.SpeechInput.description"),
    null,
), ActionPromoter {
    companion object {
        const val ID = "Kilo.SpeechInput"
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.getData(PromptDataKeys.SPEECH)?.isSpeechEnabled == true
    }

    override fun actionPerformed(e: AnActionEvent) {
        val ctx = e.getData(PromptDataKeys.SPEECH) ?: return
        if (ctx.isSpeechEnabled) ctx.toggleSpeech()
    }

    override fun promote(actions: List<AnAction>, context: DataContext): List<AnAction> {
        if (!enabled(context)) return emptyList()
        return actions.filter(::speech)
    }

    override fun suppress(actions: List<AnAction>, context: DataContext): List<AnAction> {
        if (!enabled(context)) return emptyList()
        return actions.filterNot(::speech)
    }

    private fun enabled(context: DataContext): Boolean =
        PromptDataKeys.SPEECH.getData(context)?.isSpeechEnabled == true

    private fun speech(action: AnAction): Boolean {
        val root = ActionUtil.getDelegateChainRootAction(action)
        return ActionManager.getInstance().getId(root) == ID || root === this
    }
}
