package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.openapi.ui.popup.JBPopupListener
import com.intellij.openapi.ui.popup.LightweightWindowEvent
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.CollectionListModel
import com.intellij.ui.ScrollingUtil
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBList
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.UIUtil
import com.intellij.xml.util.XmlStringUtil
import java.awt.Color
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Image
import java.awt.Point
import java.awt.Rectangle
import java.awt.event.FocusAdapter
import java.awt.event.FocusEvent
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.KeyStroke
import javax.swing.JViewport
import javax.swing.ListSelectionModel
import javax.swing.Scrollable
import javax.swing.SwingConstants
import javax.swing.SwingUtilities
import javax.swing.event.ListSelectionEvent

internal class ActiveListView(
    empty: String,
    private val cfg: ActiveListConfig = ActiveListConfig.Equal,
    private val surface: ActiveListSurface = ActiveListSurface.Default,
    private val matcher: (String, ActiveListItem) -> Boolean = ::activeListMatches,
    private val enter: () -> Boolean = ::activeListEnterFocus,
    private val openOnClick: Boolean = true,
    private val onOpen: ((ActiveListItem, Boolean) -> Unit)? = null,
    private val onActivate: ((ActiveListItem) -> Unit)? = null,
    private val onClick: ((ActiveListItem) -> Unit)? = null,
    private val menu: ActiveListMenu<*>? = null,
    private val reorder: ActiveListReorder? = null,
    private val onHover: ((ActiveListItem?) -> Unit)? = null,
    private val onCell: (String, String) -> Unit,
) : Stack(StackAxis.VERTICAL), Scrollable {
    private val model = CollectionListModel<ActiveListItem>()
    private val renderer = ActiveListRenderer(model, cfg, menu)
    // Hover tracking also drives the hover callback, so a consumer that only wants row hover does not
    // have to turn on the hover action bar to get it.
    private val hover = cfg.hoverActions || menu != null || onHover != null
    internal val list: JBList<ActiveListItem> = object : JBList<ActiveListItem>(model), ActiveListActive {
        override fun active(): Boolean = popups > 0

        override fun hoveredIndex(): Int = hovered

        override fun processMouseEvent(e: MouseEvent) {
            if (e.id == MouseEvent.MOUSE_PRESSED && UIUtil.isActionClick(e, MouseEvent.MOUSE_PRESSED, true)) {
                if (showMenu(e.point)) return
            }
            super.processMouseEvent(e)
        }

        override fun getBackground(): Color {
            if (surface == ActiveListSurface.ToolWindow) return activeListToolWindowBackground()
            return super.getBackground() ?: UIUtil.getListBackground(false, false)
        }

        override fun getToolTipText(event: MouseEvent): String? {
            val tip = super.getToolTipText(event)
            if (tip != null) return tip
            val idx = locationToIndex(event.point)
            if (idx < 0) return null
            val bounds = getCellBounds(idx, idx) ?: return null
            if (!bounds.contains(event.point)) return null
            val item = model.getElementAt(idx)
            val selected = isSelectedIndex(idx)
            // A button (action cell, menu glyph, or metrics badge) under the pointer owns the
            // tooltip; only fall back to the row description when the pointer is over the body.
            val hit = activeListHits(this, idx, selected).firstOrNull { it.bounds.contains(event.point) }
            if (hit != null) return hit.tooltip?.takeIf { it.isNotBlank() }
            if (!cfg.description || !cfg.tooltip) return null
            val note = item.tooltip?.takeIf { it.isNotBlank() } ?: return null
            val text = note.lines().joinToString("<br>") { XmlStringUtil.escapeString(it) }
            return XmlStringUtil.wrapInHtml(text)
        }
    }.apply {
        selectionMode = cfg.selection
        setExpandableItemsEnabled(false)
        emptyText.text = empty
    }
    private var items = emptyList<ActiveListItem>()
    private var filter = ""
    private var press: Press? = null
    private var popups = 0
    private var hovered = -1
    private var heightKey: ActiveListHeightKey? = null
    private var drag: Drag? = null
    private var anchor: Set<Any> = emptySet()
    private var mark = -1
    private var restoring = false
    // Cursor for the row body; buttons override it on hover via [cursorAt].
    private var baseCursor: Cursor = Cursor.getDefaultCursor()
    internal var onSelect: (() -> Unit)? = null

    fun setEmptyText(text: String) {
        list.emptyText.text = text
    }

    init {
        if (surface == ActiveListSurface.ToolWindow) isOpaque = true
        list.putClientProperty(AnimatedIcon.ANIMATION_IN_RENDERER_ALLOWED, true)
        list.cellRenderer = renderer
        list.registerKeyboardAction(
            { open(enter()) },
            KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
        if (onOpen != null) {
            list.registerKeyboardAction(
                { source() },
                KeyStroke.getKeyStroke(KeyEvent.VK_F4, 0),
                JComponent.WHEN_FOCUSED,
            )
        }
        val mouse = object : MouseAdapter() {
            override fun mousePressed(e: MouseEvent) {
                if (!UIUtil.isActionClick(e, MouseEvent.MOUSE_PRESSED, true)) return
                list.requestFocusInWindow()
                press = null
                if (selection(e)) return
                rowAt(e.point)?.takeIf { !list.isSelectedIndex(it) }?.let { choose(it, scroll = false) }
                val hit = hit(e) ?: return
                press = Press(hit.item.key, hit.id ?: return)
            }

            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount == 1 && UIUtil.isActionClick(e, MouseEvent.MOUSE_CLICKED, true)) {
                    if (selection(e)) return
                    val hit = hit(e, enabled = false) ?: return
                    if (hit.id != null) return
                    if (hit.item.progress != null) return
                    if (!openOnClick) {
                        onClick?.invoke(hit.item) ?: return
                        e.consume()
                        return
                    }
                    val action = onOpen
                    if (action != null) action(hit.item, false) else onClick?.invoke(hit.item) ?: return
                    e.consume()
                    return
                }
                if (e.clickCount != 2 || !UIUtil.isActionClick(e, MouseEvent.MOUSE_CLICKED, true)) return
                val hit = hit(e, enabled = false) ?: return
                if (hit.id != null) return
                if (hit.item.progress != null) return
                val action = onOpen
                if (action != null) action(hit.item, true) else activate(hit.item)
                e.consume()
            }

            override fun mouseReleased(e: MouseEvent) {
                if (!UIUtil.isActionClick(e, MouseEvent.MOUSE_RELEASED, true)) return
                if (selection(e)) {
                    press = null
                    return
                }
                val down = press ?: return
                press = null
                val hit = hit(e) ?: return
                if (hit.item.key != down.key || hit.id != down.id) return
                if (hit.item.progress != null) return
                fire(hit.item, down.id)
                e.consume()
            }

            override fun mouseMoved(e: MouseEvent) {
                if (hover && drag == null) {
                    val idx = list.locationToIndex(e.point)
                        .takeIf { it >= 0 && list.getCellBounds(it, it)?.contains(e.point) == true }
                        ?: -1
                    setHovered(idx)
                }
                syncCursor(cursorAt(e.point))
            }

            override fun mouseExited(e: MouseEvent) {
                if (hover) setHovered(-1)
                syncCursor(baseCursor)
            }
        }
        list.addMouseListener(mouse)
        list.addMouseMotionListener(mouse)
        list.addListSelectionListener { e: ListSelectionEvent ->
            // Selection gates the hover-revealed action bar, so repaint the hovered row as soon as
            // its selection flips instead of waiting for the next mouse move.
            if (hover) repaintRow(hovered)
            if (!restoring && !e.valueIsAdjusting) {
                anchor = identities()
                mark = list.selectedIndex
                onSelect?.invoke()
            }
        }
        list.addFocusListener(object : FocusAdapter() {
            override fun focusGained(e: FocusEvent) = list.repaint()

            override fun focusLost(e: FocusEvent) = list.repaint()
        })
        reorder?.let { installActiveListReorder(this, list, it) }
        ScrollingUtil.installActions(list)
        next(list)
    }

    @RequiresEdt
    fun selected(): ActiveListItem? {
        checkEdt()
        return list.selectedValue
    }

    @RequiresEdt
    fun clearSelection() {
        checkEdt()
        anchor = emptySet()
        mark = -1
        list.clearSelection()
    }

    @RequiresEdt
    fun selectedItems(): List<ActiveListItem> {
        checkEdt()
        return list.selectedValuesList
    }

    @RequiresEdt
    fun selectedKeys(): List<String> {
        checkEdt()
        return selectedItems().map { it.key }
    }

    @RequiresEdt
    fun selectedIndex(): Int {
        checkEdt()
        return list.selectedIndex
    }

    @RequiresEdt
    fun select(key: String, scroll: Boolean = true): Boolean {
        checkEdt()
        anchor = setOf(key)
        val idx = activeListIndex(model.items, key)
        mark = idx
        if (idx < 0) return false
        choose(idx, scroll)
        return true
    }

    @RequiresEdt
    fun selectIndex(index: Int) {
        checkEdt()
        val item = model.items.getOrNull(index)
        anchor = item?.let { setOf(it.identity) }.orEmpty()
        mark = if (item == null) -1 else index
        choose(index)
    }

    @RequiresEdt
    fun setSelectionIndices(indices: IntArray) {
        checkEdt()
        val rows = indices.toList().mapNotNull { model.items.getOrNull(it) }
        anchor = rows.map { it.identity }.toSet()
        mark = indices.firstOrNull { it in model.items.indices } ?: -1
        list.selectedIndices = indices
    }

    @RequiresEdt
    fun setSelectionMode(mode: Int) {
        checkEdt()
        list.selectionMode = mode
    }

    @RequiresEdt
    fun setListMinimumSize(size: Dimension) {
        checkEdt()
        list.minimumSize = size
    }

    @RequiresEdt
    fun item(key: String): ActiveListItem? {
        checkEdt()
        return model.items.firstOrNull { it.key == key }
    }

    @RequiresEdt
    fun point(key: String, cell: String? = null): RelativePoint {
        checkEdt()
        val idx = activeListIndex(model.items, key)
        if (idx < 0) return RelativePoint(list, Point(0, 0))
        val bounds = list.getCellBounds(idx, idx) ?: return RelativePoint(list, Point(0, 0))
        val rect = cell?.let { activeListCellBounds(list, idx, list.isSelectedIndex(idx))[it] }
        val target = rect ?: bounds
        // Horizontal middle of the target, anchored to its bottom edge: the balloon opens below, so
        // a center anchor would bury the callout under the balloon body and cover the row instead of
        // pointing at it.
        val x = target.x + target.width / 2
        val y = target.y + target.height
        return RelativePoint(list, Point(x.coerceIn(bounds.x, bounds.x + bounds.width), y))
    }

    @RequiresEdt
    fun focusList() {
        checkEdt()
        list.requestFocusInWindow()
        list.repaint()
    }

    @RequiresEdt
    fun update(items: List<ActiveListItem>, selection: ActiveListSelection = ActiveListSelection.Preserve) {
        checkEdt()
        if (this.items != items) heightKey = null
        this.items = items
        when (selection) {
            is ActiveListSelection.Key -> {
                anchor = setOf(selection.key)
                mark = -1
                sync(Absent.KEEP)
            }
            ActiveListSelection.Slide -> sync(Absent.SLIDE)
            ActiveListSelection.Preserve -> sync(Absent.KEEP)
        }
    }

    @RequiresEdt
    fun setBusy(value: Boolean) {
        checkEdt()
        list.setPaintBusy(value)
        setLocked(value)
    }

    /**
     * Blocks input on the list without the [setBusy] progress spinner. For a list whose own content
     * already shows the work in flight, where a second spinner would just be noise.
     */
    @RequiresEdt
    fun setLocked(value: Boolean) {
        checkEdt()
        if (value) setHovered(-1)
        if (list.isEnabled == !value) return
        list.isEnabled = !value
        list.repaint()
    }

    @RequiresEdt
    fun trackPopup(popup: JBPopup) {
        checkEdt()
        trackPopupState(popup.isVisible) { listener -> popup.addListener(listener) }
    }

    @RequiresEdt
    fun trackBalloon(balloon: Balloon) {
        checkEdt()
        trackPopupState(true) { listener -> balloon.addListener(listener) }
    }

    @RequiresEdt
    fun filter(query: String) {
        checkEdt()
        if (filter == query) return
        filter = query
        sync(Absent.FIRST)
    }

    @RequiresEdt
    private fun sync(absent: Absent = Absent.KEEP, at: Int? = null) {
        checkEdt()
        val q = filter.trim()
        val base = if (q.isBlank()) items else items.filter { matcher(q, it) }
        val state = drag
        if (state != null && base.none { it.key == state.key }) drag = null
        val rows = drag?.let { activeListGapRows(base, it.key, it.index, it.height) } ?: base
        val before = identities()
        restoring = true
        try {
            // Rebuilding the model fires a list-wide repaint, so skip it when the visible rows are
            // structurally unchanged (e.g. a stats/name refresh that produced identical rows) and only
            // reconcile selection below. Row types are data classes, so equality is by value.
            if (model.items != rows) {
                setHovered(-1)
                model.replaceAll(rows)
            }
            syncCellHeight(rows)
            restore(rows, absent, at)
            // Scroll only when the refresh moved the selection to another row. Re-finding the same
            // rows must leave the viewport where the user left it, or a polling owner would drag the
            // view back to the selection on every tick.
            val idx = list.selectedIndex
            if (idx >= 0 && identities() != before) ScrollingUtil.ensureIndexIsVisible(list, idx, 0)
        } finally {
            restoring = false
        }
    }

    /**
     * Reselects the anchored rows in the rebuilt [rows], or the row [at] when the drag gap pins the
     * slot. Falls back to [absent] once none of the anchored rows survive.
     */
    @RequiresEdt
    private fun restore(rows: List<ActiveListItem>, absent: Absent, at: Int?) {
        checkEdt()
        val idx = at?.let { activeListIndex(rows, it) }?.takeIf { it >= 0 }
        if (idx != null) {
            list.selectedIndex = idx
            mark = idx
            return
        }
        val indices = anchor.mapNotNull { id -> activeListIdentityIndex(rows, id).takeIf { it >= 0 } }
        if (indices.isNotEmpty()) {
            list.selectedIndices = indices.toIntArray()
            mark = indices.min()
            return
        }
        when (absent) {
            Absent.KEEP -> list.clearSelection()
            Absent.SLIDE -> {
                if (anchor.isEmpty() || rows.isEmpty()) {
                    list.clearSelection()
                    mark = -1
                    return
                }
                val next = mark.coerceIn(0, rows.lastIndex)
                list.selectedIndex = next
                anchor = setOf(rows[next].identity)
                mark = next
            }
            Absent.FIRST -> {
                if (rows.isEmpty()) {
                    list.clearSelection()
                    return
                }
                list.selectedIndex = 0
                mark = 0
                if (anchor.isEmpty()) anchor = setOf(rows[0].identity)
            }
        }
    }

    private fun identities(): Set<Any> = list.selectedValuesList.map { it.identity }.toSet()

    @RequiresEdt
    private fun setHovered(idx: Int) {
        checkEdt()
        if (hovered == idx) return
        val old = hovered
        hovered = idx
        repaintRow(old)
        repaintRow(idx)
        // Single funnel for every hover transition — mouse move, mouse exit, and the clear that setBusy
        // and a model rebuild perform — so a consumer cannot miss one and leave a popup behind.
        onHover?.invoke(model.items.getOrNull(idx))
    }

    /**
     * The hovered row's bounds in the coordinates of [pane], or null when no row is hovered. Callers
     * placing a popup beside a row need its edges, which [point] does not give: that answers a single
     * anchor point at a fixed inset, for balloons that hang below a cell.
     *
     * Deliberately does not check whether the list is on screen. A caller has to resolve a root pane to
     * have a [pane] at all, which is the same question asked earlier and more directly.
     */
    @RequiresEdt
    fun hoveredBounds(pane: JComponent): Rectangle? {
        checkEdt()
        if (hovered < 0) return null
        val bounds = list.getCellBounds(hovered, hovered) ?: return null
        return SwingUtilities.convertRectangle(list, bounds, pane)
    }

    /** The visible extent of the list in the coordinates of [pane], for budgeting a popup's height. */
    @RequiresEdt
    fun visibleBounds(pane: JComponent): Rectangle? {
        checkEdt()
        val visible = list.visibleRect.takeIf { !it.isEmpty } ?: return null
        return SwingUtilities.convertRectangle(list, visible, pane)
    }

    @RequiresEdt
    private fun repaintRow(idx: Int) {
        checkEdt()
        if (idx < 0) return
        list.getCellBounds(idx, idx)?.let { list.repaint(it) }
    }

    @RequiresEdt
    private fun syncCellHeight(rows: List<ActiveListItem>) {
        checkEdt()
        val key = ActiveListHeightKey(cfg, list.width, rows.map(::activeListHeightRow))
        if (heightKey == key) return
        heightKey = key
        renderer.setBodyHeight(null)
        if (cfg.height == ActiveListRowHeight.PREFERRED) {
            if (list.fixedCellHeight == -1) return
            list.fixedCellHeight = -1
            list.revalidate()
            return
        }
        if (rows.any { it.section != null }) {
            val height = rows.indices.maxOfOrNull { idx ->
                renderer.bodyPreferredHeight(list, rows[idx], idx, true, true)
            }
            renderer.setBodyHeight(height)
            if (list.fixedCellHeight == -1) {
                list.revalidate()
                return
            }
            list.fixedCellHeight = -1
            list.revalidate()
            return
        }
        val height = rows.indices.maxOfOrNull { idx ->
            list.cellRenderer.getListCellRendererComponent(list, rows[idx], idx, true, true).preferredSize.height
        } ?: -1
        if (list.fixedCellHeight == height) return
        list.fixedCellHeight = height
        list.revalidate()
    }

    @RequiresEdt
    private fun choose(idx: Int, scroll: Boolean = true) {
        checkEdt()
        list.selectedIndex = idx
        if (scroll) ScrollingUtil.ensureIndexIsVisible(list, idx, 0)
    }

    @RequiresEdt
    fun move(step: Int) {
        checkEdt()
        val size = model.size
        if (size <= 0) return
        // With nothing selected the first step lands on the near end: down takes the first row, up
        // takes the last, instead of skipping past it.
        val from = list.selectedIndex.takeIf { it >= 0 } ?: if (step > 0) -1 else size
        choose((from + step).coerceIn(0, size - 1))
    }

    @RequiresEdt
    fun primary() {
        checkEdt()
        val item = active() ?: return
        primary(item)
    }

    private fun open(focus: Boolean) {
        val item = active() ?: return
        if (item is ActiveListGap) return
        if (item.progress != null) return
        val action = onOpen
        if (action != null) {
            action(item, focus)
            return
        }
        primary(item)
    }

    private fun source() {
        val item = list.selectedValue ?: return
        if (item is ActiveListGap) return
        if (item.progress != null) return
        onOpen?.invoke(item, true)
    }

    private fun active(): ActiveListItem? {
        list.selectedValue?.let { return it }
        if (model.size == 0) return null
        choose(0, scroll = false)
        return list.selectedValue
    }

    /**
     * Default action for a double-click. Resolves to the row's explicit activation only: an
     * [onActivate] handler, then the row's [ActiveListItem.doubleClick] cell, then a [primary] cell.
     * Unlike Enter, it never falls back to firing an arbitrary first action cell, so a row whose only
     * action is destructive (e.g. delete) does nothing on double-click.
     */
    private fun activate(item: ActiveListItem) {
        if (item is ActiveListGap) return
        if (item.progress != null) return
        val action = onActivate
        if (action != null) {
            action(item)
            return
        }
        item.doubleClick?.let { id ->
            fire(item, id)
            return
        }
        activeListVisibleCells(item, true)
            .firstOrNull { it.enabled && it.primary }
            ?.let { fire(item, it.id) }
    }

    private fun primary(item: ActiveListItem) {
        if (item is ActiveListGap) return
        if (item.progress != null) return
        val cells = activeListVisibleCells(item, true)
        val cell = cells.firstOrNull { it.enabled && it.primary }
        if (cell != null) {
            fire(item, cell.id)
            return
        }
        item.doubleClick?.let { id ->
            fire(item, id)
            return
        }
        cells.firstOrNull { it.enabled }?.let { fire(item, it.id) }
            ?: onActivate?.invoke(item)
    }

    /** Dispatches a click from the row model, never the renderer stamp reused across rows. */
    private fun fire(item: ActiveListItem, id: String) {
        val cell = item.cells.firstOrNull { it.id == id }?.action
        if (cell != null) {
            cell()
            return
        }
        val region = activeListRegions(item)[id]
        if (region != null) {
            region()
            return
        }
        onCell(item.key, id)
    }

    @RequiresEdt
    fun pickable(point: Point): String? {
        checkEdt()
        val cfg = reorder ?: return null
        if (!list.isEnabled || filter.isNotBlank() || drag != null) return null
        val idx = rowAt(point) ?: return null
        val item = model.getElementAt(idx)
        if (item is ActiveListGap || item.disabled || item.progress != null) return null
        if (!cfg.movable(item)) return null
        val selected = list.isSelectedIndex(idx)
        if (activeListCellAt(list, idx, point, selected, menu?.takeIf { it.available(item) } != null) != null) return null
        return item.key
    }

    /**
     * The dragged row painted as an image, plus the AWT image offset that keeps the grabbed pixel
     * under the cursor. AWT places the image origin at `cursor + offset`, so the offset is the
     * negated grab point inside the image — otherwise the copy floats off to the lower right.
     */
    @RequiresEdt
    fun dragImage(point: Point): Pair<Image, Point>? {
        checkEdt()
        val idx = rowAt(point) ?: return null
        val item = model.getElementAt(idx)
        if (item is ActiveListGap) return null
        val bounds = list.getCellBounds(idx, idx) ?: return null
        val (image, origin) = renderer.rowImage(list, item, idx, bounds.width) ?: return null
        // Clamp so grabbing the section-header band still anchors inside the body image.
        val x = (point.x - bounds.x - origin.x).coerceIn(0, image.width)
        val y = (point.y - bounds.y - origin.y).coerceIn(0, image.height)
        return image to Point(-x, -y)
    }

    @RequiresEdt
    fun over(key: String, point: Point) {
        checkEdt()
        if (filter.isNotBlank()) return
        val current = drag
        val base = items
        val from = activeListIndex(base, key)
        if (from < 0) {
            cancel()
            return
        }
        // Measure the row body, not the whole cell: a row that opens a section renders the header
        // band inside its own cell, and folding that band into the gap height both oversizes the
        // placeholder and — through the equal-height pass, which measures the gap like any other
        // row — stretches every row to the header-carrying cell's height.
        val state = current ?: Drag(key, from, from, renderer.bodyPreferredHeight(list, base[from], from, true, true))
        if (current == null) {
            press = null
            setHovered(-1)
            drag = state
        }
        val run = activeListSectionRun(base, from)
        if (run.isEmpty()) return
        val idx = nearestRow(point) ?: state.index
        val next = idx.coerceIn(run.first, run.last)
        if (state.index == next && current != null) return
        drag = state.copy(index = next)
        sync(at = next)
    }

    @RequiresEdt
    fun drop() {
        checkEdt()
        val state = drag ?: return
        drag = null
        val source = activeListIndex(items, state.key)
        if (source < 0) {
            sync()
            return
        }
        val rows = items.toMutableList()
        val item = rows.removeAt(source)
        val target = state.index.coerceIn(0, rows.size)
        rows.add(target, item)
        items = rows
        heightKey = null
        anchor = setOf(state.key)
        mark = target
        sync(at = target)
        if (source == target) return
        reorder?.onMove?.invoke(ActiveListMove(state.key, source, target, rows.map { it.key }))
    }

    @RequiresEdt
    fun cancel() {
        checkEdt()
        if (drag == null) return
        drag = null
        sync()
    }

    @RequiresEdt
    fun setBaseCursor(cursor: Cursor) {
        checkEdt()
        baseCursor = cursor
        syncCursor(cursor)
    }

    private fun syncCursor(cursor: Cursor) {
        if (list.cursor.type != cursor.type) list.cursor = cursor
    }

    /**
     * Cursor for [point]: the hovered button's cursor (defaulting to the hand cursor) when the
     * pointer is over an enabled button, otherwise the row body's [baseCursor].
     */
    private fun cursorAt(point: Point): Cursor {
        val idx = list.locationToIndex(point)
        val bounds = idx.takeIf { it >= 0 }?.let { list.getCellBounds(it, it) } ?: return baseCursor
        if (!bounds.contains(point)) return baseCursor
        val item = model.getElementAt(idx)
        if (item is ActiveListGap) return baseCursor
        if (menu == null && item.cells.isEmpty() && activeListRegions(item).isEmpty()) return baseCursor
        val hit = activeListHits(list, idx, list.isSelectedIndex(idx))
            .firstOrNull { it.enabled && it.bounds.contains(point) }
            ?: return baseCursor
        return Cursor.getPredefinedCursor(hit.cursor)
    }

    private fun hit(e: MouseEvent, enabled: Boolean = true): Hit? {
        val idx = list.locationToIndex(e.point)
        val bounds = idx.takeIf { it >= 0 }?.let { list.getCellBounds(it, it) } ?: return null
        if (!bounds.contains(e.point)) return null
        val item = model.getElementAt(idx)
        if (item is ActiveListGap) return null
        val selected = list.isSelectedIndex(idx)
        val id = if (enabled) {
            activeListCellAt(list, idx, e.point, selected, menu?.takeIf { it.available(item) } != null)
        } else {
            activeListCellBounds(list, idx, selected)
                .entries
                .firstOrNull { it.value.contains(e.point) }
                ?.key
        }
        return Hit(item, id)
    }

    private fun showMenu(point: Point): Boolean {
        val cfg = menu ?: return false
        val idx = list.locationToIndex(point)
        val bounds = idx.takeIf { it >= 0 }?.let { list.getCellBounds(it, it) } ?: return false
        if (!bounds.contains(point)) return false
        val item = model.getElementAt(idx)
        if (item is ActiveListGap) return false
        if (item.disabled || item.progress != null || !cfg.available(item)) return false
        val rect = activeListCellBounds(list, idx, list.isSelectedIndex(idx))[ACTIVE_LIST_MENU_CELL] ?: return false
        if (!rect.contains(point)) return false
        val popup = JBPopupFactory.getInstance().createActionGroupPopup(
            null,
            cfg.group,
            cfg.context(list, item),
            JBPopupFactory.ActionSelectionAid.SPEEDSEARCH,
            true,
            cfg.place,
        )
        trackPopup(popup)
        popup.show(RelativePoint(list, Point(rect.x + rect.width / 2, rect.y + rect.height)))
        return true
    }

    private fun trackPopupState(visible: Boolean, add: (JBPopupListener) -> Unit) {
        var tracked = false
        fun activate() {
            if (tracked) return
            tracked = true
            popups++
            list.repaint()
        }
        add(object : JBPopupListener {
            override fun beforeShown(event: LightweightWindowEvent) = activate()

            override fun onClosed(event: LightweightWindowEvent) {
                if (!tracked) return
                tracked = false
                popups = maxOf(0, popups - 1)
                list.repaint()
            }
        })
        if (visible) activate()
    }

    private fun checkEdt() {
        check(ApplicationManager.getApplication().isDispatchThread) { "Active list updates must run on EDT" }
    }

    private fun selection(e: MouseEvent): Boolean {
        if (list.selectionMode == ListSelectionModel.SINGLE_SELECTION) return false
        return e.isShiftDown || e.isMetaDown || e.isControlDown
    }

    /**
     * The row containing [point], or null when it lands outside every cell. A short list in a
     * viewport-tracking surface leaves empty space under the last row, and a click or drag there
     * must not act on that row.
     */
    private fun rowAt(point: Point): Int? {
        val idx = list.locationToIndex(point)
        if (idx < 0) return null
        val bounds = list.getCellBounds(idx, idx) ?: return null
        return idx.takeIf { bounds.contains(point) }
    }

    /**
     * Like [rowAt], but clamps to the nearest row so dragging above the first or below the last row
     * still resolves a drop slot. Only the drag-over path wants this.
     */
    private fun nearestRow(point: Point): Int? {
        rowAt(point)?.let { return it }
        val idx = list.locationToIndex(point)
        if (idx < 0) return null
        val bounds = list.getCellBounds(idx, idx) ?: return null
        if (point.y < bounds.y) return 0
        return (model.size - 1).takeIf { it >= 0 }
    }

    override fun getBackground(): Color {
        if (surface == ActiveListSurface.ToolWindow) return activeListToolWindowBackground()
        return super.getBackground() ?: UIUtil.getPanelBackground()
    }

    override fun getScrollableTracksViewportWidth() = true

    override fun getScrollableTracksViewportHeight(): Boolean {
        if (surface != ActiveListSurface.ToolWindow) return false
        val view = parent as? JViewport ?: return false
        return preferredSize.height < view.height
    }

    override fun getPreferredScrollableViewportSize(): Dimension = preferredSize

    override fun getScrollableUnitIncrement(
        visibleRect: Rectangle,
        orientation: Int,
        direction: Int,
    ): Int {
        if (orientation != SwingConstants.VERTICAL) return UiStyle.Gap.pad()
        return list.fixedCellHeight.takeIf { it > 0 } ?: UiStyle.Gap.xl()
    }

    override fun getScrollableBlockIncrement(
        visibleRect: Rectangle,
        orientation: Int,
        direction: Int,
    ) = if (orientation == SwingConstants.VERTICAL) visibleRect.height else visibleRect.width

    private data class Hit(val item: ActiveListItem, val id: String?)

    private data class Press(val key: String, val id: String)

    private data class Drag(val key: String, val from: Int, val index: Int, val height: Int)

    private data class ActiveListHeightKey(
        val cfg: ActiveListConfig,
        val width: Int,
        val rows: List<ActiveListHeightRow>,
    )

    private enum class Absent { KEEP, SLIDE, FIRST }

}

