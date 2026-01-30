package ai.kilo.plugin.actions

import ai.kilo.plugin.services.KiloProjectService
import ai.kilo.plugin.services.KiloStateService
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.ToolWindowManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Action to add the current file to Kilo context.
 */
class AddFileToContextAction : AnAction(), DumbAware {
    private val scope = CoroutineScope(Dispatchers.Default)

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        val editor = e.getData(CommonDataKeys.EDITOR)

        val kiloService = KiloProjectService.getInstance(project)

        // Open tool window
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Kilo")
        toolWindow?.show()

        scope.launch {
            if (!kiloService.isReady) {
                kiloService.initialize()
            }

            val state = kiloService.state ?: return@launch

            // Create a new session if none exists
            if (state.currentSessionId.value == null) {
                state.createSession()
            }

            val attachedFile = buildAttachedFile(project, file, editor)
            state.addFileToContext(attachedFile)
        }
    }

    private fun buildAttachedFile(
        project: com.intellij.openapi.project.Project,
        file: VirtualFile,
        editor: com.intellij.openapi.editor.Editor?
    ): KiloStateService.AttachedFile {
        // Get absolute and relative paths
        val absolutePath = file.path
        val basePath = project.basePath ?: ""
        val relativePath = absolutePath.removePrefix(basePath).removePrefix("/")

        // Check for selection (line range)
        val selection = editor?.selectionModel
        val startLine: Int?
        val endLine: Int?

        if (selection != null && selection.hasSelection()) {
            val doc = editor.document
            startLine = doc.getLineNumber(selection.selectionStart) + 1
            endLine = doc.getLineNumber(selection.selectionEnd) + 1
        } else {
            startLine = null
            endLine = null
        }

        // Determine mime type
        val mime = if (file.isDirectory) {
            "application/x-directory"
        } else {
            "text/plain"
        }

        return KiloStateService.AttachedFile(
            absolutePath = absolutePath,
            relativePath = relativePath,
            startLine = startLine,
            endLine = endLine,
            mime = mime
        )
    }

    override fun update(e: AnActionEvent) {
        val project = e.project
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE)
        e.presentation.isEnabledAndVisible = project != null && file != null
    }
}
