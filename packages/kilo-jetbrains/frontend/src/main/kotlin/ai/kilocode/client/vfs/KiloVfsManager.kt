package ai.kilocode.client.vfs

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.project.Project
import com.intellij.util.concurrency.annotations.RequiresEdt

@Service(Service.Level.PROJECT)
class KiloVfsManager(private val project: Project) {
    @RequiresEdt
    fun open(kind: String, params: Map<String, String> = emptyMap(), focus: Boolean = true): Boolean {
        val file = file(kind, params) ?: return false
        if (ApplicationManager.getApplication().isUnitTestMode) {
            file.putUserData(FileEditorProvider.KEY, KiloFileEditorProvider())
        }
        FileEditorManager.getInstance(project).openFile(file, focus)
        return true
    }

    @RequiresEdt
    fun close(kind: String, params: Map<String, String> = emptyMap()) {
        val file = file(kind, params) ?: return
        FileEditorManager.getInstance(project).closeFile(file)
        KiloVirtualFileSystem.getInstance().release(file.path)
    }

    @RequiresEdt
    fun updatePresentation(kind: String, params: Map<String, String> = emptyMap()) {
        val file = file(kind, params) ?: return
        FileEditorManager.getInstance(project).updateFilePresentation(file)
    }

    private fun file(kind: String, params: Map<String, String>): KiloVirtualFile? {
        val path = KiloPath(kind, params)
        val fs = KiloVirtualFileSystem.getInstance()
        return fs.refreshAndFindFileByPath(fs.getPath(path)) as? KiloVirtualFile
    }
}
