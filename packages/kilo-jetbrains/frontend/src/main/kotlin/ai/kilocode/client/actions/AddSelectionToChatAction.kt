package ai.kilocode.client.actions

import ai.kilocode.client.KILO_TOOL_WINDOW_ID
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

class AddSelectionToChatAction : DumbAwareAction() {
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
        project.service<EditorSelectionTarget>().add(attachment)
    }
}

/** The tool window can still be resolving the backend project when an editor action first opens it. */
@Service(Service.Level.PROJECT)
internal class EditorSelectionTarget(private val project: Project) {
    private val pending = mutableListOf<PromptAttachment>()
    private var append: ((PromptAttachment) -> Unit)? = null

    @RequiresEdt
    fun add(attachment: PromptAttachment) {
        val window = ToolWindowManager.getInstance(project).getToolWindow(KILO_TOOL_WINDOW_ID) ?: return
        window.activate(null)
        append?.invoke(attachment) ?: pending.add(attachment)
    }

    @RequiresEdt
    fun bind(parent: Disposable, target: (PromptAttachment) -> Unit) {
        append = target
        Disposer.register(parent) { if (append === target) append = null }
        pending.forEach(target)
        pending.clear()
    }
}
