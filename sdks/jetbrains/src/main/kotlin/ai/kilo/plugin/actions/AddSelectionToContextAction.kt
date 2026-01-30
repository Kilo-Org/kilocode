package ai.kilo.plugin.actions

import ai.kilo.plugin.services.KiloProjectService
import ai.kilo.plugin.services.KiloStateService
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.wm.ToolWindowManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Action to add the current selection to Kilo context.
 */
class AddSelectionToContextAction : AnAction(), DumbAware {
    private val scope = CoroutineScope(Dispatchers.Default)

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE) ?: return

        val selection = editor.selectionModel
        if (!selection.hasSelection()) return

        val kiloService = KiloProjectService.getInstance(project)

        // Get line info
        val doc = editor.document
        val startLine = doc.getLineNumber(selection.selectionStart) + 1
        val endLine = doc.getLineNumber(selection.selectionEnd) + 1

        // Build paths
        val absolutePath = file.path
        val basePath = project.basePath ?: ""
        val relativePath = absolutePath.removePrefix(basePath).removePrefix("/")

        // Open tool window
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Kilo")
        toolWindow?.show()

        scope.launch {
            if (!kiloService.isReady) {
                kiloService.initialize()
            }

            val state = kiloService.state ?: return@launch
            if (state.currentSessionId.value == null) {
                state.createSession()
            }

            val attachedFile = KiloStateService.AttachedFile(
                absolutePath = absolutePath,
                relativePath = relativePath,
                startLine = startLine,
                endLine = if (endLine != startLine) endLine else null,
                mime = "text/plain"
            )
            state.addFileToContext(attachedFile)
        }
    }

    override fun update(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR)
        val hasSelection = editor?.selectionModel?.hasSelection() == true
        e.presentation.isEnabledAndVisible = e.project != null && hasSelection
    }
}
