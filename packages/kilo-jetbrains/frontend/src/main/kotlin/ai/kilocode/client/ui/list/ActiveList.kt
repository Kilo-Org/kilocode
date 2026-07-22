package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.SearchTextField
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
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
    matcher: (String, ActiveListItem) -> Boolean = ::activeListMatches,
    onActivate: ((ActiveListItem) -> Unit)? = null,
) : Stack(StackAxis.VERTICAL) {
    val view = ActiveListView(emptyText, cfg, matcher, onActivate, onCell)
    val search: SearchTextField? = if (showSearch) SearchTextField(false) else null

    init {
        search?.let {
            it.textEditor.emptyText.text = placeholder
            wireActiveListSearch(it, view)
            next(it)
            gap(UiStyle.Gap.sm())
        }
        next(JBScrollPane(view).apply {
            border = null
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        })
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
