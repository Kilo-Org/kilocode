package ai.kilocode.client.vfs

import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.VirtualFile

class KiloSourceEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile): Boolean {
        return kiloKind(file)?.source != null
    }

    override fun acceptRequiresReadAction(): Boolean = false

    override fun createEditor(project: Project, file: VirtualFile): FileEditor {
        val path = kiloPath(file) ?: error("Invalid Kilo virtual file: ${file.path}")
        val kilo = file as? KiloVirtualFile ?: KiloVirtualFile(path)
        val kind = service<KiloEditorKindRegistry>().get(kilo.path.kind) ?: error("Unknown Kilo editor kind: ${kilo.path.kind}")
        val view = kind.source ?: error("Kilo editor kind has no source view: ${kilo.path.kind}")
        return KiloFileEditor(project, file, kilo, view)
    }

    override fun disposeEditor(editor: FileEditor) {
        Disposer.dispose(editor)
    }

    override fun getEditorTypeId(): String = EDITOR_TYPE_ID
    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_OTHER_EDITORS

    companion object {
        const val EDITOR_TYPE_ID = "KiloVfsSourceEditor"
    }
}
