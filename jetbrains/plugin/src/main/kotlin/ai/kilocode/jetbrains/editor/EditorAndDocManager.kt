package ai.kilocode.jetbrains.editor

import ai.kilocode.jetbrains.monitoring.ScopeRegistry
import ai.kilocode.jetbrains.monitoring.DisposableTracker
import ai.kilocode.jetbrains.plugin.SystemObjectProvider
import ai.kilocode.jetbrains.util.URI
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.chains.DiffRequestChain
import com.intellij.diff.chains.SimpleDiffRequestChain
import com.intellij.diff.contents.DiffContent
import com.intellij.diff.contents.FileDocumentContentImpl
import com.intellij.diff.editor.ChainDiffVirtualFile
import com.intellij.diff.editor.DiffEditorTabFilesManager
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.diff.DiffBundle
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.readText
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
import java.io.FileInputStream
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max

private data class FileEvent(
    val uri: String,
    val added: Boolean,
    val isText: Boolean
)

@Service(Service.Level.PROJECT)
class EditorAndDocManager(val project: Project) : Disposable {

    private val logger = Logger.getInstance(EditorAndDocManager::class.java)
    private val ideaEditorListener: FileEditorManagerListener

    private val messageBusConnection = project.messageBus.connect()

    private var state = DocumentsAndEditorsState()
    private var lastNotifiedState = DocumentsAndEditorsState()
    private var editorHandles = ConcurrentHashMap<String, EditorHolder>()
    private val ideaOpenedEditor = ConcurrentHashMap<String, Editor>()
    private var tabManager: TabStateManager = TabStateManager(project)

    private var job: Job? = null
    private val editorStateService: EditorStateService = EditorStateService(project)
    
    private val fileEventScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val fileEventChannel = Channel<FileEvent>(Channel.CONFLATED)

    init {
        ScopeRegistry.register("EditorAndDocManager.fileEventScope", fileEventScope)
        
        @OptIn(FlowPreview::class)
        fileEventScope.launch {
            fileEventChannel.consumeAsFlow()
                .debounce(50) // 50ms debounce
                .collect { event ->
                    sync2ExtHost(URI.file(event.uri), event.added, event.isText)
                }
        }
        
        ideaEditorListener = object : FileEditorManagerListener {
            // Update and synchronize editor state when file is opened
            override fun fileOpened(source: FileEditorManager, file: VirtualFile) {
                source.getEditorList(file).forEach { editor ->
                    if (file == editor.file) {
                        // Record and synchronize
                        if (isSubClassof(editor, "com.intellij.diff.editor.DiffEditorBase") || isSubClassof(editor, "com.intellij.diff.editor.DiffFileEditorBase")) {
                            if (editor.filesToRefresh.size == 1) {
                                val reffile = editor.filesToRefresh[0]
                                val uri = URI.file(reffile.path)
                                val older = getEditorHandleByUri(uri, true)
                                if (older != null && older.ideaEditor == null) {
                                    older.ideaEditor = editor
                                }
                            }
                        } else {
                            val older = getEditorHandleByUri(URI.file(file.path), false)
                            if (older == null) {
                                val uri = URI.file(editor.file.path)
                                val isText = FileDocumentManager.getInstance().getDocument(file) != null
                                fileEventChannel.trySend(FileEvent(uri.toString(), false, isText))
                                // Store editor reference for later use
                                fileEventScope.launch {
                                    delay(100) // Wait for debounced sync to complete
                                    val handle = getEditorHandleByUri(uri, false)
                                    if (handle != null) {
                                        handle.ideaEditor = editor
                                        val group = tabManager.createTabGroup(EditorGroupColumn.BESIDE.value, true)
                                        val options = TabOptions(isActive = true)
                                        val tab = group.addTab(EditorTabInput(uri, uri.path, ""), options)
                                        handle.tab = tab
                                        handle.group = group
                                    }
                                }
                            }
                        }
                    }
                }
            }

            private fun isSubClassof(editor: FileEditor?, s: String): Boolean {
                if (editor == null) return false
                var clazz: Class<*>? = editor.javaClass
                while (clazz != null) {
                    if (clazz.name == s) {
                        return true
                    }
                    clazz = clazz.superclass
                }
                return false
            }

            override fun fileClosed(source: FileEditorManager, cFile: VirtualFile) {
                logger.info("file closed $cFile")
                var diff = false
                var path = cFile.path
                if (cFile is ChainDiffVirtualFile) {
                    (cFile.chain.requests[0] as? SimpleDiffRequest).let {
                        it?.contents?.forEach { content ->
                            if (content is FileDocumentContentImpl) {
                                path = content.file.path
                                diff = true
                            }
                        }
                    }
                }
                getEditorHandleByUri(URI.file(path), diff)?.let { handle ->
                    handle.setActive(false)
                    logger.info("file closed handle $handle")
                    removeEditor(handle.id)
                }
            }
        }
        messageBusConnection.subscribe(FileEditorManagerListener.FILE_EDITOR_MANAGER, ideaEditorListener)
    }

