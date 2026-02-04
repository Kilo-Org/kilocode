package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.services.AttachedFile
import ai.kilo.plugin.services.KiloAppState
import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloSpacing
import ai.kilo.plugin.toolwindow.KiloTypography
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest
import java.awt.Cursor
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.BorderFactory
import javax.swing.JButton
import javax.swing.JPanel

/**
 * Panel displaying attached files as removable badges.
 * Shows above the prompt input when files are attached.
 * Clicking on a file badge opens that file in the editor.
 */
class AttachedFilesPanel(
    private val project: Project,
    private val appState: KiloAppState
) : JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.xs, KiloSpacing.xxs)), Disposable {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    init {
        isOpaque = false
        border = JBUI.Borders.empty(KiloSpacing.xxs, KiloSpacing.md)
        isVisible = false // Hidden by default

        // Subscribe to attached files
        scope.launch {
            appState.attachedFiles.collectLatest { files ->
                updateBadges(files)
            }
        }
    }

    private fun updateBadges(files: List<AttachedFile>) {
        removeAll()

        if (files.isEmpty()) {
            isVisible = false
            revalidate()
            repaint()
            return
        }

        isVisible = true

        // Add label
        add(JBLabel("Files:").apply {
            foreground = KiloTheme.textWeak
            font = font.deriveFont(KiloTypography.fontSizeXSmall)
        })

        // Add a badge for each file
        for (file in files) {
            add(createFileBadge(file))
        }

        // Add clear all button if multiple files
        if (files.size > 1) {
            add(createClearAllButton())
        }

        revalidate()
        repaint()
    }

    private fun createFileBadge(file: AttachedFile): JPanel {
        val badge = JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.xxs, 0)).apply {
            isOpaque = true
            background = KiloTheme.surfaceWarningWeak
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(KiloTheme.borderWarning, 1),
                JBUI.Borders.empty(KiloSpacing.xxs, KiloSpacing.sm)
            )
        }

        // File icon
        val icon = if (file.mime == "application/x-directory") {
            AllIcons.Nodes.Folder
        } else {
            AllIcons.FileTypes.Any_type
        }

        // Filename with optional line range
        val displayName = buildString {
            append(file.relativePath.substringAfterLast('/'))
            if (file.startLine != null) {
                append(":${file.startLine}")
                if (file.endLine != null && file.endLine != file.startLine) {
                    append("-${file.endLine}")
                }
            }
        }

        val label = JBLabel(displayName, icon, JBLabel.LEFT).apply {
            foreground = KiloTheme.textWarning
            font = font.deriveFont(KiloTypography.fontSizeXSmall)
            toolTipText = "Click to open: ${file.relativePath}"
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)

            addMouseListener(object : MouseAdapter() {
                override fun mouseClicked(e: MouseEvent) {
                    openFileInEditor(file)
                }

                override fun mouseEntered(e: MouseEvent) {
                    foreground = KiloTheme.textStrong
                }

                override fun mouseExited(e: MouseEvent) {
                    foreground = KiloTheme.textWarning
                }
            })
        }
        badge.add(label)

        // Remove button
        val removeButton = JButton(AllIcons.Actions.Close).apply {
            preferredSize = Dimension(14, 14)
            isFocusable = false
            isContentAreaFilled = false
            isBorderPainted = false
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            toolTipText = "Remove"

            addActionListener {
                appState.removeFileFromContext(file.absolutePath, file.startLine, file.endLine)
            }

            addMouseListener(object : MouseAdapter() {
                override fun mouseEntered(e: MouseEvent) {
                    isContentAreaFilled = true
                }
                override fun mouseExited(e: MouseEvent) {
                    isContentAreaFilled = false
                }
            })
        }
        badge.add(removeButton)

        return badge
    }

    private fun createClearAllButton(): JButton {
        return JButton("Clear all").apply {
            font = font.deriveFont(KiloTypography.fontSizeXSmall - 1)
            isFocusable = false
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            foreground = KiloTheme.textWeak
            addActionListener {
                appState.clearAttachedFiles()
            }
        }
    }

    /**
     * Open the attached file in the editor.
     * If a line range is specified, navigates to that line.
     */
    private fun openFileInEditor(file: AttachedFile) {
        val virtualFile = LocalFileSystem.getInstance().findFileByPath(file.absolutePath)
        if (virtualFile == null || !virtualFile.isValid) {
            return
        }

        // Line number is 0-based for OpenFileDescriptor
        val line = (file.startLine ?: 1) - 1
        val descriptor = OpenFileDescriptor(project, virtualFile, line.coerceAtLeast(0), 0)

        FileEditorManager.getInstance(project).openTextEditor(descriptor, true)
    }
    
    override fun dispose() {
        scope.cancel()
    }
}
