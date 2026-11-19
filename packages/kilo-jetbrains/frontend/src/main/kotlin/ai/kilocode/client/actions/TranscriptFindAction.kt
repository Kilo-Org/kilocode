package ai.kilocode.client.actions

import ai.kilocode.client.session.ui.search.SessionSearchKeys
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPromoter
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.IdeActions
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.project.DumbAwareAction

private fun enabled(context: DataContext): Boolean = SessionSearchKeys.SEARCH.getData(context) != null

private fun suppressPlatform(actions: List<AnAction>): List<AnAction> {
    val manager = ActionManager.getInstance()
    val ids = setOf(IdeActions.ACTION_FIND, IdeActions.ACTION_FIND_NEXT, IdeActions.ACTION_FIND_PREVIOUS)
    return actions.filter { manager.getId(ActionUtil.getDelegateChainRootAction(it)) in ids }
}

/** Opens the transcript-scoped native Find bar from anywhere in the active chat. */
class TranscriptFindAction : DumbAwareAction(), ActionPromoter {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = enabled(e.dataContext)
    }

    override fun actionPerformed(e: AnActionEvent) {
        SessionSearchKeys.SEARCH.getData(e.dataContext)?.open()
    }

    override fun promote(actions: List<AnAction>, context: DataContext): List<AnAction> =
        if (enabled(context) && this in actions) listOf(this) else emptyList()

    override fun suppress(actions: List<AnAction>, context: DataContext): List<AnAction> =
        if (enabled(context)) suppressPlatform(actions) else emptyList()
}

/** Moves to the next transcript match, opening Find when needed. */
class TranscriptFindNextAction : DumbAwareAction(), ActionPromoter {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = enabled(e.dataContext)
    }

    override fun actionPerformed(e: AnActionEvent) {
        SessionSearchKeys.SEARCH.getData(e.dataContext)?.searchForward()
    }

    override fun promote(actions: List<AnAction>, context: DataContext): List<AnAction> =
        if (enabled(context) && this in actions) listOf(this) else emptyList()

    override fun suppress(actions: List<AnAction>, context: DataContext): List<AnAction> =
        if (enabled(context)) suppressPlatform(actions) else emptyList()
}

/** Moves to the previous transcript match, opening Find when needed. */
class TranscriptFindPreviousAction : DumbAwareAction(), ActionPromoter {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = enabled(e.dataContext)
    }

    override fun actionPerformed(e: AnActionEvent) {
        SessionSearchKeys.SEARCH.getData(e.dataContext)?.searchBackward()
    }

    override fun promote(actions: List<AnAction>, context: DataContext): List<AnAction> =
        if (enabled(context) && this in actions) listOf(this) else emptyList()

    override fun suppress(actions: List<AnAction>, context: DataContext): List<AnAction> =
        if (enabled(context)) suppressPlatform(actions) else emptyList()
}
