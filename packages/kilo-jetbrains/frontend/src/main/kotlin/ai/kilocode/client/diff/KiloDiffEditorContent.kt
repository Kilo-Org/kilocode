package ai.kilocode.client.diff

import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.diff.chains.DiffRequestProducer
import com.intellij.diff.chains.SimpleDiffRequestChain
import com.intellij.diff.impl.CacheDiffRequestChainProcessor
import com.intellij.diff.impl.DiffRequestProcessorListener
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonShortcuts
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.Separator
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.Key
import com.intellij.openapi.util.UserDataHolder
import com.intellij.openapi.vcs.FileStatus
import com.intellij.openapi.vfs.AsyncFileListener
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import com.intellij.ui.IdeBorderFactory
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.OnePixelSplitter
import com.intellij.ui.PopupHandler
import com.intellij.ui.SideBorder
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.TreeSpeedSearch
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.treeStructure.Tree
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.tree.TreeUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.nio.file.InvalidPathException
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicBoolean
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.JViewport
import javax.swing.JTree
import javax.swing.event.TreeExpansionEvent
import javax.swing.event.TreeExpansionListener
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeModel
import javax.swing.tree.TreeCellRenderer
import javax.swing.tree.TreeModel
import javax.swing.tree.TreeNode
import javax.swing.tree.TreePath

@RequiresEdt
internal fun buildDiffEditor(
    project: Project,
    params: Map<String, String>,
    files: List<DiffFileDto>,
    parent: Disposable,
    branch: String? = null,
    scope: CoroutineScope,
    refresh: ((DiffEditorData) -> Unit) -> Job,
    replace: (DiffEditorData) -> Unit,
): JComponent = DiffEditorView(project, params, files, parent, branch, scope, refresh, replace).component

internal val DIFF_FILE_KEY: Key<String> = Key.create("kilo.diff.file")

