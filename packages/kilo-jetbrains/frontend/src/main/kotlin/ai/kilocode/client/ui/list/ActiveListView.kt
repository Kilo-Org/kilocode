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
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.xml.util.XmlStringUtil
import java.awt.Color
import java.awt.Cursor
import java.awt.Dimension
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
    private val onCell: (String, String) -> Unit,
) : Stack(StackAxis.VERTICAL), Scrollable {
    private val model = CollectionListModel<ActiveListItem>()
    private val renderer = ActiveListRenderer(model, cfg, menu)
    private val hover = cfg.hoverActions || menu != null
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
                val hit = hit(e) ?: return
                press = Press(hit.item.key, hit.id ?: return)
            }

            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount == 1 && UIUtil.isActionClick(e, MouseEvent.MOUSE_CLICKED, true)) {
                    if (selection(e)) return
                    val hit = hit(e, enabled = false) ?: return
                    if (hit.id != null) return
                    if (hit.item.deleting) return
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
                if (hit.item.deleting) return
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
                if (hit.item.deleting) return
                fire(hit.item, down.id)
                e.consume()
            }

            override fun mouseMoved(e: MouseEvent) {
                if (hover) {
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
            if (!e.valueIsAdjusting) onSelect?.invoke()
        }
        list.addFocusListener(object : FocusAdapter() {
            override fun focusGained(e: FocusEvent) = list.repaint()

            override fun focusLost(e: FocusEvent) = list.repaint()
        })
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
        val idx = activeListIndex(model.items, key)
        if (idx < 0) return false
        choose(idx, scroll)
        return true
    }

    @RequiresEdt
    fun selectIndex(index: Int) {
        checkEdt()
        choose(index)
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
        val x = if (rect != null) target.x + target.width / 2 else target.x + JBUI.scale(48)
        // Anchor to the icon's bottom edge so the balloon callout points at the icon, not its center.
        val y = if (rect != null) target.y + target.height else target.y + target.height / 2
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
        val key = when (selection) {
            is ActiveListSelection.Key -> selection.key
            is ActiveListSelection.Index -> null
            ActiveListSelection.PreserveNoScroll,
            ActiveListSelection.Preserve -> list.selectedValue?.key
        }
        val idx = when (selection) {
            is ActiveListSelection.Index -> selection.index
            is ActiveListSelection.Key,
            ActiveListSelection.PreserveNoScroll,
            ActiveListSelection.Preserve,
            -> null
        }
        sync(key, idx, selection != ActiveListSelection.PreserveNoScroll)
    }

    @RequiresEdt
    fun setBusy(value: Boolean) {
        checkEdt()
        if (value) setHovered(-1)
        list.setPaintBusy(value)
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
        sync()
    }

    @RequiresEdt
    private fun sync(prefer: String? = list.selectedValue?.key, at: Int? = null, scroll: Boolean = true) {
        checkEdt()
        val q = filter.trim()
        val rows = if (q.isBlank()) items else items.filter { matcher(q, it) }
        // Rebuilding the model fires a list-wide repaint, so skip it when the visible rows are
        // structurally unchanged (e.g. a stats/name refresh that produced identical rows) and only
        // reconcile selection below. Row types are data classes, so equality is by value.
        if (model.items != rows) {
            setHovered(-1)
            model.replaceAll(rows)
        }
        syncCellHeight(rows)
        val idx = at?.let { activeListIndex(rows, it) }?.takeIf { it >= 0 }
            ?: activeListIndex(rows, prefer).takeIf { it >= 0 }
            ?: rows.indices.firstOrNull()
            ?: -1
        if (idx >= 0) choose(idx, scroll) else list.clearSelection()
    }

    @RequiresEdt
    private fun setHovered(idx: Int) {
        checkEdt()
        if (hovered == idx) return
        val old = hovered
        hovered = idx
        repaintRow(old)
        repaintRow(idx)
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
        val idx = ((list.selectedIndex.takeIf { it >= 0 } ?: 0) + step).coerceIn(0, size - 1)
        choose(idx)
    }

    @RequiresEdt
    fun primary() {
        checkEdt()
        val item = list.selectedValue ?: return
        primary(item)
    }

    private fun open(focus: Boolean) {
        val item = list.selectedValue ?: return
        if (item.deleting) return
        val action = onOpen
        if (action != null) {
            action(item, focus)
            return
        }
        primary(item)
    }

    private fun source() {
        val item = list.selectedValue ?: return
        if (item.deleting) return
        onOpen?.invoke(item, true)
    }

    /**
     * Default action for a double-click. Resolves to the row's explicit activation only: an
     * [onActivate] handler, then the row's [ActiveListItem.doubleClick] cell, then a [primary] cell.
     * Unlike Enter, it never falls back to firing an arbitrary first action cell, so a row whose only
     * action is destructive (e.g. delete) does nothing on double-click.
     */
    private fun activate(item: ActiveListItem) {
        if (item.deleting) return
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
        if (item.deleting) return
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

    /**
     * Dispatches a click on a button. A per-cell action or a metrics handler ([ActiveListMetrics])
     * takes precedence; otherwise the click routes through the list-level [onCell] callback.
     */
    private fun fire(item: ActiveListItem, id: String) {
        when (id) {
            ACTIVE_LIST_CHANGES_CELL -> {
                item.metrics?.onChanges?.invoke()
                return
            }
            ACTIVE_LIST_PR_CELL -> {
                item.metrics?.onPr?.invoke()
                return
            }
        }
        val action = item.cells.firstOrNull { it.id == id }?.action
        if (action != null) action() else onCell(item.key, id)
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
        if (menu == null && item.cells.isEmpty() && item.metrics == null) return baseCursor
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
        if (item.disabled || item.deleting || !cfg.available(item)) return false
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

    private data class ActiveListHeightKey(
        val cfg: ActiveListConfig,
        val width: Int,
        val rows: List<ActiveListHeightRow>,
    )

}

private data class ActiveListHeightRow(
    val key: String,
    val title: String,
    val note: String?,
    val description: String?,
    val icon: Any?,
    val section: String?,
    val badges: List<ActiveListBadge>,
    val trailing: String?,
    val cells: List<ActiveListCell>,
    val disabled: Boolean,
    val deleting: Boolean,
)

private fun activeListHeightRow(item: ActiveListItem): ActiveListHeightRow {
    return ActiveListHeightRow(
        item.key,
        item.title,
        item.note,
        item.description,
        item.icon,
        item.section,
        item.badges,
        item.trailing,
        item.cells,
        item.disabled,
        item.deleting,
    )
}

private fun activeListIndex(items: List<ActiveListItem>, key: String?): Int {
    if (key == null) return if (items.isEmpty()) -1 else 0
    return items.indexOfFirst { it.key == key }
}

private fun activeListIndex(items: List<ActiveListItem>, index: Int): Int {
    if (items.isEmpty()) return -1
    return index.coerceIn(0, items.lastIndex)
}

internal sealed interface ActiveListSelection {
    data object Preserve : ActiveListSelection
    data object PreserveNoScroll : ActiveListSelection
    data class Key(val key: String) : ActiveListSelection
    data class Index(val index: Int) : ActiveListSelection
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