    fun initCurrentIdeaEditor() {
        CoroutineScope(Dispatchers.Default).launch {
            // Wait for extension host to be ready before initializing editors
            try {
                // Get ExtensionHostManager from SystemObjectProvider
                val systemObjectProvider = SystemObjectProvider.getInstance(project)
                val extensionHostManager = systemObjectProvider.get<ai.kilocode.jetbrains.core.ExtensionHostManager>("extensionHostManager")
                
                if (extensionHostManager == null) {
                    logger.error("ExtensionHostManager not available in SystemObjectProvider, skipping editor initialization")
                    return@launch
                }
                
                val isReady = try {
                    extensionHostManager.waitForReady().get()
                } catch (e: Exception) {
                    logger.error("Error waiting for extension host to be ready", e)
                    false
                }
                
                if (!isReady) {
                    logger.error("Extension host failed to initialize, skipping editor initialization")
                    return@launch
                }
                
                logger.info("Extension host ready, initializing current IDE editors")
                
                FileEditorManager.getInstance(project).allEditors.forEach { editor ->
                    // Record and synchronize
                    if (editor is FileEditor) {
                        val uri = URI.file(editor.file.path)
                        val handle = sync2ExtHost(uri, false)
                        handle.ideaEditor = editor
                        val group = tabManager.createTabGroup(EditorGroupColumn.BESIDE.value, true)
                        val options = TabOptions(isActive = true)
                        val tab = group.addTab(EditorTabInput(uri, uri.path, ""), options)
                        handle.tab = tab
                        handle.group = group
                    }
                }
                
                logger.info("Completed initialization of ${FileEditorManager.getInstance(project).allEditors.size} editors")
            } catch (e: Exception) {
                logger.error("Error during editor initialization", e)
            }
        }
    }

    suspend fun sync2ExtHost(documentUri: URI, diff: Boolean, isText: Boolean = true, options: ResolvedTextEditorConfiguration = ResolvedTextEditorConfiguration()): EditorHolder {
        val eh = getEditorHandleByUri(documentUri, diff)
        if (eh != null) {
            return eh
        }
        // Generate unique ID
        val id = java.util.UUID.randomUUID().toString()

        val documentState = openDocument(documentUri, isText)

        // Create editor state
        val editorState = TextEditorAddData(
            id = id,
            documentUri = documentUri,
            options = options,
            selections = emptyList(),
            visibleRanges = emptyList(),
            editorPosition = null,
        )
        // Create editor handle
        val handle = EditorHolder(id, editorState, documentState, diff, this)
        // Update state
        state.documents[documentUri] = documentState
        state.editors[id] = editorState
        editorHandles[id] = handle
        handle.setActive(true)
        processUpdates()
        return handle
    }

