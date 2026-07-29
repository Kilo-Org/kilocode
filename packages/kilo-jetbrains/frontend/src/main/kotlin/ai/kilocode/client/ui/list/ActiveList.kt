package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.SearchTextField
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.event.KeyEvent
import javax.swing.JComponent
import javax.swing.KeyStroke
import javax.swing.ScrollPaneConstants
import javax.swing.event.DocumentEvent

internal class ActiveList(
    emptyText: String,
    cfg: ActiveListConfig = ActiveListConfig.Equal,
    showSearch: Boolean = true,
    placeholder: String = "",
    onCell: (String, String) -> Unit,
    onOpen: ((ActiveListItem, Boolean) -> Unit)? = null,
    matcher: (String, ActiveListItem) -> Boolean = ::activeListMatches,
    onActivate: ((ActiveListItem) -> Unit)? = null,
    onClick: ((ActiveListItem) -> Unit)? = null,
    onSelect: (() -> Unit)? = null,
) : BorderLayoutPanel() {
    private val view = ActiveListView(emptyText, cfg, matcher, onOpen, onActivate, onClick, onCell)
    private val search: SearchTextField? = if (showSearch) SearchTextField(false) else null

    init {
        view.onSelect = onSelect
        // Center the scroll pane so the list fills the panel vertically and horizontally, with the
        // search field pinned above it.
        val scroll = JBScrollPane(view).apply {
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        }
        search?.let {
            it.textEditor.emptyText.text = placeholder
            wireActiveListSearch(it, view)
            addToTop(it)
            scroll.border = JBUI.Borders.emptyTop(UiStyle.Gap.sm())
        } ?: run { scroll.border = JBUI.Borders.empty() }
        addToCenter(scroll)
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

    @RequiresEdt
    fun selectedIndex(): Int = view.selectedIndex()

    @RequiresEdt
    fun selected(): ActiveListItem? = view.selected()

    @RequiresEdt
    fun selectedItems(): List<ActiveListItem> = view.selectedItems()

    @RequiresEdt
    fun selectedKeys(): List<String> = view.selectedKeys()

    @RequiresEdt
    fun point(key: String, cell: String? = null): RelativePoint = view.point(key, cell)

    @RequiresEdt
    fun focusList() = view.focusList()

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
