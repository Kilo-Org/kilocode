package ai.kilocode.client.ui.diagram.ui

import com.intellij.ide.DataManager
import com.intellij.ide.scratch.ScratchRootType
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JComponent

private const val NAME = "diagram.mmd"

/**
 * Opens the mermaid source of a rendered diagram in a real editor tab.
 *
 * A scratch file rather than an in-memory light file, so the text is editable, savable, and picked up
 * by whatever mermaid tooling the IDE has installed for the `.mmd` file type.
 */
@RequiresEdt
internal fun openDiagram(anchor: JComponent, source: String): Boolean {
    val ctx = DataManager.getInstance().getDataContext(anchor)
    val project = CommonDataKeys.PROJECT.getData(ctx) ?: return false
    val file = ScratchRootType.getInstance().createScratchFile(project, NAME, null, source) ?: return false
    FileEditorManager.getInstance(project).openFile(file, true)
    return true
}