private data class ActiveListHeightRow(
    val key: String,
    val title: String,
    val note: String?,
    val description: String?,
    val icon: Any?,
    val section: String?,
    val badges: List<ActiveListHeightBadge>,
    val trailing: String?,
    val cells: List<ActiveListCell>,
    val disabled: Boolean,
    val progress: String?,
)

/**
 * The parts of a badge that can change how tall a row wants to be. [ActiveListBadge.action] and its
 * tooltip are deliberately left out: an owner is free to build the handler while answering `badges`,
 * and a fresh lambda per read would make the height key miss on every sync.
 */
private data class ActiveListHeightBadge(
    val text: String,
    val style: UiStyle.Badge.Style,
    val id: String?,
    val icon: Any?,
)

private fun activeListHeightRow(item: ActiveListItem): ActiveListHeightRow {
    return ActiveListHeightRow(
        item.key,
        item.title,
        item.note,
        item.description,
        item.icon,
        item.section,
        item.badges.map { ActiveListHeightBadge(it.text, it.style, it.id, it.icon) },
        item.trailing,
        item.cells,
        item.disabled,
        item.progress,
    )
}

private fun activeListIndex(items: List<ActiveListItem>, key: String?): Int {
    if (key == null) return -1
    return items.indexOfFirst { it.key == key }
}