    fun createContent(uri: URI, project: Project, type: FileType? = null): DiffContent? {
        val path = uri.path
        val scheme = uri.scheme
        val query = uri.query
        if (scheme.isNotEmpty()) {
            val contentFactory = DiffContentFactory.getInstance()
            if (scheme == "file") {
                val vfs = LocalFileSystem.getInstance()
                val fileIO = File(path)
                if (!fileIO.exists()) {
                    fileIO.createNewFile()
                    vfs.refreshIoFiles(listOf(fileIO.parentFile))
                }
                val file = vfs.refreshAndFindFileByPath(path) ?: run {
                    logger.warn("File not found: $path")
                    return null
                }
                return contentFactory.create(project, file)
            } else if (scheme == "cline-diff") {
                val string = if (query != null) {
                    val bytes = java.util.Base64.getDecoder().decode(query)
                    String(bytes)
                } else {
                    ""
                }
                val content = contentFactory.create(project, string, type)
                return content
            }
            return null
        } else {
            return null
        }
    }

    suspend fun openEditor(documentUri: URI, options: ResolvedTextEditorConfiguration = ResolvedTextEditorConfiguration()): EditorHolder {
        val fileEditorManager = FileEditorManager.getInstance(project)
        val path = documentUri.path
        var ideaEditor: Array<FileEditor?>? = null

        val vfs = LocalFileSystem.getInstance()
        val file = vfs.findFileByPath(path)
        file?.let {
            ApplicationManager.getApplication().invokeAndWait {
                ideaEditor = fileEditorManager.openFile(it, true)
            }
        }
        val eh = getEditorHandleByUri(documentUri, false)
        if (eh != null) {
            return eh
        }
        val handle = sync2ExtHost(documentUri, false, true, options)
        ideaEditor?.let {
            if (it.isNotEmpty()) {
                handle.ideaEditor = it[0]
            }
        }
        val group = tabManager.createTabGroup(EditorGroupColumn.BESIDE.value, true)
        val options = TabOptions(isActive = true)
        val tab = group.addTab(EditorTabInput(documentUri, documentUri.path, ""), options)
        handle.tab = tab
        handle.group = group
        return handle
    }

    suspend fun openDiffEditor(left: URI, documentUri: URI, title: String, options: ResolvedTextEditorConfiguration = ResolvedTextEditorConfiguration()): EditorHolder {
        val content2 = createContent(documentUri, project)
        val content1 = createContent(left, project, content2?.contentType)
        if (content1 != null && content2 != null) {
            val request = SimpleDiffRequest(title, content1, content2, left.path, documentUri.path)
            var ideaEditor: Array<out FileEditor?>? = null
            ApplicationManager.getApplication().invokeAndWait {
                LocalFileSystem.getInstance().findFileByPath(documentUri.path)
                    ?.let {
                        ApplicationManager.getApplication().runReadAction { FileEditorManager.getInstance(project).closeFile(it) }
                    }

                val diffEditorTabFilesManager = DiffEditorTabFilesManager.getInstance(project)
                val requestChain: DiffRequestChain = SimpleDiffRequestChain(request)
                val diffFile = ChainDiffVirtualFile(requestChain, DiffBundle.message("label.default.diff.editor.tab.name", *arrayOfNulls<Any>(0)))
                ideaEditor = diffEditorTabFilesManager.showDiffFile(diffFile, true)
            }
            ideaEditor?.let {
                val handle = sync2ExtHost(documentUri, true, true, options)
                if (it.isNotEmpty()) {
                    handle.ideaEditor = it[0]
                }
                handle.title = title

                val group = tabManager.createTabGroup(EditorGroupColumn.BESIDE.value, true)
                val options = TabOptions(isActive = true)
                val tab = group.addTab(TextDiffTabInput(left, documentUri), options)
                handle.tab = tab
                handle.group = group
                return handle
            } ?: run {
                val handle = sync2ExtHost(documentUri, true, true, options)
                return handle
            }
        } else {
            val handle = sync2ExtHost(documentUri, true, true, options)
            return handle
        }
    }

    fun getEditorHandleByUri(resource: URI, diff: Boolean): EditorHolder? {
        val values = editorHandles.values
        for (handle in values) {
            if (handle.document.uri.path == resource.path && handle.diff == diff) {
                return handle
            }
        }
        return null
    }

