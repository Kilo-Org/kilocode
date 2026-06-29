package ai.kilocode.client.vfs

import ai.kilocode.client.session.ui.attachment.ensureAttachmentEditorKind
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.VirtualFile

class KiloFileEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile): Boolean {
        ensureAttachmentEditorKind()
        val path = path(file) ?: return false
        return service<KiloEditorKindRegistry>().get(path.kind) != null
    }

    override fun acceptRequiresReadAction(): Boolean = false

    override fun createEditor(project: Project, file: VirtualFile): FileEditor {
        ensureAttachmentEditorKind()
        val path = path(file) ?: error("Invalid Kilo virtual file: ${file.path}")
        val kilo = file as? KiloVirtualFile ?: KiloVirtualFile(path)
        val kind = service<KiloEditorKindRegistry>().get(kilo.path.kind) ?: error("Unknown Kilo editor kind: ${kilo.path.kind}")
        return KiloFileEditor(project, file, kilo, kind)
    }

    override fun disposeEditor(editor: FileEditor) {
        Disposer.dispose(editor)
    }

    override fun getEditorTypeId(): String = EDITOR_TYPE_ID
    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_OTHER_EDITORS

    companion object {
        const val EDITOR_TYPE_ID = "KiloVfsEditor"

        private fun path(file: VirtualFile): KiloPath? {
            if (file is KiloVirtualFile) return file.path
            if (file.fileSystem.protocol != KiloVirtualFileSystem.PROTOCOL && !file.url.startsWith("${KiloVirtualFileSystem.PROTOCOL}://")) return null
            return KiloVirtualFileSystem.decode(file.path) ?: KiloVirtualFileSystem.decode(file.url)
        }
    }
}