private fun activeListIdentityIndex(items: List<ActiveListItem>, id: Any): Int {
    return items.indexOfFirst { it.identity == id || it.key == id }
}

private fun activeListIndex(items: List<ActiveListItem>, index: Int): Int {
    if (items.isEmpty()) return -1
    return index.coerceIn(0, items.lastIndex)
}

/**
 * What a refresh should do with the selection. Every policy keeps the rows the user last selected
 * when they survive the refresh, and none of them scrolls in that case; they differ only in what
 * happens once those rows are gone.
 */
internal sealed interface ActiveListSelection {
    /** Select nothing while the remembered rows are absent, and pick them up again if they return. */
    data object Preserve : ActiveListSelection

    /**
     * Select the row that took the remembered row's slot — the following row, or the last row when
     * the removed one was last — so a deletion moves the highlight instead of dropping it. Clears
     * only when nothing was selected or the list is now empty.
     */
    data object Slide : ActiveListSelection

    /** Select [key] instead, now or as soon as a later refresh brings that row in. */
    data class Key(val key: String) : ActiveListSelection
}

internal fun activeListMatches(query: String, item: ActiveListItem): Boolean {
    if (query.isBlank()) return true
    if (activeListTextMatches(query, item.title)) return true
    val extra = item.search ?: return false
    return activeListTextMatches(query, extra)
}

