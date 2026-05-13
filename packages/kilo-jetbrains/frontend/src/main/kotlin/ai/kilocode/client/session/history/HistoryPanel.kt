package ai.kilocode.client.session.history

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.LoadingPanel
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.ide.ui.LafManagerListener
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.util.Disposer
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.ListUtil
import com.intellij.ui.SearchTextField
import com.intellij.ui.ScrollingUtil
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.tabs.JBTabs
import com.intellij.ui.tabs.JBTabsFactory
import com.intellij.ui.tabs.JBTabsPosition
import com.intellij.ui.tabs.TabInfo
import com.intellij.ui.tabs.TabsListener
import com.intellij.util.ui.Centerizer
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.CardLayout
import java.awt.Cursor
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.HierarchyEvent
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JList
import javax.swing.KeyStroke
import javax.swing.ListSelectionModel
import javax.swing.SwingUtilities
import javax.swing.event.DocumentEvent
import javax.swing.event.ListDataEvent
import javax.swing.event.ListDataListener

class HistoryPanel(
    parent: Disposable,
    private val controller: HistoryController,
    private val gitUrl: () -> String? = { null },
    private val nav: () -> Unit = {},
) : BorderLayoutPanel(), Disposable {
    private val localSearch = search(controller.local)
    private val cloudSearch = search(controller.cloud)
    private val localList = localList()
    private val cloudList = cloudList()
    private val more = LoadMoreButton()
    private val localPanel = panel(localSearch, localList)
    private val cloudPanel = panel(cloudSearch, cloudList, more)
    private val cards = CardLayout()
    private val body = BorderLayoutPanel().apply { layout = cards }
    private val load = LoadingPanel()
    private val localInfo = TabInfo(localPanel)
        .setText(KiloBundle.message("history.tab.local"))
        .setForeSideComponent(back())
    private val cloudInfo = TabInfo(cloudPanel)
        .setText(KiloBundle.message("history.tab.cloud"))
        .setForeSideComponent(back())
    private var stale = false
    private val tabs: JBTabs = JBTabsFactory.createTabs(null, this).apply {
        presentation.setSingleRow(true)
        presentation.setTabsPosition(JBTabsPosition.top)
        presentation.showBorder = false
        addTab(localInfo).setPreferredFocusableComponent(localSearch.textEditor)
        addTab(cloudInfo).setPreferredFocusableComponent(cloudSearch.textEditor)
        addListener(object : TabsListener {
            override fun selectionChanged(oldSelection: TabInfo?, newSelection: TabInfo?) {
                sync()
            }
        }, this@HistoryPanel)
    }

    init {
        Disposer.register(parent, this)
        border = JBUI.Borders.empty(UiStyle.Gap.lg())
        more.addActionListener { controller.loadMoreCloud() }
        bind(localList, controller.local)
        bind(cloudList, controller.cloud)
        bindTheme()
        addHierarchyListener { e ->
            if (e.changeFlags and HierarchyEvent.SHOWING_CHANGED.toLong() == 0L) return@addHierarchyListener
            if (isShowing && stale) {
                refresh()
                return@addHierarchyListener
            }
            if (!isShowing) stale = true
        }
        body.add(load, CARD_LOAD)
        body.add(tabs.component, CARD_TABS)
        add(body, BorderLayout.CENTER)
        sync()
        refresh()
    }

    val component: JComponent get() = this

    val defaultFocusedComponent: JComponent get() = activeSearch().textEditor

    fun refresh() {
        stale = false
        updateTheme()
        controller.reload(gitUrl())
    }

    private fun bindTheme() {
        val bus = ApplicationManager.getApplication().messageBus.connect(this)
        bus.subscribe(LafManagerListener.TOPIC, LafManagerListener {
            ApplicationManager.getApplication().invokeLater {
                updateTheme()
            }
        })
    }

    private fun updateTheme() {
        SwingUtilities.updateComponentTreeUI(this)
        SwingUtilities.updateComponentTreeUI(localPanel)
        SwingUtilities.updateComponentTreeUI(cloudPanel)
        load.applyStyle(SessionEditorStyle.current())
        updateRenderer(localList)
        updateRenderer(cloudList)
        sync()
    }

    private fun updateRenderer(list: JBList<out HistoryItem>) {
        val view = list.cellRenderer
        if (view is JComponent) SwingUtilities.updateComponentTreeUI(view)
    }

    private fun search(model: HistoryModel<out HistoryItem>) = SearchTextField(false).apply {
        textEditor.emptyText.text = KiloBundle.message("history.search.placeholder")
        textEditor.document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(e: DocumentEvent) {
                model.setFilter(text)
            }
        })
        textEditor.registerKeyboardAction(
            { move(-1) },
            KeyStroke.getKeyStroke(KeyEvent.VK_UP, 0),
            JComponent.WHEN_FOCUSED,
        )
        textEditor.registerKeyboardAction(
            { move(1) },
            KeyStroke.getKeyStroke(KeyEvent.VK_DOWN, 0),
            JComponent.WHEN_FOCUSED,
        )
        textEditor.registerKeyboardAction(
            { activeList().selectedValue?.let(::activate) },
            KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
    }

    private fun back() = BorderLayoutPanel().apply {
        add(JButton(KiloBundle.message("history.back"), AllIcons.Actions.Back).apply {
            putClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY, true)
            isFocusable = false
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            addActionListener { nav() }
        }, BorderLayout.WEST)
        border = JBUI.Borders.emptyRight(UiStyle.Gap.lg())
    }

    private fun panel(search: SearchTextField, list: JList<out HistoryItem>, footer: JComponent? = null): JComponent {
        return BorderLayoutPanel().apply {
            add(search, BorderLayout.NORTH)
            add(JBScrollPane(list).apply {
                border = JBUI.Borders.empty()
                viewportBorder = JBUI.Borders.empty()
            }, BorderLayout.CENTER)
            footer?.let {
                add(Centerizer(it, Centerizer.TYPE.HORIZONTAL).apply {
                    border = JBUI.Borders.emptyTop(UiStyle.Gap.lg())
                }, BorderLayout.SOUTH)
            }
        }
    }

    private fun localList() = JBList(controller.local).apply {
        selectionMode = ListSelectionModel.SINGLE_SELECTION
        isFocusable = false
        cellRenderer = LocalHistoryRenderer(controller.local)
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        emptyText.text = KiloBundle.message("history.empty")
        addMouseListener(object : MouseAdapter() {
            override fun mouseReleased(e: MouseEvent) {
                if (!UIUtil.isActionClick(e, MouseEvent.MOUSE_RELEASED, true)) return
                val item = clicked(this@apply, e) ?: return
                if (deleteClick(this@apply, e)) {
                    confirm(item)
                    e.consume()
                    return
                }
                activate(item)
            }
        })
        registerKeyboardAction(
            { selectedValue?.let(::activate) },
            KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
        ListUtil.installAutoSelectOnMouseMove(this)
        ScrollingUtil.installActions(this)
    }

    private fun cloudList() = JBList(controller.cloud).apply {
        selectionMode = ListSelectionModel.SINGLE_SELECTION
        isFocusable = false
        cellRenderer = CloudHistoryRenderer(controller.cloud)
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        emptyText.text = KiloBundle.message("history.empty")
        addMouseListener(object : MouseAdapter() {
            override fun mouseReleased(e: MouseEvent) {
                if (!UIUtil.isActionClick(e, MouseEvent.MOUSE_RELEASED, true)) return
                clicked(this@apply, e)?.let(::activate)
            }
        })
        registerKeyboardAction(
            { selectedValue?.let(::activate) },
            KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
        ListUtil.installAutoSelectOnMouseMove(this)
        ScrollingUtil.installActions(this)
    }

    private fun <T : HistoryItem> bind(list: JBList<T>, model: HistoryModel<T>) {
        val listener = object : ListDataListener {
            override fun intervalAdded(e: ListDataEvent) = sync()

            override fun intervalRemoved(e: ListDataEvent) = sync()

            override fun contentsChanged(e: ListDataEvent) = sync()
        }
        model.addListDataListener(listener)
        Disposer.register(this) { model.removeListDataListener(listener) }
        list.setPaintBusy(model.loading)
    }

    private fun sync() {
        syncList(localList, controller.local)
        syncList(cloudList, controller.cloud)
        more.isEnabled = controller.cloud.cursor != null && !controller.cloud.loading
        more.isVisible = controller.cloud.cursor != null || controller.cloud.loading
        cards.show(body, if (loading()) CARD_LOAD else CARD_TABS)
        revalidate()
        repaint()
    }

    private fun loading(): Boolean {
        if (controller.local.loaded || controller.cloud.loaded) return false
        return controller.local.loading || controller.cloud.loading
    }

    private fun <T : HistoryItem> syncList(list: JBList<T>, model: HistoryModel<T>) {
        list.setPaintBusy(model.loading)
        list.emptyText.text = when {
            model.loading -> KiloBundle.message("history.loading")
            model.error != null -> model.error.orEmpty()
            else -> KiloBundle.message("history.empty")
        }
    }

    private fun deleteClick(list: JBList<LocalHistoryItem>, e: MouseEvent): Boolean {
        val row = list.locationToIndex(e.point)
        val box = row.takeIf { it >= 0 }?.let { list.getCellBounds(it, it) } ?: return false
        if (!box.contains(e.point)) return false
        return HistoryRenderer.isDeleteClick(list, box, e.point)
    }

    private fun activate(item: HistoryItem) {
        when (item) {
            is LocalHistoryItem -> controller.open(item)
            is CloudHistoryItem -> controller.open(item)
        }
    }

    private fun confirm(item: LocalHistoryItem) {
        if (controller.deleting(item)) return
        val result = Messages.showYesNoDialog(
            this,
            KiloBundle.message("history.delete.confirm.message", title(item)),
            KiloBundle.message("history.delete.confirm.title"),
            Messages.getWarningIcon(),
        )
        if (result != Messages.YES) return
        controller.delete(item)
    }

    internal fun itemCount() = activeModel().size

    internal fun selectedSource() = if (tabs.selectedInfo === cloudInfo) HistorySource.CLOUD else HistorySource.LOCAL

    internal fun select(index: Int) {
        activeList().selectedIndex = index
    }

    internal fun selectedIndex() = activeList().selectedIndex

    internal fun listFocusable() = activeList().isFocusable

    internal fun listCursor() = activeList().cursor.type

    internal fun backText(): String? {
        val view = activeInfo().foreSideComponent ?: return null
        return UIUtil.uiTraverser(view).filter(JButton::class.java).firstOrNull()?.text
    }

    internal fun backCursor(): Int? {
        val view = activeInfo().foreSideComponent ?: return null
        return UIUtil.uiTraverser(view).filter(JButton::class.java).firstOrNull()?.cursor?.type
    }

    internal fun clickBack() {
        val view = activeInfo().foreSideComponent ?: return
        UIUtil.uiTraverser(view).filter(JButton::class.java).firstOrNull()?.doClick()
    }

    internal fun clickDelete() {
        localList.selectedValue?.let(controller::delete)
    }

    internal fun clickCloud() {
        tabs.select(cloudInfo, false)
        sync()
    }

    internal fun clickLocal() {
        tabs.select(localInfo, false)
        sync()
    }

    internal fun clickMore() {
        more.doClick()
    }

    internal fun setSearch(value: String) {
        if (tabs.selectedInfo === cloudInfo) cloudSearch.text = value else localSearch.text = value
    }

    internal fun groupTitles(): List<String> {
        val items = activeModel().visibleItems
        return items.indices.mapNotNull { HistoryRenderer.section(items, it) }
    }

    internal fun deleteVisible(index: Int, selected: Boolean = true): Boolean {
        val item = controller.local.getElementAt(index)
        val view = localList.cellRenderer.getListCellRendererComponent(localList, item, index, selected, false)
        return view is HistoryRenderer<*> && view.deleteVisible()
    }

    internal fun cloudDeleteVisible(index: Int, selected: Boolean = true): Boolean {
        val item = controller.cloud.getElementAt(index)
        val view = cloudList.cellRenderer.getListCellRendererComponent(cloudList, item, index, selected, false)
        return view is HistoryRenderer<*> && view.deleteVisible()
    }

    private fun activeList(): JBList<out HistoryItem> = if (tabs.selectedInfo === cloudInfo) cloudList else localList

    private fun activeModel(): HistoryModel<out HistoryItem> = if (tabs.selectedInfo === cloudInfo) controller.cloud else controller.local

    private fun activeSearch(): SearchTextField = if (tabs.selectedInfo === cloudInfo) cloudSearch else localSearch

    private fun activeInfo(): TabInfo = if (tabs.selectedInfo === cloudInfo) cloudInfo else localInfo

    private fun move(step: Int) {
        val list = activeList()
        val size = list.model.size
        if (size <= 0) return
        val cur = list.selectedIndex.takeIf { it >= 0 } ?: if (step > 0) -1 else size
        val idx = (cur + step).coerceIn(0, size - 1)
        list.selectedIndex = idx
        ScrollingUtil.ensureIndexIsVisible(list, idx, 0)
    }

    override fun dispose() {
        // no-op
    }

    private class LoadMoreButton : JButton(KiloBundle.message("history.cloud.load.more")) {
        private var over = false

        init {
            isFocusable = false
            setRequestFocusEnabled(false)
            isContentAreaFilled = false
            isBorderPainted = false
            isOpaque = false
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            addMouseListener(object : MouseAdapter() {
                override fun mouseEntered(e: MouseEvent) {
                    sync(true)
                }

                override fun mouseExited(e: MouseEvent) {
                    sync(false)
                }
            })
        }

        override fun paintComponent(g: Graphics) {
            if (isEnabled && over) {
                val g2 = g.create() as Graphics2D
                try {
                    g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                    g2.color = JBUI.CurrentTheme.ActionButton.hoverBackground()
                    val arc = JBUI.scale(JBUI.getInt("Button.arc", 6))
                    g2.fillRoundRect(0, 0, width, height, arc, arc)
                } finally {
                    g2.dispose()
                }
            }
            super.paintComponent(g)
        }

        private fun sync(value: Boolean) {
            if (over == value) return
            over = value
            repaint()
        }
    }

    internal fun showingLoading() = !controller.local.loaded && !controller.cloud.loaded && (controller.local.loading || controller.cloud.loading)

    private companion object {
        const val CARD_LOAD = "load"
        const val CARD_TABS = "tabs"
    }
}
