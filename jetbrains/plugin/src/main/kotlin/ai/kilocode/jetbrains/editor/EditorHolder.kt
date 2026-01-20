package ai.kilocode.jetbrains.editor

import ai.kilocode.jetbrains.monitoring.ScopeRegistry
import ai.kilocode.jetbrains.monitoring.DisposableTracker
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.LogicalPosition
import com.intellij.openapi.editor.ScrollType
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.vfs.LocalFileSystem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.consumeAsFlow
import kotlinx.coroutines.flow.debounce
import java.io.File
import kotlin.math.max
import kotlin.math.min

private sealed class EditorEvent {
    data class Activation(val active: Boolean) : EditorEvent()
    data class Edit(val lines: List<String>, val versionId: Int?) : EditorEvent()
}

/**
 * Manages the state and behavior of an editor instance
 * Handles synchronization between IntelliJ editor and VSCode editor state
 *
 * @param id Unique identifier for this editor
 * @param state Editor state data
 * @param document Document data associated with this editor
 * @param diff Whether this is a diff editor
 * @param stateManager Reference to the editor and document manager
 */
class EditorHolder(
    val id: String,
    var state: TextEditorAddData,
    var document: ModelAddedData,
    val diff: Boolean,
    private val stateManager: EditorAndDocManager,
) {
    val logger = Logger.getInstance(EditorHolder::class.java)
    private val editorOperationScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val activationEventChannel = Channel<Boolean>(Channel.CONFLATED)
    private val editEventChannel = Channel<EditorEvent.Edit>(Channel.CONFLATED)
     
    init {
        ScopeRegistry.register("EditorHolder.editorOperationScope-$id", editorOperationScope)
        
        @OptIn(FlowPreview::class)
        editorOperationScope.launch {
            activationEventChannel.consumeAsFlow()
                .debounce(100) // 100ms debounce for activation
                .collect { active ->
                    delay(100)
                    stateManager.didUpdateActive(this@EditorHolder)
                }
        }
        
        @OptIn(FlowPreview::class)
        editorOperationScope.launch {
            editEventChannel.consumeAsFlow()
                .debounce(50) // 50ms debounce for edits
                .collect { event ->
                    document.lines = event.lines
                    document.versionId = event.versionId ?: (document.versionId + 1)
                    stateManager.updateDocument(document)
                }
        }
    }

    /**
     * Indicates whether this editor is currently active.
     */
    var isActive: Boolean = false
        private set

    /**
     * The underlying IntelliJ Document associated with this editor.
     */
    private var editorDocument: Document? = null

    /**
     * The IntelliJ FileEditor instance for this editor.
     */
    var ideaEditor: FileEditor? = null

    /**
     * The title of the editor tab, if any.
     */
    var title: String? = null

    /**
     * The tab group handle this editor belongs to.
     */
    var group: TabGroupHandle? = null

    /**
     * The tab handle for this editor.
     */
    var tab: TabHandle? = null

    // Delayed update related fields

    /**
     * Job for debounced editor state updates.
     */
    private var editorUpdateJob: Job? = null

    /**
     * Job for debounced document state updates.
     */
    private var documentUpdateJob: Job? = null

    /**
     * Delay in milliseconds for debounced updates.
     */
    private val updateDelay: Long = 30 // 30ms delay

    /**
     * Updates editor selections and triggers a state update
     *
     * @param selections List of selections to apply
     */
    fun updateSelections(selections: List<Selection>) {
        state.selections = selections
        debouncedUpdateState()
    }

    fun updateVisibleRanges(ranges: List<Range>) {
        state.visibleRanges = ranges
        debouncedUpdateState()
    }

    fun updatePosition(position: Int?) {
        state.editorPosition = position
        debouncedUpdateState()
    }

    fun updateOptions(options: ResolvedTextEditorConfiguration) {
        state.options = options
        debouncedUpdateState()
    }

    fun setActive(active: Boolean) {
        if (isActive == active) return
        isActive = active
        if (editorDocument == null && active) {
            val vfs = LocalFileSystem.getInstance()
            val path = document.uri.path
            ApplicationManager.getApplication().runReadAction {
                val file = vfs.findFileByPath(path)
                editorDocument = file?.let { FileDocumentManager.getInstance().getDocument(it) }
            }
        }
        activationEventChannel.trySend(active)
    }

    fun revealRange(range: Range) {
        state.visibleRanges = listOf(range)
        stateManager.getIdeaDiffEditor(document.uri)?.get()?.let { e ->
            ApplicationManager.getApplication().invokeLater {
                val target = LogicalPosition(range.startLineNumber, 0)
                e.scrollingModel.scrollTo(target, ScrollType.RELATIVE)
            }
        }
        debouncedUpdateState()
    }

    /**
     * Updates document content by applying a text edit
     *
     * @param edit Text edit to apply
     * @return True if edit was applied successfully, false otherwise
     */
    suspend fun applyEdit(edit: TextEdit): Boolean {
        // Get current text content
        val content = editorDocument?.text ?: ""
        val lines = content.lines()
        val lineCount = lines.size

        // Calculate range
        val startLine = max(0, edit.textEdit.range.startLineNumber - 1)
        val startColumn = max(0, edit.textEdit.range.startColumn - 1)
        val endLine = min(lineCount - 1, edit.textEdit.range.endLineNumber - 1)
        val endColumn = min(lines[endLine].length, edit.textEdit.range.endColumn - 1)

        // Calculate offsets
        var startOffset = 0
        var endOffset = 0
        for (i in 0 until lineCount) {
            if (i < startLine) {
                startOffset += lines[i].length + 1 // +1 for newline
            } else if (i == startLine) {
                startOffset += min(startColumn, lines[i].length)
            }

            if (i < endLine) {
                endOffset += lines[i].length + 1 // +1 for newline
            } else if (i == endLine) {
                endOffset += min(endColumn, lines[i].length)
            }
        }

        // Ensure range is valid
        val textLength = content.length
        if (startOffset < 0 || endOffset > textLength || startOffset > endOffset) {
            return false
        }
        val end = (endLine < (edit.textEdit.range.endLineNumber - 1))
        val newText = edit.textEdit.text.replace("\r\n", "\n")
        val newContent = content.substring(0, startOffset) + newText + (if (!end) content.substring(endOffset) else "")
        ApplicationManager.getApplication().invokeAndWait {
            ApplicationManager.getApplication().runWriteAction {
                editorDocument?.setText(newContent)
            }
        }
        editorOperationScope.launch {
            delay(1000)
            val file = File(document.uri.path).parentFile
            if (file.exists()) {
                LocalFileSystem.getInstance().refreshIoFiles(listOf(file))
            }
        }
        val newDoc = ModelAddedData(
            uri = document.uri,
            versionId = document.versionId + 1,
            lines = newContent.lines(),
            EOL = document.EOL,
            languageId = document.languageId,
            isDirty = true,
            encoding = document.encoding,
        )
        document = newDoc
        stateManager.updateDocumentAsync(newDoc)
        return true
    }

    suspend fun save(): Boolean {
        ApplicationManager.getApplication().invokeLater {
            ApplicationManager.getApplication().runWriteAction {
                editorDocument?.let { FileDocumentManager.getInstance().saveDocument(it) }
            }
        }
        val newDoc = ModelAddedData(
            uri = document.uri,
            versionId = document.versionId + 1,
            lines = document.lines,
            EOL = document.EOL,
            languageId = document.languageId,
            isDirty = false,
            encoding = document.encoding,
        )
        document = newDoc
        stateManager.updateDocumentAsync(newDoc)
        return true
    }

    fun updateDocumentContent(lines: List<String>, versionId: Int? = null) {
        editEventChannel.trySend(EditorEvent.Edit(lines, versionId))
    }

    /**
     * Updates the language ID of the document.
     * @param languageId The new language ID.
     */
    fun updateDocumentLanguage(languageId: String) {
        document.languageId = languageId
        debouncedUpdateDocument()
    }

    /**
     * Updates the encoding of the document.
     * @param encoding The new encoding.
     */
    fun updateDocumentEncoding(encoding: String) {
        document.encoding = encoding
        debouncedUpdateDocument()
    }

    suspend fun updateDocumentDirty(isDirty: Boolean) {
        if (document.isDirty == isDirty) return

        val newDoc = ModelAddedData(
            uri = document.uri,
            versionId = document.versionId + 1,
            lines = document.lines,
            EOL = document.EOL,
            languageId = document.languageId,
            isDirty = isDirty,
            encoding = document.encoding,
        )
        document = newDoc
        ApplicationManager.getApplication().invokeAndWait {
            val fileDocumentManager = FileDocumentManager.getInstance()
            editorDocument?.let { fileDocumentManager.saveDocument(it) }
        }

        debouncedUpdateDocument()
    }

    suspend fun syncDocumentState() {
        documentUpdateJob?.cancel()
        stateManager.updateDocument(document)
        stateManager.syncUpdates()
    }

    // Private methods
    /**
     * Updates editor state with debouncing to avoid excessive updates
     */
    private fun debouncedUpdateState() {
        editorUpdateJob?.cancel()
        editorUpdateJob = CoroutineScope(Dispatchers.Default).launch {
            delay(updateDelay)
            stateManager.updateEditor(state)
        }
    }

    /**
     * Updates document state with debouncing to avoid excessive updates.
     */
    private fun debouncedUpdateDocument() {
        documentUpdateJob?.cancel()
        documentUpdateJob = CoroutineScope(Dispatchers.Default).launch {
            delay(updateDelay)
            stateManager.updateDocument(document)
        }
    }

    /**
     * Disposes resources and cancels ongoing operations.
     * Should be called when the editor is no longer needed.
     */
    fun dispose() {
        ScopeRegistry.unregister("EditorHolder.editorOperationScope-$id")
        activationEventChannel.close()
        editEventChannel.close()
        editorOperationScope.cancel()
        editorUpdateJob?.cancel()
        documentUpdateJob?.cancel()
    }
}