internal class DiffEditorView(
    private val project: Project,
    private val params: Map<String, String>,
    initial: List<DiffFileDto>,
    private val parent: Disposable,
    branch: String?,
    private val scope: CoroutineScope,
    private val load: ((DiffEditorData) -> Unit) -> Job,
    private val replace: (DiffEditorData) -> Unit,
) : Disposable {
    private val start = normalize(initial)
    private val disposed = AtomicBoolean(false)
    private val outdated = AtomicBoolean(false)
    private val refreshing = AtomicBoolean(false)
    private val tree = buildFileTree(start)
    private val badge = DiffStatBadge(0, 0, inset = UiStyle.Gap.pad())
    private val splitter = OnePixelSplitter(false, 0.25f)
    private val select = Debouncer<Int>(scope, parent) { show(it) }
    private val banner = EditorNotificationPanel(EditorNotificationPanel.Status.Warning).apply {
        text(KiloBundle.message("diff.editor.outdated"))
        createActionLabel(KiloBundle.message("diff.editor.refresh")) { refresh() }
        isVisible = false
    }
    private val root = JPanel(BorderLayout()).apply {
        add(banner, BorderLayout.NORTH)
        add(splitter, BorderLayout.CENTER)
    }
    private var files = start
    private var branch = branch
    private var syncing = false
    private var requested: String? = start.firstOrNull()?.file
    private var refreshJob: Job? = null
    private var processor = processor(start, selected(start.firstOrNull()?.file))
    private val openFileAction = object : DumbAwareAction(
        KiloBundle.message("diff.editor.openFile"),
        KiloBundle.message("diff.editor.openFile"),
        AllIcons.Actions.EditSource,
    ) {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT

        override fun update(e: AnActionEvent) {
            val file = selectedFile()
            e.presentation.isEnabled = file != null && fileStatus(file) != FileStatus.DELETED && path(file) != null
        }

        override fun actionPerformed(e: AnActionEvent) {
            val file = selectedFile() ?: return
            val path = path(file) ?: return
            scope.launch { service<KiloWorkspaceService>().openFile(path) }
        }
    }
    val component: JComponent = root

    init {
        Disposer.register(parent, this)
        Disposer.register(parent, processor)
        tree.addTreeSelectionListener {
            if (syncing) return@addTreeSelectionListener
            val file = selectedFile() ?: return@addTreeSelectionListener
            val index = files.indexOfFirst { it.file == file.file }
            if (index >= 0) select.request(index)
        }
        openFileAction.registerCustomShortcutSet(CommonShortcuts.getEditSource(), tree)
        installMenu()
        // Tie the listener to the processor it observes, not to the long-lived parent: applyFiles
        // disposes the old processor on each refresh, and registering under parent would leak a
        // removal hook (holding the dead processor) for every refresh across the editor's lifetime.
        processor.addListener(DiffRequestProcessorListener { syncTree() }, processor)
        splitter.firstComponent = buildTreePanel(tree, start, badge, processor.component, ::refresh)
        splitter.secondComponent = processor.component
        processor.updateRequest()
        applyBadge(start)
        select(start.firstOrNull()?.file)
        listen()
    }

    override fun dispose() {
        disposed.set(true)
        // Bind the refresh coroutine to this view's lifecycle (load already does so via `parent`): an
        // in-flight refresh started just before the editor closes would otherwise keep running on the
        // project scope, holding the `done` closure and through it this view, its tree, and processor.
        refreshJob?.cancel()
        refreshJob = null
    }

    @RequiresEdt
    fun applyFiles(next: List<DiffFileDto>, nextBranch: String? = branch) {
        val items = normalize(next)
        if (same(files, items) && branch == nextBranch) return
        val path = selectedFile()?.file ?: activePath() ?: files.firstOrNull()?.file
        val index = selected(path, items)
        val old = processor
        files = items
        branch = nextBranch
        requested = items.getOrNull(index)?.file
        tree.model = buildFileModel(items)
        expandAll(tree)
        processor = processor(items, index)
        Disposer.register(parent, processor)
        processor.addListener(DiffRequestProcessorListener { syncTree() }, processor)
        splitter.firstComponent = buildTreePanel(tree, items, badge, processor.component, ::refresh)
        splitter.secondComponent = processor.component
        processor.updateRequest()
        Disposer.dispose(old)
        applyBadge(items)
        select(items.getOrNull(index)?.file)
        root.revalidate()
        root.repaint()
    }

    @RequiresEdt
    internal fun refresh() {
        if (disposed.get() || project.isDisposed) return
        if (!refreshing.compareAndSet(false, true)) return
        saveDocuments()
        outdated.set(false)
        banner.isVisible = false
        root.revalidate()
        root.repaint()
        refreshJob?.cancel()
        refreshJob = load { data ->
            refreshing.set(false)
            if (!disposed.get() && !project.isDisposed) {
                if (data is DiffEditorData.Files) applyFiles(data.files, data.branch)
                if (data !is DiffEditorData.Files) replace(data)
            }
        }
    }

    internal fun markOutdated() {
        if (!outdated.compareAndSet(false, true)) return
        ApplicationManager.getApplication().invokeLater({ showOutdated() }, ModalityState.any()) {
            disposed.get() || project.isDisposed
        }
    }

    private fun show(index: Int) {
        if (disposed.get() || project.isDisposed || index !in files.indices) return
        val path = files[index].file
        if (activePath() == path) {
            requested = null
            return
        }
        requested = path
        processor.setCurrentRequest(index)
    }

    private fun installMenu() {
        val group = DefaultActionGroup(
            openFileAction,
            Separator.getInstance(),
            TreeAction(KiloBundle.message("diff.editor.refresh"), AllIcons.Actions.Refresh, ::refresh),
        )
        PopupHandler.installPopupMenu(tree, group, ActionPlaces.POPUP)
    }

    @RequiresEdt
    private fun showOutdated() {
        if (disposed.get() || project.isDisposed) return
        banner.isVisible = true
        root.revalidate()
        root.repaint()
    }

    private fun listen() {
        val dir = params["directory"] ?: return
        val root = clean(dir) ?: return
        EditorFactory.getInstance().eventMulticaster.addDocumentListener(
            object : DocumentListener {
                override fun documentChanged(event: DocumentEvent) {
                    val file = FileDocumentManager.getInstance().getFile(event.document) ?: return
                    if (inside(root, file.path)) markOutdated()
                }
            },
            parent,
        )
        VirtualFileManager.getInstance().addAsyncFileListenerBackgroundable(
            object : AsyncFileListener {
                override fun prepareChange(events: List<VFileEvent>): AsyncFileListener.ChangeApplier? {
                    if (outdated.get()) return null
                    if (events.none { inside(root, it.path) }) return null
                    return object : AsyncFileListener.ChangeApplier {
                        override fun afterVfsChange() {
                            markOutdated()
                        }
                    }
                }
            },
            parent,
        )
    }

    private fun saveDocuments() {
        val dir = params["directory"] ?: return
        val root = clean(dir) ?: return
        val manager = FileDocumentManager.getInstance()
        manager.saveDocuments { doc ->
            val file = manager.getFile(doc) ?: return@saveDocuments false
            inside(root, file.path)
        }
    }

    private fun processor(next: List<DiffFileDto>, index: Int): CacheDiffRequestChainProcessor {
        val producers = next.map { file -> producer(file) }
        val chain = SimpleDiffRequestChain.fromProducers(producers, index.coerceIn(0, (next.size - 1).coerceAtLeast(0)))
        return CacheDiffRequestChainProcessor(project, chain)
    }

    private fun producer(file: DiffFileDto): DiffRequestProducer = object : DiffRequestProducer {
        override fun getName(): String = file.file

        override fun process(context: UserDataHolder, indicator: ProgressIndicator) = diffRequest(project, file, branch, labels()).also {
            it.putUserData(DIFF_FILE_KEY, file.file)
        }
    }

    private fun labels(): Pair<String, String> {
        if (params["source"] == "branch") {
            return KiloBundle.message("diff.editor.side.base") to KiloBundle.message("diff.editor.side.current")
        }
        return KiloBundle.message("diff.editor.side.original") to KiloBundle.message("diff.editor.side.modified")
    }

    private fun syncTree() {
        if (disposed.get()) return
        val path = activePath() ?: return
        val target = reverseSyncTarget(path, requested, selectedFile()?.file)
        if (path == requested) requested = null
        if (target == null) return
        select(target)
    }

    private fun path(file: DiffFileDto): String? {
        if (fileStatus(file) == FileStatus.DELETED) return null
        val dir = params["directory"] ?: return null
        val root = clean(dir) ?: return null
        return try {
            val raw = Path.of(file.file)
            val path = (if (raw.isAbsolute) raw else root.resolve(raw)).normalize()
            // Constrain "open file" to the diff's directory: reject a server-supplied entry that
            // escapes via `..` or an absolute path outside the base rather than opening it blindly.
            if (!path.startsWith(root)) return null
            path.toString()
        } catch (_: InvalidPathException) {
            null
        }
    }

    private fun select(path: String?) {
        if (path == null) return
        syncing = true
        selectTreeNode(tree, path)
        syncing = false
    }

    private fun activePath(): String? = processor.activeRequest?.getUserData(DIFF_FILE_KEY)

    private fun selectedFile(): DiffFileDto? {
        val node = tree.lastSelectedPathComponent as? DefaultMutableTreeNode ?: return null
        return (node.userObject as? Node)?.file
    }

    private fun applyBadge(next: List<DiffFileDto>) {
        badge.update(next.sumOf { it.additions }, next.sumOf { it.deletions })
    }

    private fun selected(path: String?, next: List<DiffFileDto> = files): Int {
        val index = next.indexOfFirst { it.file == path }
        if (index >= 0) return index
        return 0
    }

    private fun same(a: List<DiffFileDto>, b: List<DiffFileDto>): Boolean = a == b

    private fun normalize(files: List<DiffFileDto>): List<DiffFileDto> = files.map { file -> file.copy(file = display(file.file)) }

    private fun display(file: String): String {
        val dir = params["directory"] ?: return file
        val root = clean(dir) ?: return file
        return try {
            val raw = Path.of(file)
            if (!raw.isAbsolute) return file
            val path = raw.normalize()
            if (!path.startsWith(root)) return file
            root.relativize(path).toString().replace('\\', '/')
        } catch (_: InvalidPathException) {
            file
        }
    }

    private fun clean(dir: String): Path? = try {
        Path.of(dir).normalize()
    } catch (_: InvalidPathException) {
        null
    }

    private fun inside(root: Path, raw: String): Boolean = try {
        val path = Path.of(raw).normalize()
        if (!path.startsWith(root)) return false
        val rel = root.relativize(path).toString().replace('\\', '/')
        if (rel == ".git/HEAD" || rel.startsWith(".git/refs/")) return true
        rel != ".git" && !rel.startsWith(".git/")
    } catch (_: InvalidPathException) {
        false
    }
}

