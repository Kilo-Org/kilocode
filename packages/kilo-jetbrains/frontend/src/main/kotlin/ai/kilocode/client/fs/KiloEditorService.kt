package ai.kilocode.client.fs

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.Service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project

@Service(Service.Level.PROJECT)
class KiloEditorService(
    private val project: Project,
) {
    fun openProfile() {
        open(KiloEditorTarget.Profile)
    }

    fun open(target: KiloEditorTarget) {
        val file = KiloVirtualFileSystem.getInstance().file(target)
        val app = ApplicationManager.getApplication()
        if (app.isDispatchThread) {
            open(file)
            return
        }
        app.invokeLater({ open(file) }, ModalityState.defaultModalityState())
    }

    private fun open(file: KiloVirtualFile) {
        if (project.isDisposed) return
        val manager = FileEditorManager.getInstance(project)
        manager.openFile(file, true, true)
        manager.setSelectedEditor(file, KiloEditorProvider.ID)
    }
}
