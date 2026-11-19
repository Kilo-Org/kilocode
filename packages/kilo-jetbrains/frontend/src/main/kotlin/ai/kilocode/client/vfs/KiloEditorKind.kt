package ai.kilocode.client.vfs

import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JComponent

interface KiloEditorView {
    fun title(params: Map<String, String>): String

    @RequiresEdt
    fun createContent(project: Project, file: KiloVirtualFile, parent: Disposable): JComponent

    fun preferredFocus(component: JComponent): JComponent? = null
}

interface KiloEditorKind : KiloVirtualFileKind, KiloEditorView {
    val source: KiloEditorView? get() = null
}