internal fun reverseSyncTarget(active: String?, requested: String?, selected: String?): String? {
    if (active == null) return null
    if (requested != null) return null
    if (active == selected) return null
    return active
}

private class Debouncer<T>(
    private val scope: CoroutineScope,
    parent: Disposable,
    private val delay: Long = 300,
    private val action: suspend (T) -> Unit,
) {
    private var job: Job? = null

    init {
        Disposer.register(parent) { job?.cancel() }
    }

    fun request(value: T) {
        job?.cancel()
        job = scope.launch {
            delay(delay)
            withContext(Dispatchers.Main) { action(value) }
        }
    }
}

@RequiresEdt
internal fun emptyChangesComponent(): JComponent = JPanel(BorderLayout()).apply {
    add(com.intellij.ui.components.JBLabel(KiloBundle.message("diff.editor.empty")), BorderLayout.CENTER)
}

private fun buildFileTree(files: List<DiffFileDto>): Tree {
    val tree = DiffTree(buildFileModel(files)).apply {
        isRootVisible = false
        showsRootHandles = true
        isOpaque = true
        cellRenderer = Renderer()
    }
    TreeSpeedSearch(tree) { path ->
        val node = path.lastPathComponent as? DefaultMutableTreeNode
        (node?.userObject as? Node)?.name.orEmpty()
    }
    // A folder row hides its rolled-up badge while expanded, so its preferred width depends on
    // expansion state. JTree only invalidates cached path bounds on model changes, not on
    // expand/collapse, so a collapsed folder would keep its narrower expanded-state bounds and the
    // re-shown badge would squeeze the name until an unrelated re-measure. Invalidate the layout
    // cache on a user toggle so the row re-measures. invalidateCacheAndRepaint is UI-scoped (whole
    // tree), so [bulkToggle] suppresses this during expand/collapse-all and invalidates once at the
    // end — otherwise a bulk op would re-measure the whole tree per row. Registered after the initial
    // expandAll (already fully expanded, nothing to re-measure).
    expandAll(tree)
    tree.addTreeExpansionListener(object : TreeExpansionListener {
        override fun treeExpanded(event: TreeExpansionEvent) = onToggle()
        override fun treeCollapsed(event: TreeExpansionEvent) = onToggle()
        private fun onToggle() { if (!tree.bulk) TreeUtil.invalidateCacheAndRepaint(tree.ui) }
    })
    return tree
}