    fun getEditorHandleByUri(resource: URI): List<EditorHolder> {
        val list = mutableListOf<EditorHolder>()
        val values = editorHandles.values
        for (handle in values) {
            if (handle.document.uri.path == resource.path) {
                list.add(handle)
            }
        }
        return list
    }

    fun getEditorHandleById(id: String): EditorHolder? {
        return editorHandles[id]
    }

    suspend fun openDocument(uri: URI, isText: Boolean = true): ModelAddedData {
        // Update document content - Use ReadAction to wrap file system operations
        val text = if (isText) {
            ApplicationManager.getApplication().runReadAction<String> {
                val vfs = LocalFileSystem.getInstance()
                val file = vfs.findFileByPath(uri.path)
                if (file != null) {
                    val len = file.length
                    if (len > 3 * 1024 * 1024) {
                        val buffer = ByteArray(3 * 1024 * 1024)
                        val inputStream = FileInputStream(File(file.path))
                        val bytesRead = inputStream.read(buffer)
                        inputStream.close()
                        String(buffer, 0, bytesRead, Charsets.UTF_8)
                    } else {
                        file.readText()
                    }
                } else {
                    ""
                }
            }
        } else {
            "bin"
        }
        if (state.documents[uri] == null) {
            val document = ModelAddedData(
                uri = uri,
                versionId = 1,
                lines = text.lines(),
                EOL = "\n",
                languageId = "",
                isDirty = false,
                encoding = "utf8",
            )
            state.documents[uri] = document
            processUpdates()
        }
        return state.documents[uri]!!
    }

    fun removeEditor(id: String) {
        state.editors.remove(id)
        val handler = editorHandles.remove(id)
        var needDeleteDoc = true
        val values = editorHandles.values
        values.forEach { value ->
            if (value.document.uri == handler?.document?.uri) {
                needDeleteDoc = false
            }
        }
        if (needDeleteDoc) {
            state.documents.remove(handler?.document?.uri)
        }
        if (state.activeEditorId == id) {
            state.activeEditorId = null
        }
        scheduleUpdate()

        handler?.tab?.let {
            tabManager.removeTab(it.id)
        }
        handler?.group?.let {
            tabManager.removeGroup(it.groupId)
        }
    }

    // from exthost
    fun closeTab(id: String) {
        val tab = tabManager.removeTab(id)
        tab?.let { tab ->
            val handler = getEditorHandleByTabId(id)
            handler?.let {
                state.editors.remove(it.id)
                val handler = editorHandles.remove(it.id)
                this.state.documents.remove(it.document.uri)
                if (state.activeEditorId == it.id) {
                    state.activeEditorId = null
                }
                handler?.let { h ->
                    if (h.ideaEditor != null) {
                        ApplicationManager.getApplication().invokeAndWait {
                            h.ideaEditor?.dispose()
                        }
                    } else {
                        ApplicationManager.getApplication().invokeAndWait {
                            // Note: DiffRequestProcessorEditor is deprecated, but we need to handle existing diff editors
                            // The new API uses DiffEditorViewerFileEditors, but for compatibility we still check the old type
                            @Suppress("DEPRECATION")
                            FileEditorManager.getInstance(project).allEditors.forEach { editor ->
                                // Check if it's a diff editor by class name to avoid direct type reference
                                if (handler.diff && editor.javaClass.simpleName.contains("DiffRequestProcessorEditor")) {
                                    try {
                                        // Use reflection to access processor and activeRequest
                                        val processorField = editor.javaClass.getDeclaredField("processor")
                                        processorField.isAccessible = true
                                        val processor = processorField.get(editor)

                                        val activeRequestMethod = processor.javaClass.getMethod("getActiveRequest")
                                        val activeRequest = activeRequestMethod.invoke(processor)

                                        if (activeRequest != null) {
                                            val filesToRefreshMethod = activeRequest.javaClass.getMethod("getFilesToRefresh")

                                            @Suppress("UNCHECKED_CAST")
                                            val filesToRefresh = filesToRefreshMethod.invoke(activeRequest) as? List<*>

                                            filesToRefresh?.forEach { file ->
                                                val pathMethod = file?.javaClass?.getMethod("getPath")
                                                val path = pathMethod?.invoke(file) as? String
                                                if (path == handler.document.uri.path) {
                                                    editor.dispose()
                                                }
                                            }
                                        }
                                    } catch (e: Exception) {
                                        logger.warn("Failed to handle diff editor disposal: ${e.message}")
                                    }
                                }
                            }
                        }
                    }
                }
                scheduleUpdate()
            }
        }
    }

