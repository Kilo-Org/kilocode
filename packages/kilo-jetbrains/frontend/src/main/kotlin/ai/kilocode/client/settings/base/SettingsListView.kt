package ai.kilocode.client.settings.base

import ai.kilocode.client.session.ui.model.ModelSearch
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.application.ApplicationManager
import com.intellij.ui.CollectionListModel
import com.intellij.ui.ScrollingUtil
import com.intellij.ui.components.JBList
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.xml.util.XmlStringUtil
import com.intellij.util.ui.UIUtil
import java.awt.Dimension
import java.awt.Rectangle
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.KeyStroke
import javax.swing.ListSelectionModel
import javax.swing.Scrollable
import javax.swing.SwingConstants
import javax.swing.event.ListSelectionEvent

internal class SettingsListView(
    empty: String,
    private val cfg: SettingsListConfig = SettingsListConfig.Equal,
    private val onCell: (String, String) -> Unit,
) : BaseContentPanel(), Scrollable {
    private val model = CollectionListModel<SettingsListItem>()
    internal val list = object : JBList<SettingsListItem>(model) {
        override fun getToolTipText(event: MouseEvent): String? {
            if (!cfg.description || !cfg.tooltip) return null
            val idx = locationToIndex(event.point)
            if (idx < 0) return null
            val bounds = getCellBounds(idx, idx) ?: return null
            if (!bounds.contains(event.point)) return null
            val note = model.getElementAt(idx).description?.takeIf { it.isNotBlank() } ?: return null
            val text = note.lines().joinToString("<br>") { XmlStringUtil.escapeString(it) }
            return XmlStringUtil.wrapInHtml(text)
        }
    }.apply {
        selectionMode = cfg.selection
        setExpandableItemsEnabled(false)
        emptyText.text = empty
    }
    private var items = emptyList<SettingsListItem>()
    private var filter = ""
    private var press: Press? = null
    internal var onSelect: (() -> Unit)? = null

    fun setEmptyText(text: String) {
        list.emptyText.text = text
    }

    init {
        list.cellRenderer = SettingsListRenderer(model, cfg)
        list.registerKeyboardAction(
            { primary() },
            KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
        list.addMouseListener(object : MouseAdapter() {
            override fun mousePressed(e: MouseEvent) {
                if (!UIUtil.isActionClick(e, MouseEvent.MOUSE_PRESSED, true)) return
                press = null
                val hit = hit(e) ?: return
                press = Press(hit.item.key, hit.id ?: return)
            }

            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount != 2 || !UIUtil.isActionClick(e, MouseEvent.MOUSE_CLICKED, true)) return
                val hit = hit(e, enabled = false) ?: return
                if (hit.id != null) return
                val item = hit.item
                item.doubleClick?.let { id ->
                    onCell(item.key, id)
                    e.consume()
                    return
                }
                primary(item)
                e.consume()
            }

            override fun mouseReleased(e: MouseEvent) {
                if (!UIUtil.isActionClick(e, MouseEvent.MOUSE_RELEASED, true)) return
                val down = press ?: return
                press = null
                val hit = hit(e) ?: return
                if (hit.item.key != down.key || hit.id != down.id) return
                onCell(hit.item.key, down.id)
                e.consume()
            }
        })
        list.addListSelectionListener { e: ListSelectionEvent ->
            if (!e.valueIsAdjusting) onSelect?.invoke()
        }
        ScrollingUtil.installActions(list)
        next(list)
    }

    @RequiresEdt
    fun selected(): SettingsListItem? {
        checkEdt()
        return list.selectedValue
    }

    @RequiresEdt
    fun selectedItems(): List<SettingsListItem> {
        checkEdt()
        return list.selectedValuesList
    }

    @RequiresEdt
    fun selectedIndex(): Int {
        checkEdt()
        return list.selectedIndex
    }

    @RequiresEdt
    fun update(items: List<SettingsListItem>, selection: SettingsListSelection = SettingsListSelection.Preserve) {
        checkEdt()
        this.items = items
        val key = when (selection) {
            is SettingsListSelection.Key -> selection.key
            is SettingsListSelection.Index -> null
            SettingsListSelection.Preserve -> list.selectedValue?.key
        }
        val idx = when (selection) {
            is SettingsListSelection.Index -> selection.index
            is SettingsListSelection.Key,
            SettingsListSelection.Preserve,
            -> null
        }
        sync(key, idx)
    }

    @RequiresEdt
    fun setBusy(value: Boolean) {
        checkEdt()
        list.setPaintBusy(value)
        if (list.isEnabled == !value) return
        list.isEnabled = !value
        list.repaint()
    }

    @RequiresEdt
    fun filter(query: String) {
        checkEdt()
        if (filter == query) return
        filter = query
        sync()
    }

    @RequiresEdt
    private fun sync(prefer: String? = list.selectedValue?.key, at: Int? = null) {
        checkEdt()
        val q = filter.trim()
        val rows = if (q.isBlank()) items else items.filter { ModelSearch.matches(q, it.title) }
        model.replaceAll(rows)
        syncCellHeight(rows)
        val idx = at?.let { settingsListIndex(rows, it) }?.takeIf { it >= 0 }
            ?: settingsListIndex(rows, prefer).takeIf { it >= 0 }
            ?: rows.indices.firstOrNull()
            ?: -1
        if (idx >= 0) choose(idx) else list.clearSelection()
    }

    @RequiresEdt
    private fun syncCellHeight(rows: List<SettingsListItem>) {
        checkEdt()
        if (cfg.height == SettingsListRowHeight.PREFERRED) {
            if (list.fixedCellHeight == -1) return
            list.fixedCellHeight = -1
            list.revalidate()
            return
        }
        val height = rows.indices.maxOfOrNull { idx ->
            list.cellRenderer.getListCellRendererComponent(list, rows[idx], idx, true, list.hasFocus()).preferredSize.height
        } ?: -1
        if (list.fixedCellHeight == height) return
        list.fixedCellHeight = height
        list.revalidate()
    }

    @RequiresEdt
    private fun choose(idx: Int) {
        checkEdt()
        list.selectedIndex = idx
        ScrollingUtil.ensureIndexIsVisible(list, idx, 0)
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

    private fun primary(item: SettingsListItem) {
        val cells = settingsListVisibleCells(item, true)
        val cell = cells.firstOrNull { it.enabled && it.primary }
        if (cell != null) {
            onCell(item.key, cell.id)
            return
        }
        item.doubleClick?.let { id ->
            onCell(item.key, id)
            return
        }
        cells.firstOrNull { it.enabled }?.let { onCell(item.key, it.id) }
    }

    private fun hit(e: MouseEvent, enabled: Boolean = true): Hit? {
        val idx = list.locationToIndex(e.point)
        val bounds = idx.takeIf { it >= 0 }?.let { list.getCellBounds(it, it) } ?: return null
        if (!bounds.contains(e.point)) return null
        val item = model.getElementAt(idx)
        val selected = list.isSelectedIndex(idx)
        val id = if (enabled) {
            settingsListCellAt(list, idx, e.point, selected)
        } else {
            settingsListCellBounds(list, idx, selected)
                .entries
                .firstOrNull { it.value.contains(e.point) }
                ?.key
        }
        return Hit(item, id)
    }

    private fun checkEdt() {
        check(ApplicationManager.getApplication().isDispatchThread) { "Settings list updates must run on EDT" }
    }

    override fun getScrollableTracksViewportWidth() = true

    override fun getScrollableTracksViewportHeight() = false

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

    private data class Hit(val item: SettingsListItem, val id: String?)

    private data class Press(val key: String, val id: String)
}

private fun settingsListIndex(items: List<SettingsListItem>, key: String?): Int {
    if (key == null) return if (items.isEmpty()) -1 else 0
    return items.indexOfFirst { it.key == key }
}

private fun settingsListIndex(items: List<SettingsListItem>, index: Int): Int {
    if (items.isEmpty()) return -1
    return index.coerceIn(0, items.lastIndex)
}

internal sealed interface SettingsListSelection {
    data object Preserve : SettingsListSelection
    data class Key(val key: String) : SettingsListSelection
    data class Index(val index: Int) : SettingsListSelection
}