private fun buildFileModel(files: List<DiffFileDto>): DefaultTreeModel {
    val root = DefaultMutableTreeNode(Node("", "", true, null))
    for (file in files) addFile(root, file)
    compact(root)
    updateStats(root)
    return DefaultTreeModel(root)
}

// Collapse chains of single-child directories into one node (e.g. "pkg/ui/list") so the tree
// doesn't nest through directories that never branch, mirroring the IDE's compact directories.
private fun compact(node: DefaultMutableTreeNode) {
    val item = node.userObject as? Node
    if (item != null && item.file == null && item.path.isNotEmpty()) {
        while (node.childCount == 1) {
            val parent = node.userObject as? Node ?: break
            val child = node.getChildAt(0) as? DefaultMutableTreeNode ?: break
            val kid = child.userObject as? Node ?: break
            if (kid.file != null) break
            node.userObject = Node("${parent.name}/${kid.name}", kid.path, true, null)
            node.removeAllChildren()
            while (child.childCount > 0) node.add(child.getChildAt(0) as DefaultMutableTreeNode)
        }
    }
    for (i in 0 until node.childCount) {
        compact(node.getChildAt(i) as? DefaultMutableTreeNode ?: continue)
    }
}

private fun buildTreePanel(tree: Tree, files: List<DiffFileDto>, badge: DiffStatBadge, target: JComponent, refresh: () -> Unit): JComponent {
    val toolbar = ActionManager.getInstance().createActionToolbar(
        ActionPlaces.TOOLBAR,
        treeToolbarGroup(tree, refresh),
        true,
    )
    toolbar.targetComponent = target
    toolbar.component.background = JBUI.CurrentTheme.ToolWindow.background()
    toolbar.updateActionsImmediately()
    val row = object : JPanel(BorderLayout()) {
        override fun getBackground(): Color = JBUI.CurrentTheme.ToolWindow.background()
    }.apply {
        border = IdeBorderFactory.createBorder(SideBorder.BOTTOM)
        add(toolbar.component, BorderLayout.WEST)
        badge.update(files.sumOf { it.additions }, files.sumOf { it.deletions })
        add(
            Stack.horizontal(gap = UiStyle.Gap.sm()).apply {
                border = JBUI.Borders.empty(0, 0, 0, UiStyle.Gap.pad())
                next(JBLabel(fileCount(files.size)).apply { foreground = UiStyle.Colors.weak() })
                next(badge)
            },
            BorderLayout.EAST,
        )
    }
    return object : JPanel(BorderLayout()) {
        override fun getBackground(): Color = JBUI.CurrentTheme.ToolWindow.background()
    }.apply {
        add(row, BorderLayout.NORTH)
        add(
            JBScrollPane(tree).apply {
                border = JBUI.Borders.empty()
                viewportBorder = JBUI.Borders.empty()
                horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED
            },
            BorderLayout.CENTER,
        )
    }
}

