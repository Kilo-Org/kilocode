package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.UiStyle
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
import java.awt.event.KeyEvent
import javax.swing.JComponent
import javax.swing.KeyStroke
import javax.swing.ScrollPaneConstants
import javax.swing.UIManager
import javax.swing.event.DocumentEvent

internal enum class ActiveListSurface {
    Default,
    ToolWindow,
}

internal fun activeListToolWindowBackground(): Color = UIManager.getColor("ToolWindow.background") ?: UIUtil.getPanelBackground()

internal class ActiveList(
    emptyText: String,
    cfg: ActiveListConfig = ActiveListConfig.Equal,
    private val surface: ActiveListSurface = ActiveListSurface.Default,
    showSearch: Boolean = true,
    placeholder: String = "",
    onCell: (String, String) -> Unit,
    onOpen: ((ActiveListItem, Boolean) -> Unit)? = null,
    matcher: (String, ActiveListItem) -> Boolean = ::activeListMatches,
    enter: () -> Boolean = ::activeListEnterFocus,
    openOnClick: Boolean = true,
    onActivate: ((ActiveListItem) -> Unit)? = null,
    onClick: ((ActiveListItem) -> Unit)? = null,
    onSelect: (() -> Unit)? = null,
    menu: ActiveListMenu<*>? = null,
    reorder: ActiveListReorder? = null,
) : BorderLayoutPanel() {
    private val view = ActiveListView(emptyText, cfg, surface, matcher, enter, openOnClick, onOpen, onActivate, onClick, menu, reorder, onCell)
    private val search: SearchTextField? = if (showSearch) SearchTextField(false) else null
    private val scroll = object : JBScrollPane(view) {
        override fun getBackground(): Color {
            if (surface == ActiveListSurface.ToolWindow) return activeListToolWindowBackground()
            return super.getBackground() ?: UIUtil.getPanelBackground()
        }
    }.apply {
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        viewportBorder = JBUI.Borders.empty()
        if (surface == ActiveListSurface.ToolWindow) viewport.background = activeListToolWindowBackground()
    }

    init {
        view.onSelect = onSelect
        // Center the scroll pane so the list fills the panel vertically and horizontally, with the
        // search field pinned above it.
        if (surface == ActiveListSurface.ToolWindow) isOpaque = true
        search?.let {
            it.textEditor.emptyText.text = placeholder
            wireActiveListSearch(it, view)
            addToTop(it)
            scroll.border = JBUI.Borders.emptyTop(UiStyle.Gap.sm())
        } ?: run { scroll.border = JBUI.Borders.empty() }
        addToCenter(scroll)
    }

    override fun getBackground(): Color {
        if (surface == ActiveListSurface.ToolWindow) return activeListToolWindowBackground()
        return super.getBackground() ?: UIUtil.getPanelBackground()
    }

    @RequiresEdt
    fun update(items: List<ActiveListItem>, selection: ActiveListSelection = ActiveListSelection.Preserve) {
        view.update(items, selection)
    }

    @RequiresEdt
    fun filter(query: String) {
        view.filter(query)
    }

    @RequiresEdt
    fun select(key: String, scroll: Boolean = true): Boolean = view.select(key, scroll)

    @RequiresEdt
    fun selectIndex(index: Int) = view.selectIndex(index)

    /** Steps the selection by [step] visible rows, clamped to the ends of the list. */
    @RequiresEdt
    fun move(step: Int) = view.move(step)

    @RequiresEdt
    fun selectedIndex(): Int = view.selectedIndex()

    @RequiresEdt
    fun selected(): ActiveListItem? = view.selected()

    @RequiresEdt
    fun clearSelection() = view.clearSelection()

    @RequiresEdt
    fun selectedItems(): List<ActiveListItem> = view.selectedItems()

    @RequiresEdt
    fun selectedKeys(): List<String> = view.selectedKeys()

    @RequiresEdt
    fun point(key: String, cell: String? = null): RelativePoint = view.point(key, cell)

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

    @RequiresEdt
    fun trackBalloon(balloon: Balloon) = view.trackBalloon(balloon)

    @RequiresEdt
    fun confirmDelete(anchor: RelativePoint, opts: ActiveListDeleteOptions, confirm: (Boolean) -> Unit) {
        trackBalloon(showActiveListDeletePopup(anchor, opts, confirm))
    }

    @RequiresEdt
    fun editName(anchor: RelativePoint, opts: ActiveListEditOptions, commit: (String) -> Unit) {
        trackBalloon(showActiveListEditPopup(anchor, opts, commit))
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
        editName(point(key, cell), ActiveListEditOptions(value)) { name -> commit(key, name) }
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