private fun activeListTextMatches(query: String, text: String): Boolean {
    val q = query.lowercase().trim()
    if (q.isEmpty()) return true
    val parts = activeListWords(q)
    if (parts.isEmpty()) return true
    return parts.all { activeListAcronym(text, it) }
}

private fun activeListAcronym(text: String, query: String): Boolean {
    val words = activeListWords(text)
    val seen = HashSet<Pair<Int, Int>>()
    fun attempt(wi: Int, qi: Int): Boolean {
        if (qi == query.length) return true
        if (wi >= words.size) return false
        if (!seen.add(wi to qi)) return false
        val word = words[wi]
        var count = 0
        while (qi + count < query.length && count < word.length && word[count] == query[qi + count]) {
            count++
        }
        if (count > 0 && attempt(wi + 1, qi + count)) return true
        return attempt(wi + 1, qi)
    }
    return attempt(0, 0)
}

private fun activeListWords(text: String): List<String> {
    val out = mutableListOf<String>()
    val buf = StringBuilder()
    fun flush() {
        if (buf.isEmpty()) return
        out += buf.toString().lowercase()
        buf.clear()
    }
    for (ch in text) {
        if (ch in "[]_.: /\\(){}-") {
            flush()
            continue
        }
        if (ch.isUpperCase() && buf.isNotEmpty()) flush()
        buf.append(ch)
    }
    flush()
    return out
}
