package ai.kilo.plugin.toolwindow.components.chat

import ai.kilo.plugin.services.AttachedFile
import ai.kilo.plugin.services.KiloAppState
import ai.kilo.plugin.toolwindow.KiloTheme
import com.intellij.openapi.project.Project
import com.intellij.util.ui.JBUI
import java.awt.datatransfer.DataFlavor
import java.awt.dnd.*
import java.io.File
import javax.swing.BorderFactory
import javax.swing.JComponent

/**
 * Handles drag-and-drop of files onto the chat panel.
 */
class ChatDragDropHandler(
    private val project: Project,
    private val appState: KiloAppState,
    private val targetComponent: JComponent
) {

    private var originalBorder: javax.swing.border.Border? = null

    fun setup() {
        val dropTargetListener = object : DropTargetAdapter() {
            override fun dragEnter(event: DropTargetDragEvent) {
                if (isFileDropSupported(event)) {
                    event.acceptDrag(DnDConstants.ACTION_COPY)
                    originalBorder = targetComponent.border
                    targetComponent.border = BorderFactory.createCompoundBorder(
                        BorderFactory.createLineBorder(KiloTheme.borderWarning, 2),
                        JBUI.Borders.empty()
                    )
                } else {
                    event.rejectDrag()
                }
            }

            override fun dragOver(event: DropTargetDragEvent) {
                if (isFileDropSupported(event)) {
                    event.acceptDrag(DnDConstants.ACTION_COPY)
                } else {
                    event.rejectDrag()
                }
            }

            override fun dragExit(event: DropTargetEvent) {
                targetComponent.border = originalBorder ?: JBUI.Borders.empty()
            }

            override fun drop(event: DropTargetDropEvent) {
                targetComponent.border = originalBorder ?: JBUI.Borders.empty()

                try {
                    if (!event.isDataFlavorSupported(DataFlavor.javaFileListFlavor)) {
                        event.rejectDrop()
                        return
                    }

                    event.acceptDrop(DnDConstants.ACTION_COPY)
                    val transferable = event.transferable

                    @Suppress("UNCHECKED_CAST")
                    val files = transferable.getTransferData(DataFlavor.javaFileListFlavor) as? List<File>

                    files?.forEach { file ->
                        addDroppedFile(file)
                    }

                    event.dropComplete(true)
                } catch (e: Exception) {
                    event.dropComplete(false)
                }
            }

            private fun isFileDropSupported(event: DropTargetDragEvent): Boolean {
                return event.isDataFlavorSupported(DataFlavor.javaFileListFlavor)
            }
        }

        targetComponent.dropTarget = DropTarget(targetComponent, DnDConstants.ACTION_COPY, dropTargetListener, true)
    }

    private fun addDroppedFile(file: File) {
        val basePath = project.basePath
        val relativePath = if (basePath != null && file.absolutePath.startsWith(basePath)) {
            file.absolutePath.removePrefix(basePath).removePrefix("/").removePrefix("\\")
        } else {
            file.name
        }

        val mime = if (file.isDirectory) "application/x-directory" else "text/plain"

        val attachedFile = AttachedFile(
            absolutePath = file.absolutePath,
            relativePath = relativePath,
            startLine = null,
            endLine = null,
            mime = mime
        )

        appState.addFileToContext(attachedFile)
    }
}
