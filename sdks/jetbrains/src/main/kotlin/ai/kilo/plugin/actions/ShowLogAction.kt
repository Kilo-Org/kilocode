package ai.kilo.plugin.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.vfs.LocalFileSystem
import java.io.File

/**
 * Action to open the IDE log file (idea.log) in the editor.
 */
class ShowLogAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val logFile = File(PathManager.getLogPath(), "kilo.log")
        if (!logFile.exists()) return

        val virtualFile = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(logFile) ?: return
        FileEditorManager.getInstance(project).openFile(virtualFile, true)
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null
    }
}
