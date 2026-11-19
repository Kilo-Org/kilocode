package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.ui.Messages
import com.intellij.terminal.frontend.view.TerminalView

abstract class TerminalSelectionAction(private val promptKey: String, private val draft: Boolean = false) : DumbAwareAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null && e.getData(TerminalView.DATA_KEY)?.textSelectionModel?.selection != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val view = e.getData(TerminalView.DATA_KEY) ?: return
        val selection = view.textSelectionModel.selection ?: return
        val start = minOf(selection.startOffset, selection.endOffset)
        val end = maxOf(selection.startOffset, selection.endOffset)
        val model = view.outputModels.active.value
        if (start < model.startOffset || end > model.endOffset || start == end) return
        val text = KiloBundle.message(promptKey, model.getText(start, end).toString())
        project.service<EditorSelectionTarget>().open(if (draft) ChatInput.Draft(text) else ChatInput.Task(text))
    }
}

class AddTerminalSelectionAction : TerminalSelectionAction("terminal.selection.context", true)
class ExplainTerminalSelectionAction : TerminalSelectionAction("terminal.selection.explain")
class FixTerminalSelectionAction : TerminalSelectionAction("terminal.selection.fix")

class GenerateTerminalCommandAction : DumbAwareAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) { e.presentation.isEnabled = e.project != null }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val description = Messages.showInputDialog(project, KiloBundle.message("terminal.generate.description"),
            KiloBundle.message("action.Kilo.GenerateTerminalCommand.text"), null)?.trim().orEmpty()
        if (description.isNotEmpty()) project.service<EditorSelectionTarget>().open(
            ChatInput.Task(KiloBundle.message("terminal.generate.prompt", description)))
    }
}