    fun closeGroup(id: Int) {
        tabManager.removeGroup(id)
    }

    private fun getEditorHandleByTabId(id: String): EditorHolder? {
        for ((_, handle) in editorHandles) {
            if (handle.tab != null && handle.tab?.id == id) {
                return handle
            }
        }
        return null
    }

    override fun dispose() {
        ScopeRegistry.unregister("EditorAndDocManager.fileEventScope")
        fileEventChannel.close()
        fileEventScope.cancel()
        messageBusConnection.dispose()
    }

    fun didUpdateActive(handle: EditorHolder) {
        if (handle.isActive) {
            setActiveEditor(id = handle.id)
        } else if (state.activeEditorId == handle.id) {
            // If the current active editor is set to inactive, select the first active editor
            editorHandles.values.firstOrNull { it.isActive }?.let {
                setActiveEditor(id = it.id)
            }
        }
    }

    private fun setActiveEditor(id: String) {
        state.activeEditorId = id
        scheduleUpdate()
    }

    private fun scheduleUpdate() {
        job?.cancel()
        job = fileEventScope.launch {
            delay(10)
            processUpdates()
        }
    }
    private fun copy(state: DocumentsAndEditorsState): DocumentsAndEditorsState {
        val rst = DocumentsAndEditorsState(
            editors = ConcurrentHashMap(),
            documents = ConcurrentHashMap(),
            activeEditorId = state.activeEditorId,
        )
        rst.editors.putAll(state.editors)
        rst.documents.putAll(state.documents)
        return rst
    }
    private suspend fun processUpdates() {
        val delta = state.delta(lastNotifiedState)

        // Update last notified state
        lastNotifiedState = copy(state)

        // Send document and editor change notifications
        delta.itemsDelta?.let { itemsDelta ->

            editorStateService.acceptDocumentsAndEditorsDelta(itemsDelta)
        }

        // Send editor property change notifications
        if (delta.editorDeltas.isNotEmpty()) {
            editorStateService.acceptEditorPropertiesChanged(delta.editorDeltas)
        }

        // Send document content change notifications
        if (delta.documentDeltas.isNotEmpty()) {
            editorStateService.acceptModelChanged(delta.documentDeltas)
        }
    }

    suspend fun updateDocumentAsync(document: ModelAddedData) {
        // Check if the document exists
        if (state.documents[document.uri] != null) {
            state.documents[document.uri] = document
            processUpdates()
        }
    }

    fun updateDocument(document: ModelAddedData) {
        // Check if the document exists
        if (state.documents[document.uri] != null) {
            state.documents[document.uri] = document
            scheduleUpdate()
        }
    }

    suspend fun syncUpdates() {
        job?.cancel()
        processUpdates()
    }

    fun updateEditor(state: TextEditorAddData) {
        if (this.state.editors[state.id] != null) {
            this.state.editors[state.id] = state
            scheduleUpdate()
        }
    }

    fun getIdeaDiffEditor(uri: URI): WeakReference<Editor>? {
        val editor = ideaOpenedEditor[uri.path] ?: return null
        return WeakReference(editor)
    }

    fun onIdeaDiffEditorCreated(url: URI, editor: Editor) {
        ideaOpenedEditor.put(url.path, editor)
    }

    fun onIdeaDiffEditorReleased(url: URI, editor: Editor) {
        ideaOpenedEditor.remove(url.path)
    }
}

