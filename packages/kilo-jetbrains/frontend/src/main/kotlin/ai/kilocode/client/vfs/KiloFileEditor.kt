package ai.kilocode.client.vfs

import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JComponent

class KiloFileEditor(
    private val project: Project,
    private val file: VirtualFile,
    private val kilo: KiloVirtualFile,
    private val kind: KiloEditorKind,
) : KiloFileEditorBase() {
    private val ui: JComponent by lazy { kind.createContent(project, kilo, this) }

    @RequiresEdt
    override fun getComponent(): JComponent = ui

    override fun getPreferredFocusedComponent(): JComponent? = kind.preferredFocus(ui)
    override fun getName(): String = kind.title(kilo.path.params)
    override fun getFile(): VirtualFile = file
    override fun isValid(): Boolean = super.isValid() && kilo.isValid

    override fun dispose() {
        KiloVirtualFileSystem.getInstance().release(kilo.path)
        super.dispose()
    }
}
