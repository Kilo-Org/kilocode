package ai.kilocode.client.ui.tree

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.active.ACTIVE_MENU_CELL
import ai.kilocode.client.ui.active.ActiveConfig
import ai.kilocode.client.ui.active.ActiveDeleteOptions
import ai.kilocode.client.ui.active.ActiveEditOptions
import ai.kilocode.client.ui.active.ActiveHit
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveMenu
import ai.kilocode.client.ui.active.ActiveMove
import ai.kilocode.client.ui.active.ActiveRenderState
import ai.kilocode.client.ui.active.ActiveRenderer
import ai.kilocode.client.ui.active.ActiveReorder
import ai.kilocode.client.ui.active.ActiveRowHeight
import ai.kilocode.client.ui.active.ActiveSelection
import ai.kilocode.client.ui.active.ActiveSurface
import ai.kilocode.client.ui.active.activeHitCells
import ai.kilocode.client.ui.active.activeAnimated
import com.intellij.ui.AnimatedIcon
import ai.kilocode.client.ui.active.activeInvalidate
import ai.kilocode.client.ui.active.activeLayout
import ai.kilocode.client.ui.active.activeUpdateUI
import ai.kilocode.client.ui.active.activeToolWindowBackground
import ai.kilocode.client.ui.active.activeVisibleCells
import ai.kilocode.client.ui.active.showActiveDeletePopup
import ai.kilocode.client.ui.active.showActiveEditPopup
import com.intellij.ide.dnd.DnDDragStartBean
import com.intellij.ide.dnd.DnDImage
import com.intellij.ide.dnd.DnDSupport
import com.intellij.ide.dnd.SmoothAutoScroller
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.JBPopupListener
import com.intellij.openapi.ui.popup.LightweightWindowEvent
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.hover.TreeHoverListener
import com.intellij.ui.render.RenderingHelper
import com.intellij.ui.render.RenderingUtil
import com.intellij.ui.tree.ui.CustomBoundsTreeUI
import com.intellij.ui.treeStructure.Tree
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import com.intellij.util.ui.tree.TreeUtil
import java.awt.Color
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Image
import java.awt.Point
import java.awt.Rectangle
import java.awt.event.InputEvent
import java.awt.event.KeyEvent
import java.awt.event.MouseEvent
import java.awt.event.MouseMotionAdapter
import javax.swing.JComponent
import javax.swing.JViewport
import javax.swing.KeyStroke
import javax.swing.ScrollPaneConstants
import javax.swing.SwingUtilities
import javax.swing.ToolTipManager
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeModel
import javax.swing.tree.TreePath
import javax.swing.tree.TreeSelectionModel

/** One row in an [ActiveTree]. `children == null` is a leaf; a list is a branch, possibly empty. */
internal data class ActiveTreeNode(
    val item: ActiveItem,
    val children: List<ActiveTreeNode>? = null,
) {
    val branch: Boolean get() = children != null
}

internal class ActiveEntry(
    val key: String,
    var item: ActiveItem,
    branch: Boolean,
) : DefaultMutableTreeNode(null, branch) {
    init {
        // The tree renderer receives the node's user object; keep the entry itself so it can resolve
        // hierarchy state (branch/leaf) as well as the row payload.
        userObject = this
    }

    override fun toString(): String = item.title
}

/**
 * A grouped, collapsible sibling of [ai.kilocode.client.ui.list.ActiveList]. It renders the same
 * [ActiveRenderer] body, action pills, badges, metrics and menus; only the container behavior
 * (hierarchy, native selection and disclosure) is tree-specific.
 *
 * Rows fill the native tree's available width after the indent/disclosure gutter.
 */