data class DocumentsAndEditorsState(
    var editors: MutableMap<String, TextEditorAddData> = ConcurrentHashMap(),
    var documents: MutableMap<URI, ModelAddedData> = ConcurrentHashMap(),
    var activeEditorId: String? = null,
) {

    fun delta(lastState: DocumentsAndEditorsState): Delta {
        // Calculate document changes
        val currentDocumentUrls = documents.keys.toSet()
        val lastDocumentUrls = lastState.documents.keys.toSet()

        val removedUrls = lastDocumentUrls - currentDocumentUrls
        val addedUrls = currentDocumentUrls - lastDocumentUrls

        val addedDocuments = addedUrls.mapNotNull { documents[it] }

        // Calculate editor changes
        val addedEditors = mutableListOf<TextEditorAddData>()
        val editorDeltas = mutableMapOf<String, EditorPropertiesChangeData>()

        val currentEditorIds = editors.keys.toSet()
        val lastEditorIds = lastState.editors.keys.toSet()

        val removedIds = lastEditorIds - currentEditorIds

        // Iterate through all current editors, handling additions and property changes simultaneously
        editors.forEach { (id, editor) ->
            lastState.editors[id]?.let { lastEditor ->
                // Check for option changes
                val optionsChanged = editor.options != lastEditor.options

                // Check for selection area changes
                val selectionsChanged = editor.selections != lastEditor.selections

                // Check for visible range changes
                val visibleRangesChanged = editor.visibleRanges != lastEditor.visibleRanges

                // If there are any changes, create EditorPropertiesChangeData
                if (optionsChanged || selectionsChanged || visibleRangesChanged) {
                    editorDeltas[id] = EditorPropertiesChangeData(
                        options = if (optionsChanged) editor.options else null,
                        selections = if (selectionsChanged) {
                            SelectionChangeEvent(
                                selections = editor.selections,
                                source = null,
                            )
                        } else {
                            null
                        },
                        visibleRanges = if (visibleRangesChanged) editor.visibleRanges else null,
                    )
                }
            } ?: run {
                // Newly added editor
                addedEditors.add(editor)
            }
        }

        // Calculate document content changes
        val documentDeltas = mutableMapOf<URI, ModelChangedEvent>()

        // Iterate through all current documents, checking for content changes
        documents.forEach { (uri, document) ->
            lastState.documents[uri]?.let { lastDocument ->
                // Check if the document has changes
                val hasChanges = document.lines != lastDocument.lines ||
                    document.EOL != lastDocument.EOL ||
                    document.languageId != lastDocument.languageId ||
                    document.isDirty != lastDocument.isDirty ||
                    document.encoding != lastDocument.encoding

                if (hasChanges) {
                    // If content has changed, create changes for the entire document
                    val changes = listOf(
                        ModelContentChange(
                            range = Range(
                                startLineNumber = 1,
                                startColumn = 1,
                                endLineNumber = max(1, lastDocument.lines.size),
                                endColumn = max(1, (lastDocument.lines.lastOrNull()?.length ?: 0) + 1),
                            ),
                            rangeOffset = 0,
                            rangeLength = lastDocument.lines.joinToString(lastDocument.EOL).length,
                            text = document.lines.joinToString(document.EOL),
                        ),
                    )

                    documentDeltas[uri] = ModelChangedEvent(
                        changes = changes,
                        eol = document.EOL,
                        versionId = document.versionId,
                        isUndoing = false,
                        isRedoing = false,
                        isDirty = document.isDirty,
                    )
                }
            }
        }

        val itemsDelta = DocumentsAndEditorsDelta(
            removedDocuments = removedUrls.toList(),
            addedDocuments = addedDocuments,
            removedEditors = removedIds.toList(),
            addedEditors = addedEditors,
            newActiveEditor = if (activeEditorId != lastState.activeEditorId) activeEditorId else null,
        )

        return Delta(
            itemsDelta = if (itemsDelta.isEmpty()) null else itemsDelta,
            editorDeltas = editorDeltas,
            documentDeltas = documentDeltas,
        )
    }
}
data class Delta(
    val itemsDelta: DocumentsAndEditorsDelta?,
    val editorDeltas: MutableMap<String, EditorPropertiesChangeData>,
    val documentDeltas: MutableMap<URI, ModelChangedEvent>,
)
