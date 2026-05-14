package ai.kilocode.client.fs

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

class KiloEditorProvider : FileEditorProvider, DumbAware {
    companion object {
        const val ID = "kilo-editor"
    }

    override fun accept(project: Project, file: VirtualFile): Boolean {
        if (file.fileSystem.protocol != KiloVirtualFileSystem.PROTOCOL) return false
        return KiloEditorTarget.parse(file.path) != null
    }

    override fun acceptRequiresReadAction(): Boolean = false

    override fun createEditor(project: Project, file: VirtualFile): FileEditor {
        val target = KiloEditorTarget.parse(file.path)
            ?: error("Unsupported Kilo editor path: ${file.path}")
        return KiloEmptyEditor(target, file)
    }

    override fun getEditorTypeId(): String = ID

    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR
}