// The container intentionally exposes the same row/popup operations as ActiveList to its clients.
@Suppress("TooManyFunctions")
internal class ActiveTree(
    emptyText: String,
    cfg: ActiveConfig = ActiveConfig.Equal,
    private val surface: ActiveSurface = ActiveSurface.Default,
    actions: ActiveTreeActions = ActiveTreeActions(),
    menu: ActiveMenu<*>? = null,
    reorder: ActiveReorder? = null,
) : BorderLayoutPanel() {
    private val view = ActiveTreeView(
        emptyText, cfg, surface, actions, menu, reorder,
    )
    private val scroll = object : JBScrollPane(view) {
        override fun getBackground(): Color {
            if (surface == ActiveSurface.ToolWindow) return activeToolWindowBackground()
            return super.getBackground() ?: UIUtil.getPanelBackground()
        }
    }.apply {
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        viewportBorder = JBUI.Borders.empty()
        if (surface == ActiveSurface.ToolWindow) viewport.background = activeToolWindowBackground()
    }

    /** Called when the tree scrolls or a row changes position under an anchored popup. */
    var onScroll: (() -> Unit)? = null

    init {
        view.onSelect = actions.select
        view.onGeometry = { onScroll?.invoke() }
        scroll.verticalScrollBar.addAdjustmentListener { view.geometry() }
        if (surface == ActiveSurface.ToolWindow) isOpaque = true
        scroll.border = JBUI.Borders.empty()
        addToCenter(scroll)
    }

    override fun getBackground(): Color {
        if (surface == ActiveSurface.ToolWindow) return activeToolWindowBackground()
        return super.getBackground() ?: UIUtil.getPanelBackground()
    }

    @RequiresEdt
    fun update(nodes: List<ActiveTreeNode>, selection: ActiveSelection = ActiveSelection.Preserve) {
        view.update(nodes, selection)
    }

    @RequiresEdt
    fun select(key: String, scroll: Boolean = true): Boolean = view.select(key, scroll)

    @RequiresEdt
    fun selected(): ActiveItem? = view.selected()

    @RequiresEdt
    fun selectedKeys(): List<String> = view.selectedKeys()

    @RequiresEdt
    fun clearSelection() = view.clearSelection()

    @RequiresEdt
    fun focus() = view.focusTree()

    @RequiresEdt
    fun point(key: String, cell: String? = null, leading: Boolean = false): RelativePoint? =
        view.point(key, cell, leading)

    @RequiresEdt
    fun hoveredBounds(pane: JComponent): Rectangle? = view.hoveredBounds(pane)

    @RequiresEdt
    fun visibleBounds(pane: JComponent): Rectangle? = view.visibleBounds(pane)

    @RequiresEdt
    fun preferredFocus(): JComponent = view

    @RequiresEdt
    fun preferredHeight(width: Int): Int = view.preferredHeight(width)

    @RequiresEdt
    fun trackBalloon(balloon: Balloon) = view.trackBalloon(balloon)

    @RequiresEdt
    fun confirmDelete(anchor: RelativePoint, opts: ActiveDeleteOptions, confirm: (Boolean) -> Unit) {
        trackBalloon(showActiveDeletePopup(anchor, opts, confirm))
    }

    @RequiresEdt
    fun editName(anchor: RelativePoint, opts: ActiveEditOptions, commit: (String) -> Unit) {
        trackBalloon(showActiveEditPopup(anchor, opts, commit))
    }

    @RequiresEdt
    fun rename(
        key: String,
        cell: String? = null,
        current: (String) -> String?,
        commit: (String, String) -> Unit,
    ) {
        if (select(key)) current(key)?.let { value ->
            point(key, cell)?.let { anchor ->
                editName(anchor, ActiveEditOptions(value)) { name -> commit(key, name) }
            }
        }
    }

    @RequiresEdt
    fun renameSelected(current: (String) -> String?, commit: (String, String) -> Unit): Boolean {
        for (key in selectedKeys()) {
            if (current(key) == null) continue
            rename(key, null, current, commit)
            return true
        }
        return false
    }

    @RequiresEdt
    fun installPopup(group: ActionGroup) = view.installPopup(group)

    @RequiresEdt
    fun setListCursor(cursor: Cursor) = view.setBaseCursor(cursor)

    @RequiresEdt
    fun setBusy(value: Boolean) = view.setBusy(value)

    @RequiresEdt
    fun setLocked(value: Boolean) = view.setLocked(value)
}