internal fun treeToolbarGroup(tree: Tree, refresh: () -> Unit) = DefaultActionGroup(
    TreeAction(KiloBundle.message("diff.editor.refresh"), AllIcons.Actions.Refresh, refresh),
    Separator.getInstance(),
    TreeAction(KiloBundle.message("diff.editor.tree.expandAll"), AllIcons.Actions.Expandall) { expandAll(tree) },
    TreeAction(KiloBundle.message("diff.editor.tree.collapseAll"), AllIcons.Actions.Collapseall) { collapseAll(tree) },
)

private fun fileCount(count: Int): String = KiloBundle.message(
    if (count == 1) "session.changes.count.one" else "session.changes.count.other",
    count,
)

private fun expandAll(tree: Tree) = bulkToggle(tree) {
    var i = 0
    while (i < tree.rowCount) {
        tree.expandRow(i)
        i += 1
    }
}

private fun collapseAll(tree: Tree) = bulkToggle(tree) {
    for (i in tree.rowCount - 1 downTo 0) tree.collapseRow(i)
}

/**
 * Run a bulk expand/collapse without firing the per-row layout-cache invalidation. Each toggle would
 * otherwise invalidate the whole tree (invalidateCacheAndRepaint is UI-scoped), making a bulk op
 * O(rows^2) to re-measure. Suppress the toggle listener for the loop and invalidate once at the end.
 */
private fun bulkToggle(tree: Tree, action: () -> Unit) {
    val diff = tree as? DiffTree
    diff?.bulk = true
    try {
        action()
    } finally {
        diff?.bulk = false
    }
    TreeUtil.invalidateCacheAndRepaint(tree.ui)
}

private fun addFile(root: DefaultMutableTreeNode, file: DiffFileDto) {
    var node = root
    val parts = file.file.split('/').filter { it.isNotBlank() }
    for ((index, part) in parts.withIndex()) {
        val path = parts.take(index + 1).joinToString("/")
        val leaf = index == parts.lastIndex
        val child = child(node, path) ?: DefaultMutableTreeNode(Node(part, path, !leaf, if (leaf) file else null)).also(node::add)
        node = child
    }
}

