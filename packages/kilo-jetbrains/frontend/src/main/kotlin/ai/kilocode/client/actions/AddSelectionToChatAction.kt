package ai.kilocode.client.actions

import ai.kilocode.client.KILO_TOOL_WINDOW_ID
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.PromptAttachment
import ai.kilocode.client.session.model.PromptAttachmentExtractor
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.util.concurrency.annotations.RequiresEdt

abstract class EditorSelectionAction(private val task: String? = null) : DumbAwareAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null && e.getData(CommonDataKeys.VIRTUAL_FILE) != null &&
            e.getData(CommonDataKeys.EDITOR)?.selectionModel?.hasSelection() == true
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        val selection = editor.selectionModel
        val text = selection.selectedText ?: return
        if (text.isEmpty()) return
        val first = editor.document.getLineNumber(selection.selectionStart) + 1
        val last = editor.document.getLineNumber(selection.selectionEnd - 1) + 1
        // Snapshot now: the user can edit an unsaved file or close its tab before sending the prompt.
        val relative = project.basePath?.let { file.path.removePrefix("$it/") } ?: file.path
        val attachment = PromptAttachmentExtractor.selection(relative, first, last, text)
        val prompt = task?.let { KiloBundle.message(it, attachment.name) }
        project.service<EditorSelectionTarget>().open(if (prompt == null) ChatInput.Attach(attachment) else ChatInput.Task(prompt, attachment))
    }
}

class AddSelectionToChatAction : EditorSelectionAction()
class ExplainSelectionAction : EditorSelectionAction("editor.selection.explain")
class ImproveSelectionAction : EditorSelectionAction("editor.selection.improve")
class FixSelectionAction : EditorSelectionAction("editor.selection.fix")

internal sealed interface ChatInput {
    data class Attach(val file: PromptAttachment) : ChatInput
    data class Draft(val text: String) : ChatInput
    data class Task(val text: String, val file: PromptAttachment? = null) : ChatInput
}

/** The tool window can still be resolving the backend project when an editor action first opens it. */
@Service(Service.Level.PROJECT)
internal class EditorSelectionTarget(private val project: Project) {
    private val pending = mutableListOf<ChatInput>()
    private var append: ((ChatInput) -> Unit)? = null

    @RequiresEdt
    fun open(input: ChatInput) {
        val window = ToolWindowManager.getInstance(project).getToolWindow(KILO_TOOL_WINDOW_ID) ?: return
        window.activate(null)
        append?.invoke(input) ?: pending.add(input)
    }

    @RequiresEdt
    fun bind(parent: Disposable, target: (ChatInput) -> Unit) {
        append = target
        Disposer.register(parent) { if (append === target) append = null }
        pending.forEach(target)
        pending.clear()
    }
}
