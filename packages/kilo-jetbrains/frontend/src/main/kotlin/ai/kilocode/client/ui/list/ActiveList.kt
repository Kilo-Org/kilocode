package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.active.ActiveConfig
import ai.kilocode.client.ui.active.activeToolWindowBackground
import ai.kilocode.client.ui.active.ActiveDeleteOptions
import ai.kilocode.client.ui.active.ActiveEditOptions
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveMenu
import ai.kilocode.client.ui.active.ActiveReorder
import ai.kilocode.client.ui.active.ActiveSelection
import ai.kilocode.client.ui.active.ActiveSurface
import ai.kilocode.client.ui.active.showActiveDeletePopup
import ai.kilocode.client.ui.active.showActiveEditPopup
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.options.advanced.AdvancedSettings
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.PopupHandler
import com.intellij.ui.SearchTextField
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Color
import java.awt.Cursor
import java.awt.Rectangle
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.JViewport
import javax.swing.KeyStroke
import javax.swing.ScrollPaneConstants
import javax.swing.UIManager
import javax.swing.event.DocumentEvent

internal fun activeToolWindowBackground(): Color = activeToolWindowBackground()

internal class ActiveList(
    emptyText: String,
    cfg: ActiveConfig = ActiveConfig.Equal,
    private val surface: ActiveSurface = ActiveSurface.Default,
    showSearch: Boolean = true,
    placeholder: String = "",
    onCell: (String, String) -> Unit,
    onOpen: ((ActiveItem, Boolean) -> Unit)? = null,
    matcher: (String, ActiveItem) -> Boolean = ::activeListMatches,
    enter: () -> Boolean = ::activeListEnterFocus,
    openOnClick: Boolean = true,
    onActivate: ((ActiveItem) -> Unit)? = null,
    onClick: ((ActiveItem) -> Unit)? = null,
    onSelect: (() -> Unit)? = null,
    menu: ActiveMenu<*>? = null,
    reorder: ActiveReorder? = null,
    onHover: ((ActiveItem?) -> Unit)? = null,
    options: ActiveListOptions = ActiveListOptions(),
) : BorderLayoutPanel() {
    private val view = ActiveListView(
        emptyText, cfg, surface, matcher, enter, openOnClick, onOpen, onActivate, onClick,
        menu, reorder, onHover, options, onCell = onCell,
    )
    private val search: SearchTextField? = if (showSearch) SearchTextField(false) else null
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

    /**
     * Called when the user scrolls the list — a wheel turn, a scrollbar drag, or a click on the track.
     * A popup anchored to a row has to close then: the row moves out from under it, and the balloon
     * would otherwise sit pointing at whatever slid into its place.
     *
     * Deliberately not the scrollbar's every adjustment: a viewport laying out moves the same model,
     * and an owner that follows a row must keep doing so through a resize.
     */
    var onScroll: (() -> Unit)? = null

    init {
        view.onSelect = onSelect
        // The row and button under the pointer move with every scroll, including a programmatic
        // relayout, so their hover is always cleared. Only real user gestures count as scrolling for
        // [onScroll]: a viewport laying out — a balloon resizing, a relayout — updates the scrollbar
        // model too, and an owner such as the prompt navigator must not mistake that for the user taking
        // over the list and drop its pending reveal.
        scroll.verticalScrollBar.addAdjustmentListener { event ->
            view.resetHover()
            if (event.valueIsAdjusting) onScroll?.invoke()
        }
        scroll.addMouseWheelListener { onScroll?.invoke() }
        view.list.addMouseWheelListener { onScroll?.invoke() }
        // ScrollingUtil's page/home/end bindings move the viewport without changing the selection, so
        // the selection callback does not cover them. Treat those keys as the user taking over too.
        view.list.addKeyListener(object : KeyAdapter() {
            override fun keyPressed(e: KeyEvent) {
                if (e.keyCode == KeyEvent.VK_PAGE_UP ||
                    e.keyCode == KeyEvent.VK_PAGE_DOWN ||
                    e.keyCode == KeyEvent.VK_HOME ||
                    e.keyCode == KeyEvent.VK_END
                ) {
                    onScroll?.invoke()
                }
            }
        })
        scroll.verticalScrollBar.addMouseListener(object : MouseAdapter() {
            override fun mousePressed(e: MouseEvent) {
                onScroll?.invoke()
            }
        })
        // Center the scroll pane so the list fills the panel vertically and horizontally, with the
        // search field pinned above it.
        if (surface == ActiveSurface.ToolWindow) isOpaque = true
        search?.let {
            it.textEditor.emptyText.text = placeholder
            wireActiveListSearch(it, view)
            addToTop(it)
            scroll.border = JBUI.Borders.emptyTop(UiStyle.Gap.SM)
        } ?: run { scroll.border = JBUI.Borders.empty() }
        addToCenter(scroll)
    }

    override fun getBackground(): Color {
        if (surface == ActiveSurface.ToolWindow) return activeToolWindowBackground()
        return super.getBackground() ?: UIUtil.getPanelBackground()
    }

    @RequiresEdt
    fun update(items: List<ActiveItem>, selection: ActiveSelection = ActiveSelection.Preserve) {
        view.update(items, selection)
    }

    @RequiresEdt
    fun filter(query: String) {
        view.filter(query)
    }

    /** The scroll pane's viewport, for owners that must track its extent. */
    @RequiresEdt
    internal fun viewport(): JViewport = scroll.viewport

    @RequiresEdt
    fun select(key: String, scroll: Boolean = true): Boolean = view.select(key, scroll)

    /** True when row [index] is entirely inside the viewport. */
    @RequiresEdt
    fun indexFullyVisible(index: Int): Boolean = view.indexFullyVisible(index)

    @RequiresEdt
    fun selectIndex(index: Int) = view.selectIndex(index)

    /** Steps the selection by [step] visible rows, clamped to the ends of the list. */
    @RequiresEdt
    fun move(step: Int) = view.move(step)

    @RequiresEdt
    fun selectedIndex(): Int = view.selectedIndex()

    @RequiresEdt
    fun selected(): ActiveItem? = view.selected()

    @RequiresEdt
    fun clearSelection() = view.clearSelection()

    @RequiresEdt
    fun selectedItems(): List<ActiveItem> = view.selectedItems()

    @RequiresEdt
    fun selectedKeys(): List<String> = view.selectedKeys()

    @RequiresEdt
    fun point(key: String, cell: String? = null): RelativePoint = view.point(key, cell)

    /** See [ActiveListView.hoveredBounds]. */
    @RequiresEdt
    fun hoveredBounds(pane: JComponent): Rectangle? = view.hoveredBounds(pane)

    /** See [ActiveListView.visibleBounds]. */
    @RequiresEdt
    fun visibleBounds(pane: JComponent): Rectangle? = view.visibleBounds(pane)

    @RequiresEdt
    fun focusList() = view.focusList()

    @RequiresEdt
    fun setEmptyText(text: String) = view.setEmptyText(text)

    @RequiresEdt
    fun installPopup(group: ActionGroup) = PopupHandler.installPopupMenu(view.list, group, ActionPlaces.POPUP)

    @RequiresEdt
    fun setListCursor(cursor: Cursor) {
        view.setBaseCursor(cursor)
    }

    @RequiresEdt
    fun setSelectionIndices(indices: IntArray) {
        view.setSelectionIndices(indices)
    }

    @RequiresEdt
    fun preferredFocus(): JComponent = view.list

    /**
     * Preferred height of this whole list at [width], including every rendered cell and scroll-pane
     * chrome. Unlike ordinary Swing preferred-size measurement this is safe before the list enters a
     * viewport, when wrapped cells do not have their final width yet.
     */
    @RequiresEdt
    fun preferredHeight(width: Int): Int {
        val own = insets
        val pane = scroll.insets
        val port = scroll.viewportBorder?.getBorderInsets(scroll) ?: JBUI.emptyInsets()
        val room = (width - own.left - own.right - pane.left - pane.right - port.left - port.right)
            .coerceAtLeast(1)
        val rows = view.preferredRowsHeight(room)
        val search = search?.preferredSize?.height ?: 0
        return own.top + own.bottom + search + pane.top + pane.bottom + port.top + port.bottom + rows
    }

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
        if (!select(key)) return
        val value = current(key) ?: return
        editName(point(key, cell), ActiveEditOptions(value)) { name -> commit(key, name) }
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
    fun setBusy(value: Boolean) {
        search?.isEnabled = !value
        search?.textEditor?.isEnabled = !value
        view.setBusy(value)
    }

    /** [ActiveListView.setLocked]: blocks input without painting the busy spinner. */
    @RequiresEdt
    fun setLocked(value: Boolean) {
        search?.isEnabled = !value
        search?.textEditor?.isEnabled = !value
        view.setLocked(value)
    }
}

internal fun activeListEnterFocus(): Boolean = AdvancedSettings.getBoolean("edit.source.on.enter.key.request.focus.in.editor")

internal fun wireActiveListSearch(search: SearchTextField, view: ActiveListView) {
    search.textEditor.registerKeyboardAction(
        { view.primary() },
        KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
        JComponent.WHEN_FOCUSED,
    )
    search.textEditor.registerKeyboardAction(
        { view.move(-1) },
        KeyStroke.getKeyStroke(KeyEvent.VK_UP, 0),
        JComponent.WHEN_FOCUSED,
    )
    search.textEditor.registerKeyboardAction(
        { view.move(1) },
        KeyStroke.getKeyStroke(KeyEvent.VK_DOWN, 0),
        JComponent.WHEN_FOCUSED,
    )
    search.textEditor.document.addDocumentListener(object : DocumentAdapter() {
        override fun textChanged(e: DocumentEvent) {
            view.filter(search.text)
        }
    })
}
