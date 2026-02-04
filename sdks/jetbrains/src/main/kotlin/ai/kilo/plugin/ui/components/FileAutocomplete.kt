package ai.kilo.plugin.ui.components

import ai.kilo.plugin.services.AttachedFile
import ai.kilo.plugin.services.KiloAppState
import ai.kilo.plugin.settings.KiloSettings
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.ColoredListCellRenderer
import com.intellij.ui.JBColor
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.*
import java.awt.Dimension
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.io.File
import javax.swing.*
import javax.swing.event.DocumentEvent
import javax.swing.event.DocumentListener
import javax.swing.text.JTextComponent

/**
 * File autocomplete component that triggers on "@" input.
 * Shows a popup with file search results and allows selection.
 */
class FileAutocomplete(
    private val project: Project,
    private val textComponent: JTextComponent,
    private val appState: KiloAppState,
    private val onFileSelected: (AttachedFile, String) -> Unit
) : Disposable {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var popup: JBPopup? = null
    private var triggerIndex: Int = -1
    private var searchJob: Job? = null

    private val listModel = DefaultListModel<FileItem>()
    private val fileList = JBList(listModel)

    init {
        setupKeyListener()
        setupDocumentListener()
        setupFileList()
    }

    private fun setupKeyListener() {
        textComponent.addKeyListener(object : KeyAdapter() {
            override fun keyTyped(e: KeyEvent) {
                // Check for "@" trigger
                if (e.keyChar == '@') {
                    val offset = textComponent.caretPosition
                    val text = textComponent.text

                    // Can trigger if at start or preceded by whitespace
                    val canTrigger = offset == 0 || 
                        (offset > 0 && text[offset - 1].isWhitespace())

                    if (canTrigger) {
                        // Store trigger position (before the @ is inserted)
                        triggerIndex = offset
                        SwingUtilities.invokeLater {
                            showPopup()
                        }
                    }
                }
            }

            override fun keyPressed(e: KeyEvent) {
                if (popup?.isVisible == true) {
                    when (e.keyCode) {
                        KeyEvent.VK_UP -> {
                            moveSelection(-1)
                            e.consume()
                        }
                        KeyEvent.VK_DOWN -> {
                            moveSelection(1)
                            e.consume()
                        }
                        KeyEvent.VK_ENTER -> {
                            selectCurrent()
                            e.consume()
                        }
                        KeyEvent.VK_TAB -> {
                            val selected = fileList.selectedValue
                            if (selected?.isDirectory == true) {
                                expandDirectory(selected)
                            } else {
                                selectCurrent()
                            }
                            e.consume()
                        }
                        KeyEvent.VK_ESCAPE -> {
                            hidePopup()
                            e.consume()
                        }
                    }
                }
            }
        })
    }

    private fun setupDocumentListener() {
        textComponent.document.addDocumentListener(object : DocumentListener {
            override fun insertUpdate(e: DocumentEvent) = onTextChanged()
            override fun removeUpdate(e: DocumentEvent) = onTextChanged()
            override fun changedUpdate(e: DocumentEvent) = onTextChanged()
        })
    }

    private fun onTextChanged() {
        if (popup?.isVisible != true) {
            // Check if we should re-trigger (after backspace)
            val text = textComponent.text
            val offset = textComponent.caretPosition

            // Find nearest "@" before cursor
            val idx = text.lastIndexOf('@', (offset - 1).coerceAtLeast(0))
            if (idx >= 0) {
                val between = text.substring(idx, offset)
                val before = if (idx == 0) null else text[idx - 1]

                // Show if @ is at start or preceded by whitespace, and no whitespace between @ and cursor
                if ((before == null || before.isWhitespace()) && !between.contains(Regex("\\s"))) {
                    triggerIndex = idx
                    showPopup()
                }
            }
            return
        }

        // Update search based on filter text
        updateSearch()
    }

    private fun setupFileList() {
        fileList.cellRenderer = FileItemRenderer()
        fileList.selectionMode = ListSelectionModel.SINGLE_SELECTION

        fileList.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount == 1) {
                    selectCurrent()
                }
            }
        })
    }

    private fun showPopup() {
        hidePopup()

        // Initial search with empty query
        updateSearch()

        val scrollPane = JBScrollPane(fileList).apply {
            border = JBUI.Borders.empty()
            preferredSize = Dimension(300, 200)
        }

        popup = JBPopupFactory.getInstance()
            .createComponentPopupBuilder(scrollPane, fileList)
            .setRequestFocus(false)
            .setFocusable(false)
            .setResizable(true)
            .setMovable(false)
            .setCancelOnClickOutside(true)
            .setCancelOnOtherWindowOpen(true)
            .setCancelKeyEnabled(false) // Handle escape ourselves
            .createPopup()

        // Position above the caret
        try {
            val caretRect = textComponent.modelToView(textComponent.caretPosition)
            if (caretRect != null) {
                popup?.showInScreenCoordinates(
                    textComponent,
                    java.awt.Point(caretRect.x, caretRect.y - 210)
                )
            }
        } catch (e: Exception) {
            // Fallback: show below component
            popup?.showUnderneathOf(textComponent)
        }
    }

    private fun hidePopup() {
        popup?.cancel()
        popup = null
        searchJob?.cancel()
    }

    private fun getFilterText(): String {
        if (triggerIndex < 0) return ""
        val text = textComponent.text
        val offset = textComponent.caretPosition
        if (offset <= triggerIndex) return ""
        
        // Get text after "@" up to cursor
        val start = (triggerIndex + 1).coerceAtMost(text.length)
        val end = offset.coerceAtMost(text.length)
        return if (start < end) text.substring(start, end) else ""
    }

    private fun updateSearch() {
        searchJob?.cancel()
        searchJob = scope.launch {
            val query = getFilterText()
            
            try {
                val results = appState.searchFiles(query, 20)
                
                withContext(Dispatchers.Main) {
                    listModel.clear()
                    
                    // Sort by frecency, then depth, then alphabetically
                    val settings = KiloSettings.getInstance()
                    val sorted = results.sortedWith(
                        compareByDescending<String> { settings.getFrecencyScore(it) }
                            .thenBy { it.count { c -> c == '/' } }
                            .thenBy { it }
                    )
                    
                    sorted.forEach { path ->
                        val isDir = path.endsWith("/")
                        listModel.addElement(FileItem(path.trimEnd('/'), isDir))
                    }
                    
                    if (listModel.size() > 0) {
                        fileList.selectedIndex = 0
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Ignore errors during search
            }
        }
    }

    private fun moveSelection(delta: Int) {
        val current = fileList.selectedIndex
        val newIndex = (current + delta).coerceIn(0, listModel.size() - 1)
        fileList.selectedIndex = newIndex
        fileList.ensureIndexIsVisible(newIndex)
    }

    private fun selectCurrent() {
        val selected = fileList.selectedValue ?: return
        hidePopup()

        // Record frecency
        KiloSettings.getInstance().recordFileAccess(selected.path)

        // Get project base path for relative path calculation
        val basePath = project.basePath ?: ""
        val absolutePath = if (selected.path.startsWith("/")) {
            selected.path
        } else {
            "$basePath/${selected.path}"
        }
        val relativePath = selected.path

        // Create attached file
        val attachedFile = AttachedFile(
            absolutePath = absolutePath,
            relativePath = relativePath,
            mime = if (selected.isDirectory) "application/x-directory" else "text/plain"
        )

        // Replace the @query with @filename in text
        val displayText = "@${selected.path}"
        onFileSelected(attachedFile, displayText)

        // Clear trigger
        triggerIndex = -1
    }

    private fun expandDirectory(item: FileItem) {
        // Update text to include directory path for further drilling
        val text = textComponent.text
        val offset = textComponent.caretPosition
        val start = triggerIndex + 1
        
        if (start < offset) {
            // Replace current filter with directory path
            val newText = text.substring(0, start) + item.path + "/" + text.substring(offset)
            textComponent.text = newText
            textComponent.caretPosition = start + item.path.length + 1
        }
        
        // Trigger new search
        updateSearch()
    }

    override fun dispose() {
        hidePopup()
        scope.cancel()
    }

    /**
     * Data class for file items in the list.
     */
    data class FileItem(
        val path: String,
        val isDirectory: Boolean
    ) {
        val filename: String get() = path.substringAfterLast('/')
    }

    /**
     * Cell renderer for file items.
     */
    private class FileItemRenderer : ColoredListCellRenderer<FileItem>() {
        override fun customizeCellRenderer(
            list: JList<out FileItem>,
            value: FileItem,
            index: Int,
            selected: Boolean,
            hasFocus: Boolean
        ) {
            icon = if (value.isDirectory) AllIcons.Nodes.Folder else AllIcons.FileTypes.Any_type
            
            // Show filename in regular style
            append(value.filename)
            
            // Show directory path in gray
            val dir = value.path.substringBeforeLast('/', "")
            if (dir.isNotEmpty()) {
                append("  ")
                append(dir, SimpleTextAttributes.GRAYED_ATTRIBUTES)
            }
            
            if (value.isDirectory) {
                append("/", SimpleTextAttributes.GRAYED_ATTRIBUTES)
            }
        }
    }
}