// Swing overrides and container operations remain on the EDT adapter; stateful algorithms live in delegates.
@Suppress("TooManyFunctions")
internal class ActiveTreeView(
    empty: String,
    private val cfg: ActiveConfig,
    private val surface: ActiveSurface,
    private val actions: ActiveTreeActions,
    private val menu: ActiveMenu<*>?,
    private val reorder: ActiveReorder?,
) : Tree() {
    internal val hierarchy = ActiveTreeModel()
    private val root get() = hierarchy.root
    private val treeModel get() = hierarchy.model
    private val renderer = ActiveTreeRenderer(cfg, menu, this)
    internal val regions = ActiveTreeGeometry(this, renderer)
    private val ordering = ActiveTreeReorder(this, reorder)
    private val pointer = ActiveTreePointer(this, actions)
    private val entries get() = hierarchy.entries
    private val expandedOnce = HashSet<String>()
    private var hoveredKey: String? = null
    private var anchorKey: String? = null
    private var pending: String? = null
    private var pendingScroll = true
    private var revision = 0
    private var popups = 0
    private var popupProperty: Any? = null
    private var restoring = false
    private var baseCursor: Cursor = Cursor.getDefaultCursor()
    private var externalGroup: ActionGroup? = null
    private var installed = false
    private var wired = false
    private val snapshot get() = hierarchy.snapshot
    private var height: Int? = null
    internal var onSelect: (() -> Unit)? = null
    internal var onGeometry: (() -> Unit)? = null

    private val hover = object : TreeHoverListener() {
        override fun onHover(tree: javax.swing.JTree, row: Int) {
            val key = if (row < 0) null else entryAt(row)?.key
            setHovered(key)
            syncCursor()
        }
    }

    init {
        require(!cfg.wrapDescription) { "ActiveTree does not support wrapped descriptions" }
        emptyText.text = empty
        isRootVisible = false
        showsRootHandles = true
        setRowHeight(0)
        toggleClickCount = 2
        expandsSelectedPaths = false
        setExpandableItemsEnabled(false)
        selectionModel.selectionMode = TreeSelectionModel.SINGLE_TREE_SELECTION
        putClientProperty(RenderingHelper.SHRINK_LONG_RENDERER, true)
        putClientProperty(RenderingHelper.SHRINK_LONG_SELECTION, true)
        setModel(treeModel)
        setCellRenderer(renderer)
        if (surface == ActiveSurface.ToolWindow) isOpaque = true
        addTreeSelectionListener {
            if (restoring) return@addTreeSelectionListener
            pending = null
            anchorKey = selectedEntry()?.key
            onSelect?.invoke()
        }
        addTreeExpansionListener(object : javax.swing.event.TreeExpansionListener {
            override fun treeExpanded(event: javax.swing.event.TreeExpansionEvent) = changed()
            override fun treeCollapsed(event: javax.swing.event.TreeExpansionEvent) {
                cancelDrag()
                changed()
            }
            private fun changed() {
                setHovered(null)
                if (!restoring) onGeometry?.invoke()
            }
        })
        addFocusListener(object : java.awt.event.FocusAdapter() {
            override fun focusGained(event: java.awt.event.FocusEvent) = repaint()
            override fun focusLost(event: java.awt.event.FocusEvent) = repaint()
        })
        addComponentListener(object : java.awt.event.ComponentAdapter() {
            override fun componentResized(event: java.awt.event.ComponentEvent) = geometry()
        })
        registerKeyboardAction(
            { selectedEntry()?.takeUnless { it.allowsChildren }?.let { open(it.item, enter()) } },
            KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
        if (actions.open != null) {
            registerKeyboardAction(
                { source() },
                KeyStroke.getKeyStroke(KeyEvent.VK_F4, 0),
                JComponent.WHEN_FOCUSED,
            )
        }
        registerKeyboardAction(
            { showSelectedMenu() },
            KeyStroke.getKeyStroke(KeyEvent.VK_F10, InputEvent.SHIFT_DOWN_MASK),
            JComponent.WHEN_FOCUSED,
        )
        addMouseMotionListener(object : MouseMotionAdapter() {
            override fun mouseMoved(e: MouseEvent) { cursor = cursorAt(e.point) }
            override fun mouseDragged(e: MouseEvent) { cursor = cursorAt(e.point) }
        })
        ToolTipManager.sharedInstance().registerComponent(this)
        installReorder()
        wired = true
    }

    override fun addNotify() {
        super.addNotify()
        putClientProperty(AnimatedIcon.REFRESH_DELEGATE, Runnable {
            for (row in 0 until rowCount) {
                val entry = entryAt(row) ?: continue
                if (activeAnimated(entry.item) && getRowBounds(row)?.intersects(visibleRect) == true) {
                    repaintEntry(entry)
                }
            }
        })
        if (installed) return
        installed = true
        TreeHoverListener.DEFAULT.addTo(this)
        hover.addTo(this)
    }

    override fun removeNotify() {
        putClientProperty(AnimatedIcon.REFRESH_DELEGATE, null)
        setHovered(null)
        cancelDrag()
        if (installed) {
            installed = false
            TreeHoverListener.DEFAULT.removeFrom(this)
            hover.removeFrom(this)
        }
        super.removeNotify()
    }

    override fun updateUI() {
        super.updateUI()
        if (!wired) return
        setRowHeight(0)
        activeUpdateUI(renderer.active)
        measure()
        geometry()
        TreeUtil.invalidateCacheAndRepaint(ui as? javax.swing.plaf.TreeUI)
        revalidate()
        repaint()
    }

    override fun getBackground(): Color {
        if (surface == ActiveSurface.ToolWindow) return activeToolWindowBackground()
        return super.getBackground() ?: UIUtil.getPanelBackground()
    }

    override fun getToolTipText(event: MouseEvent): String? {
        return super.getToolTipText(event) ?: entryAtLocation(event.point)?.let { entry ->
            val hit = hits(entry).firstOrNull { it.bounds.contains(event.point) }
            if (hit != null) hit.tooltip?.takeIf { it.isNotBlank() }
            else entry.item.tooltip?.takeIf { cfg.description && cfg.tooltip && it.isNotBlank() }
                ?.let { UiStyle.Text.tipLines(it.lines()) }
        }
    }

    @RequiresEdt
    fun update(nodes: List<ActiveTreeNode>, selection: ActiveSelection) {
        checkEdt()
        val keys = hierarchy.keys(nodes)
        require(keys.size == keys.toSet().size) { "ActiveTree keys must be unique" }
        if (nodes == snapshot && selection == ActiveSelection.Preserve && pending == null) return
        revision++
        setHovered(null)
        val expanded = expandedKeys()
        val selected = selectedKeys()
        val parent = (selectedEntry()?.parent as? ActiveEntry)?.key
        val neighbors = selectedEntry()?.let { node ->
            val parent = node.parent ?: return@let emptyList()
            val siblings = (0 until parent.childCount).map { parent.getChildAt(it) as ActiveEntry }
            val index = siblings.indexOf(node)
            siblings.drop(index + 1).map { it.key } + siblings.take(index).asReversed().map { it.key }
        }.orEmpty()
        val viewport = viewportPosition()
        restoring = true
        val expands = expandsSelectedPaths
        val scrolls = scrollsOnExpand
        expandsSelectedPaths = false
        scrollsOnExpand = false
        try {
            hierarchy.update(nodes)
            ordering.refresh()
            measure()
            expanded.forEach { key ->
                entries[key]?.takeIf { it.allowsChildren }?.let { expandPath(TreePath(it.path)) }
            }
            entries.values.filter { it.allowsChildren && expandedOnce.add(it.key) }.forEach {
                expandPath(TreePath(it.path))
            }
            restore(selection, selected, viewport, neighbors, parent)
        } finally {
            expandsSelectedPaths = expands
            scrollsOnExpand = scrolls
            restoring = false
        }
        TreeUtil.invalidateCacheAndRepaint(ui as? javax.swing.plaf.TreeUI)
        for (row in 0 until rowCount) getRowBounds(row)
        onGeometry?.invoke()
        repaint()
    }

    private fun restore(
        selection: ActiveSelection, previous: List<String>, viewport: Point?, neighbors: List<String>, parent: String?,
    ) {
        if (selection is ActiveSelection.Key) {
            select(selection.key, true)
            return
        }
        pending?.let { key ->
            val entry = entries[key] ?: return@let
            pending = null
            reveal(entry, scroll = pendingScroll)
            return
        }
        val target = when (selection) {
            is ActiveSelection.Key -> entries[selection.key]
            ActiveSelection.Preserve -> previous.firstNotNullOfOrNull { entries[it] }
            ActiveSelection.Slide -> (previous + neighbors).firstNotNullOfOrNull { entries[it] }
        }
        if (target != null) {
            val path = TreePath(target.path)
            if (selectionPath != path) selectionModel.selectionPath = path
            anchorKey = target.key
        } else if (previous.isEmpty()) {
            selectionModel.clearSelection()
            anchorKey = null
        } else {
            // Keep a surviving preference alive across an intermediate empty refresh (for example a
            // controller replaceAll that briefly publishes no rows); the next update restores it.
            val empty = entries.values.all { it.allowsChildren } ||
                parent?.let { entries[it]?.childCount == 0 } == true
            pending = if (empty) previous.firstOrNull() else null
            selectionModel.clearSelection()
            anchorKey = null
        }
        if (viewport != null) {
            val stamp = revision
            SwingUtilities.invokeLater { if (stamp == revision) setViewport(viewport) }
        }
    }


    private fun measure() {
        height = null
        if (cfg.height != ActiveRowHeight.EQUAL) return
        height = entries.values.filter { !it.allowsChildren }.maxOfOrNull {
            renderer.preferredHeight(state(it, false, false).copy(actionsVisible = false, menuVisible = false), width)
        }
    }


    private fun expandedKeys(): Set<String> =
        entries.values.filter { it.allowsChildren && isExpanded(TreePath(it.path)) }.map { it.key }.toSet()

    private fun viewportPosition(): Point? = (parent as? JViewport)?.viewPosition

    private fun setViewport(point: Point) {
        val port = parent as? JViewport ?: return
        port.viewPosition = point
    }

    @RequiresEdt
    fun select(key: String, scroll: Boolean = true): Boolean {
        checkEdt()
        revision++
        val entry = entries[key] ?: run {
            pending = key
            pendingScroll = scroll
            return false
        }
        pending = null
        anchorKey = key
        reveal(entry, scroll)
        return true
    }

    private fun reveal(entry: ActiveEntry, scroll: Boolean) {
        revision++
        val port = parent as? JViewport
        val viewport = port?.viewPosition
        val expands = expandsSelectedPaths
        val scrolls = scrollsOnExpand
        expandsSelectedPaths = false
        scrollsOnExpand = false
        try {
            var path: TreePath? = TreePath(entry.path)
            while (path != null && path.pathCount > 1) {
                path = path.parentPath
                if (path != null) expandPath(path)
            }
            selectionModel.selectionPath = TreePath(entry.path)
        } finally {
            expandsSelectedPaths = expands
            scrollsOnExpand = scrolls
        }
        if (scroll) scrollPathToVisible(TreePath(entry.path))
        if (!scroll && viewport != null) {
            val stamp = revision
            SwingUtilities.invokeLater { if (stamp == revision) port.viewPosition = viewport }
        }
        anchorKey = entry.key
    }

    @RequiresEdt
    fun selected(): ActiveItem? {
        checkEdt()
        return selectedEntry()?.item
    }

    @RequiresEdt
    fun selectedKeys(): List<String> {
        checkEdt()
        return selectionPaths?.mapNotNull { entry(it)?.key }.orEmpty()
    }

    @RequiresEdt
    override fun clearSelection() {
        checkEdt()
        pending = null
        anchorKey = null
        selectionModel.clearSelection()
    }

    @RequiresEdt
    fun focusTree() {
        checkEdt()
        requestFocusInWindow()
        repaint()
    }

    @RequiresEdt
    fun point(key: String, cell: String?, leading: Boolean): RelativePoint? {
        checkEdt()
        return entries[key]?.let { entry -> paintedBounds(entry)?.let { bounds ->
            val target = cell?.let { id -> hits(entry).firstOrNull { it.id == id }?.bounds } ?: bounds
            val x = if (leading) target.x else target.x + target.width / 2
            RelativePoint(this, Point(x.coerceIn(bounds.x, bounds.x + bounds.width), target.y + target.height))
        } }
    }

    @RequiresEdt
    fun hoveredBounds(pane: JComponent): Rectangle? {
        checkEdt()
        return hoveredKey?.let { entries[it] }?.let(::paintedBounds)
            ?.let { SwingUtilities.convertRectangle(this, it, pane) }
    }

    @RequiresEdt
    fun visibleBounds(pane: JComponent): Rectangle? {
        checkEdt()
        val visible = visibleRect.takeIf { !it.isEmpty } ?: return null
        return SwingUtilities.convertRectangle(this, visible, pane)
    }

    @RequiresEdt
    fun preferredHeight(width: Int): Int {
        checkEdt()
        require(width > 0) { "ActiveTree measurement requires a positive width" }
        var total = insets.top + insets.bottom
        for (row in 0 until rowCount) total += getRowBounds(row).height
        return total
    }

    @RequiresEdt
    fun trackBalloon(balloon: Balloon) = trackPopupState(true) { balloon.addListener(it) }

    @RequiresEdt
    fun installPopup(group: ActionGroup) {
        externalGroup = group
    }

    @RequiresEdt
    fun setBaseCursor(cursor: Cursor) {
        baseCursor = cursor
        syncCursor()
    }

    @RequiresEdt
    fun setBusy(value: Boolean) {
        checkEdt()
        setPaintBusy(value)
        setLocked(value)
    }

    @RequiresEdt
    fun setLocked(value: Boolean) {
        checkEdt()
        if (value) {
            setHovered(null)
            cancelDrag()
            pointer.clear()
        }
        isEnabled = !value
    }

    override fun processMouseEvent(e: MouseEvent) {
        if (!isEnabled) return
        if (pointer.process(e)) {
            e.consume()
        } else if (java.awt.GraphicsEnvironment.isHeadless()) {
            pointer.headless(e)
            e.consume()
        } else super.processMouseEvent(e)
    }

    internal fun placeholder(entry: ActiveEntry): Boolean = ordering.placeholder(entry)

    private fun syncCursor() {
        val point = if (isShowing) {
            mousePosition ?: Point(0, 0)
        } else {
            Point(0, 0)
        }
        val cursor = cursorAt(point)
        if (this.cursor.type != cursor.type) this.cursor = cursor
    }

    private fun cursorAt(point: Point): Cursor {
        return entryAtLocation(point)?.let { hits(it).firstOrNull { hit -> hit.enabled && hit.bounds.contains(point) } }
            ?.let { Cursor.getPredefinedCursor(it.cursor) } ?: baseCursor
    }

    private fun entryAt(row: Int): ActiveEntry? {
        if (row < 0 || row >= rowCount) return null
        return entry(getPathForRow(row))
    }

    private fun entry(path: TreePath?): ActiveEntry? = path?.lastPathComponent as? ActiveEntry

    private fun selectedEntry(): ActiveEntry? = entry(selectionPath)

    private fun entryAtLocation(point: Point): ActiveEntry? = regions.entry(point)

    internal fun bounds(entry: ActiveEntry): Rectangle? = paintedBounds(entry)

    private fun paintedBounds(entry: ActiveEntry): Rectangle? = regions.bounds(entry)

    internal fun state(
        entry: ActiveEntry, selected: Boolean, focused: Boolean, width: Int = this.width,
    ): ActiveRenderState {
        val active = selected && (focused || popups > 0)
        val enabled = isEnabled && !entry.item.disabled
        val hovered = hoveredKey == entry.key
        val fg = UIUtil.getTreeForeground(active, active || focused)
        val background = background
        val selection = UIUtil.getTreeBackground(true, focused || popups > 0)
        val actions = actionsVisible(enabled, selected, hovered, active)
        return ActiveRenderState(
            item = entry.item,
            selected = selected,
            focused = focused,
            active = active,
            hovered = hovered,
            enabled = enabled,
            background = background,
            selectionColor = selection,
            paintSelection = false,
            backdrop = if (selected) selection else background,
            foreground = fg,
            pillBackground = if (selected) selection else background,
            width = width,
            actionsVisible = actions && ui is CustomBoundsTreeUI,
            menuVisible = menuVisible(entry, enabled, hovered),
            opaque = false,
            bodyHeight = if (entry.allowsChildren) null else height,
            interactive = ui is CustomBoundsTreeUI,
        )
    }

    private fun actionsVisible(enabled: Boolean, selected: Boolean, hovered: Boolean, active: Boolean): Boolean =
        enabled && when {
            cfg.hoverActions -> selected && hovered
            cfg.keepActions -> selected
            else -> active
        }

    private fun menuVisible(entry: ActiveEntry, enabled: Boolean, hovered: Boolean): Boolean =
        enabled && hovered && menu?.available(entry.item) == true && ui is CustomBoundsTreeUI

    private fun setHovered(key: String?) {
        if (key == null) TreeHoverListener.DEFAULT.mouseExited(this)
        if (hoveredKey == key) return
        val old = hoveredKey?.let { entries[it] }
        hoveredKey = key
        old?.let { repaintEntry(it) }
        key?.let { entries[it] }?.let { repaintEntry(it) }
        actions.hover?.invoke(key?.let { entries[it]?.item })
    }

    private fun repaintEntry(entry: ActiveEntry) {
        val row = getRowForPath(TreePath(entry.path))
        if (row >= 0) getRowBounds(row)?.let { repaint(0, it.y, width, it.height) }
    }

    private fun hits(entry: ActiveEntry): List<ActiveHit> = regions.hits(entry)


    internal fun fire(item: ActiveItem, id: String) {
        ai.kilocode.client.ui.active.activeDispatch(item, id, actions.cell)
    }

    internal fun open(item: ActiveItem, focus: Boolean) {
        if (item.progress != null) return
        val action = actions.open
        if (action != null) {
            action(item, focus)
            return
        }
        primary(item)
    }

    private fun source() {
        selectedEntry()?.takeIf { !it.allowsChildren && it.item.progress == null }
            ?.let { actions.open?.invoke(it.item, true) }
    }

    private fun enter(): Boolean = com.intellij.openapi.options.advanced.AdvancedSettings.getBoolean(
        "edit.source.on.enter.key.request.focus.in.editor",
    )

    private fun primary(item: ActiveItem) {
        if (item.progress != null) return
        val cells = activeVisibleCells(item, true)
        val cell = cells.firstOrNull { it.enabled && it.primary }
        if (cell != null) {
            fire(item, cell.id)
            return
        }
        actions.activate?.invoke(item) ?: actions.click?.invoke(item)
    }

    internal fun showMenu(point: Point, context: Boolean = false): Boolean {
        return entryAtLocation(point)?.takeIf(::menuEligible)?.let { entry ->
            val target = if (context) paintedBounds(entry) else hits(entry)
                .firstOrNull { it.id == ACTIVE_MENU_CELL && it.bounds.contains(point) }?.bounds
            target?.let {
                selectionModel.selectionPath = TreePath(entry.path)
                val anchor = if (context) point else Point(it.x + it.width / 2, it.y + it.height)
                popup(entry)?.let { popup -> popup.show(RelativePoint(this, anchor)); true }
            }
        } ?: false
    }

    private fun showSelectedMenu() {
        selectedEntry()?.takeIf { !it.allowsChildren && menuEligible(it) }?.let { entry ->
            point(entry.key, null, false)?.let { anchor -> popup(entry)?.show(anchor) }
        }
    }

    private fun menuEligible(entry: ActiveEntry): Boolean =
        menu?.available(entry.item) ?: !entry.allowsChildren

    private fun popup(entry: ActiveEntry): JBPopup? {
        val group = menu?.group ?: externalGroup ?: return null
        val popup = JBPopupFactory.getInstance().createActionGroupPopup(
            null,
            group,
            menu?.context(this, entry.item) ?: com.intellij.ide.DataManager.getInstance().getDataContext(this),
            JBPopupFactory.ActionSelectionAid.SPEEDSEARCH,
            true,
            ActionPlaces.POPUP,
        )
        trackPopup(popup)
        return popup
    }

    private fun trackPopup(popup: JBPopup) {
        trackPopupState(popup.isVisible) { popup.addListener(it) }
    }

    private fun trackPopupState(visible: Boolean, add: (JBPopupListener) -> Unit) {
        var tracked = false
        fun activate() {
            if (tracked) return
            tracked = true
            if (popups == 0) popupProperty = getClientProperty(RenderingUtil.ALWAYS_PAINT_SELECTION_AS_FOCUSED)
            popups++
            putClientProperty(RenderingUtil.ALWAYS_PAINT_SELECTION_AS_FOCUSED, true)
            repaint()
        }
        add(object : JBPopupListener {
            override fun beforeShown(event: LightweightWindowEvent) = activate()

            override fun onClosed(event: LightweightWindowEvent) {
                if (!tracked) return
                tracked = false
                popups = maxOf(0, popups - 1)
                if (popups == 0) putClientProperty(RenderingUtil.ALWAYS_PAINT_SELECTION_AS_FOCUSED, popupProperty)
                repaint()
            }
        })
        if (visible) activate()
    }

    private fun checkEdt() {
        check(ApplicationManager.getApplication().isDispatchThread) { "Active tree updates must run on EDT" }
    }

    @RequiresEdt
    fun geometry() {
        setHovered(null)
        pointer.clear()
        onGeometry?.invoke()
    }


    // Reordering ---------------------------------------------------------------------------------

    private fun installReorder() {
        if (reorder == null) return
        if (java.awt.GraphicsEnvironment.isHeadless()) return
        SmoothAutoScroller.installDropTargetAsNecessary(this)
        DnDSupport.createBuilder(this)
            .setBeanProvider { info -> pickable(info.point)?.let { DnDDragStartBean(TreePick(this, it)) } }
            .setImageProvider { info ->
                dragImage(info.point)?.let { DnDImage(it.first, it.second) }
            }
            .setTargetChecker { event ->
                val pick = event.attachedObject as? TreePick
                if (pick?.tree !== this) {
                    event.setDropPossible(false)
                    return@setTargetChecker true
                }
                event.setDropPossible(ordering.over(pick.key, event.getPointOn(this)))
                true
            }
            .setDropHandlerWithResult { event ->
                val pick = event.attachedObject as? TreePick
                if (pick?.tree !== this) return@setDropHandlerWithResult false
                drop()
                true
            }
            .setDropEndedCallback { cancelDrag() }
            .install()
    }

    internal fun pickable(point: Point): String? {
        return ordering.pick(point)
    }

    internal fun over(key: String, point: Point) {
        ordering.over(key, point)
    }

    @RequiresEdt
    internal fun preview(change: () -> Unit) {
        pointer.clear()
        setHovered(null)
        restoring = true
        try {
            change()
        } finally {
            restoring = false
        }
        onGeometry?.invoke()
        repaint()
    }

    internal fun drop() {
        ordering.drop()
    }

    private fun cancelDrag() {
        ordering.cancel()
    }

    private fun dragImage(point: Point): Pair<Image, Point>? {
        return pickable(point)?.let { entries[it] }?.let { entry -> paintedBounds(entry)?.let { bounds ->
            renderer.image(state(entry, true, true, bounds.width), bounds.width)?.let { image ->
                val x = (point.x - bounds.x).coerceIn(0, image.first.width)
                val y = (point.y - bounds.y).coerceIn(0, image.first.height)
                image.first to Point(-x, -y)
            }
        } }
    }
}

private data class TreePick(val tree: ActiveTreeView, val key: String)

/** Tree cell adapter around the shared [ActiveRenderer]. */
internal class ActiveTreeRenderer(
    private val cfg: ActiveConfig,
    private val menu: ActiveMenu<*>?,
    private val view: ActiveTreeView,
) : BorderLayoutPanel(), javax.swing.tree.TreeCellRenderer {
    val active = ActiveRenderer(cfg, menu)
    private var gap = false


    init {
        isOpaque = false
        addToCenter(active)
    }

    override fun getTreeCellRendererComponent(
        tree: javax.swing.JTree,
        value: Any?,
        selected: Boolean,
        expanded: Boolean,
        leaf: Boolean,
        row: Int,
        hasFocus: Boolean,
    ): java.awt.Component {
        val entry = value as? ActiveEntry ?: return this
        gap = view.placeholder(entry)
        active.isVisible = !gap
        val state = view.state(entry, selected, hasFocus)
        active.render(state.copy(bodyHeight = null))
        val size = active.preferredSize
        active.render(state)
        setPreferredSize(Dimension(size.width, state.bodyHeight ?: size.height))
        activeInvalidate(this)
        return this
    }

    override fun paintChildren(g: Graphics) {
        super.paintChildren(g)
        if (gap) ai.kilocode.client.ui.active.activePlaceholder(g, java.awt.Rectangle(0, 0, width, height))
    }

    fun component(state: ActiveRenderState): JComponent = active.render(state)

    fun preferredHeight(state: ActiveRenderState, width: Int): Int =
        active.bodyPreferredHeight(state.copy(width = width))

    fun image(state: ActiveRenderState, width: Int): Pair<java.awt.image.BufferedImage, Point>? =
        active.rowImage(state, width)
}