private fun updateStats(node: DefaultMutableTreeNode): Stats {
    val item = node.userObject as? Node ?: return Stats(0, 0)
    if (item.file != null) return Stats(item.additions, item.deletions)
    val stats = (0 until node.childCount)
        .map { updateStats(node.getChildAt(it) as? DefaultMutableTreeNode ?: return@map Stats(0, 0)) }
        .fold(Stats(0, 0)) { acc, child -> Stats(acc.additions + child.additions, acc.deletions + child.deletions) }
    item.additions = stats.additions
    item.deletions = stats.deletions
    return stats
}

private fun child(node: DefaultMutableTreeNode, path: String): DefaultMutableTreeNode? {
    for (i in 0 until node.childCount) {
        val child = node.getChildAt(i) as? DefaultMutableTreeNode ?: continue
        if ((child.userObject as? Node)?.path == path) return child
    }
    return null
}

private fun selectTreeNode(tree: Tree, path: String) {
    val node = find(tree.model.root as? DefaultMutableTreeNode ?: return, path) ?: return
    val selection = TreePath(node.path)
    tree.selectionPath = selection
    tree.scrollPathToVisible(selection)
}

private fun find(node: DefaultMutableTreeNode, path: String): DefaultMutableTreeNode? {
    if ((node.userObject as? Node)?.path == path) return node
    for (i in 0 until node.childCount) {
        val found = find(node.getChildAt(i) as? DefaultMutableTreeNode ?: continue, path)
        if (found != null) return found
    }
    return null
}

private data class Stats(val additions: Int, val deletions: Int)

private class Node(val name: String, val path: String, val dir: Boolean, val file: DiffFileDto?) {
    var additions: Int = file?.additions ?: 0
    var deletions: Int = file?.deletions ?: 0
}

private class DiffTree(model: TreeModel) : Tree(model) {
    /** Set while a bulk expand/collapse runs so the toggle listener skips its per-row invalidation. */
    var bulk = false

    override fun getBackground(): Color = JBUI.CurrentTheme.ToolWindow.background()

    override fun getScrollableTracksViewportHeight(): Boolean {
        val view = parent as? JViewport ?: return super.getScrollableTracksViewportHeight()
        return preferredSize.height < view.height || super.getScrollableTracksViewportHeight()
    }
}

private class Renderer : JPanel(BorderLayout()), TreeCellRenderer {
    private val text = SimpleColoredComponent()
    private val badge = DiffStatBadge(0, 0, DiffStatBadge.Variant.COMPACT)

    init {
        UiStyle.Components.transparent(this, text)
        border = JBUI.Borders.empty(0, UiStyle.Gap.sm(), 0, UiStyle.Gap.xl())
        add(text, BorderLayout.CENTER)
        add(badge, BorderLayout.EAST)
    }

    override fun getTreeCellRendererComponent(
        tree: JTree,
        value: Any?,
        selected: Boolean,
        expanded: Boolean,
        leaf: Boolean,
        row: Int,
        hasFocus: Boolean,
    ): Component {
        val node = value as? DefaultMutableTreeNode
        val item = node?.userObject as? Node
        text.clear()
        text.icon = if (item?.dir == true) AllIcons.Nodes.Folder else AllIcons.FileTypes.Text
        val name = item?.name?.ifBlank { item.path }.orEmpty()
        val color = item?.file?.let(::fileStatus)?.color
        if (color == null) text.append(name) else text.append(name, SimpleTextAttributes(SimpleTextAttributes.STYLE_PLAIN, color))
        // A folder's badge rolls up its descendants' stats, which is only meaningful while the
        // folder is collapsed. Once expanded the child rows carry their own badges, so hide the
        // folder aggregate to avoid duplicating the numbers. Leaf files always show their badge.
        val show = item != null && (item.additions != 0 || item.deletions != 0) && !(item.dir && expanded)
        badge.isVisible = show
        if (show) badge.update(item.additions, item.deletions)
        return this
    }
}

private class TreeAction(
    text: String,
    icon: Icon,
    private val action: () -> Unit,
) : DumbAwareAction(text, text, icon) {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun actionPerformed(e: AnActionEvent) = action()
}

private val TreeNode.path: Array<TreeNode>
    get() {
        val list = mutableListOf<TreeNode>()
        var node: TreeNode? = this
        while (node != null) {
            list += node
            node = node.parent
        }
        return list.asReversed().toTypedArray()
    }
