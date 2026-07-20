package ai.kilocode.client.settings.base

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionToolbar
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.application.ApplicationManager
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.SearchTextField
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.event.KeyEvent
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.KeyStroke
import javax.swing.ListSelectionModel
import javax.swing.event.DocumentEvent

/**
 * Lightweight embedded settings list layout: toolbar, filter text field, then list.
 *
 * Use [SettingsListPanel] for full async settings pages. Use this class for retained inline lists
 * embedded inside an existing settings form.
 */
internal abstract class SettingsInlineListPanel(
    emptyText: String,
    cfg: SettingsListConfig = SettingsListConfig.Equal,
    private val selectionMode: Int = ListSelectionModel.SINGLE_SELECTION,
    private val showSearch: Boolean = true,
) : BaseContentPanel() {
    private val search = SearchTextField(false)
    protected val view = SettingsListView(emptyText, cfg) { key, cellId -> onCell(key, cellId) }
    private var toolbar: ActionToolbar? = null

    @RequiresEdt
    protected fun start() {
        checkEdt()
        view.list.selectionMode = selectionMode
        view.minimumSize = JBUI.size(0, minListHeight())
        view.list.minimumSize = JBUI.size(0, minListHeight())
        view.onSelect = { toolbar?.updateActionsImmediately() }
        next(toolbarRow())
        gap(UiStyle.Gap.sm())
        if (showSearch) {
            search.textEditor.emptyText.text = searchPlaceholder()
            next(search)
            gap(UiStyle.Gap.sm())
            wireSearch()
        }
        next(view)
    }

    /** Filter list rows by [query]. Used by an external search field when the list hides its own. */
    @RequiresEdt
    fun filter(query: String) {
        checkEdt()
        view.filter(query)
    }

    @RequiresEdt
    fun setItems(items: List<SettingsListItem>, enabled: Boolean) {
        checkEdt()
        view.update(items, SettingsListSelection.PreserveNoScroll)
        setEnabled(enabled)
        toolbar?.updateActionsImmediately()
    }

    @RequiresEdt
    protected fun selectedKeys(): List<String> {
        checkEdt()
        return view.list.selectedValuesList.map { it.key }
    }

    override fun setEnabled(enabled: Boolean) {
        super.setEnabled(enabled)
        if (showSearch) {
            search.isEnabled = enabled
            search.textEditor.isEnabled = enabled
        }
        view.isEnabled = enabled
        view.setBusy(!enabled)
        toolbar?.updateActionsImmediately()
    }

    override fun getPreferredSize(): Dimension {
        val base = super.getPreferredSize()
        val missing = maxOf(0, minListHeight() - view.preferredSize.height)
        return Dimension(base.width, base.height + missing)
    }

    override fun getMinimumSize(): Dimension = preferredSize

    protected abstract fun onCell(key: String, cellId: String)

    protected open fun toolbarActions(): List<AnAction> = emptyList()

    protected open fun toolbarRight(): JComponent? = null

    protected open fun searchPlaceholder(): String = ""

    private fun toolbarRow(): JComponent {
        val row = JPanel(BorderLayout())
        UiStyle.Components.transparent(row)
        toolbar = ActionManager.getInstance().createActionToolbar(
            ActionPlaces.TOOLBAR,
            DefaultActionGroup(toolbarActions()),
            true,
        ).apply {
            targetComponent = this@SettingsInlineListPanel
            updateActionsImmediately()
        }
        row.add(toolbar!!.component, BorderLayout.WEST)
        toolbarRight()?.let { row.add(it, BorderLayout.EAST) }
        return row
    }

    private fun wireSearch() {
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

    private fun checkEdt() {
        check(ApplicationManager.getApplication().isDispatchThread) { "Settings inline list updates must run on EDT" }
    }

    private fun minListHeight() = UiStyle.Gap.xl() + UiStyle.Gap.pad()
}
