package ai.kilocode.client.session.history

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.ui.LoadingPanel
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.iconButton
import com.intellij.icons.AllIcons
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.DataProvider
import com.intellij.openapi.util.Disposer
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.PopupHandler
import com.intellij.ui.SearchTextField
import com.intellij.ui.ScrollingUtil
import com.intellij.ui.components.JBCheckBox
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
    private val nav: () -> Unit = {},
    private val manager: SessionManager? = null,
) : BorderLayoutPanel(), Disposable, DataProvider {
    private val localSearch = search(controller.local)
    private val cloudSearch = search(controller.cloud)
    private val localList = localList()
    private val cloudList = cloudList()
    private val more = LoadMoreButton()
    private val repoOnly = JBCheckBox(KiloBundle.message("history.cloud.repo.only"), true).apply {
        isVisible = false
        border = JBUI.Borders.emptyLeft(UiStyle.Gap.lg())
        addActionListener { controller.applyRepoOnly(isSelected) }
    }
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
        controller.onRepoOnlyChanged = { value ->
            repoOnly.isSelected = value
        }
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
        controller.reload()
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

    private fun back(): BorderLayoutPanel {
        val label = KiloBundle.message("history.back")
        val btn = HoverIcon().apply {
            icon = AllIcons.Actions.Back
            toolTipText = label
            accessibleContext.accessibleName = label
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            addActionListener { nav() }
        }
        return BorderLayoutPanel().apply {
            add(btn, BorderLayout.WEST)
            border = JBUI.Borders.emptyRight(UiStyle.Gap.lg())
        }
    }

    private fun panel(search: SearchTextField, list: JList<out HistoryItem>, footer: JComponent? = null): JComponent {
        return BorderLayoutPanel().apply {
            val north = BorderLayoutPanel().apply {
                add(search, BorderLayout.CENTER)
                if (list === cloudList) {
                    add(repoOnly, BorderLayout.SOUTH)
                }
            }
            add(north, BorderLayout.NORTH)
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
        selectionMode = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION
        isFocusable = true
        cellRenderer = LocalHistoryRenderer(controller.local)
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        emptyText.text = KiloBundle.message("history.empty")
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                val row = locationToIndex(e.point)
                val box = row.takeIf { it >= 0 }?.let { getCellBounds(it, it) } ?: return
                if (!box.contains(e.point)) return
                if (e.clickCount == 1 && HistoryRenderer.isDeleteClick(this@apply, box, e.point)) {
                    val item = model.getElementAt(row)
                    confirm(item)
                } else if (e.clickCount == 2) {
                    selectedValue?.let(::activate)
                }
            }
        })
        registerKeyboardAction(
            { selectedValue?.let(::activate) },
            KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
        installContextMenu(this)
        ScrollingUtil.installActions(this)
    }

    private fun cloudList() = JBList(controller.cloud).apply {
        selectionMode = ListSelectionModel.SINGLE_SELECTION
        isFocusable = true
        cellRenderer = CloudHistoryRenderer(controller.cloud)
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        emptyText.text = KiloBundle.message("history.empty")
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount == 2) selectedValue?.let(::activate)
            }
        })
        registerKeyboardAction(
            { selectedValue?.let(::activate) },
            KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
        installContextMenu(this)
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
        repoOnly.isVisible = controller.gitUrl != null
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

    private fun activate(item: HistoryItem) {
        when (item) {
            is LocalHistoryItem -> controller.open(item)
            is CloudHistoryItem -> controller.open(item)
        }
    }

    override fun getData(dataId: String): Any? {
        if (SessionManager.KEY.`is`(dataId)) return manager
        if (HistoryDataKeys.CONTROLLER.`is`(dataId)) return controller
        if (HistoryDataKeys.SELECTION.`is`(dataId)) {
            val source = selectedSource()
            val local = if (source == HistorySource.LOCAL) localList.selectedValuesList.filterIsInstance<LocalHistoryItem>() else emptyList()
            val cloud = if (source == HistorySource.CLOUD) cloudList.selectedValuesList.filterIsInstance<CloudHistoryItem>() else emptyList()
            return HistorySelection(source, local, cloud)
        }
        return null
    }

    private fun installContextMenu(list: JBList<out HistoryItem>) {
        val group = ActionManager.getInstance().getAction("Kilo.History.ContextMenu")
        if (group is ActionGroup) {
            PopupHandler.installPopupMenu(list, group, ActionPlaces.POPUP)
        }
    }

    private fun confirm(item: LocalHistoryItem) {
        if (controller.deleting(item)) return
        val result = com.intellij.openapi.ui.Messages.showYesNoDialog(
            this,
            KiloBundle.message("history.delete.confirm.message", title(item)),
            KiloBundle.message("history.delete.confirm.title"),
            com.intellij.openapi.ui.Messages.getWarningIcon(),
        )
        if (result != com.intellij.openapi.ui.Messages.YES) return
        controller.delete(item)
    }

    internal fun confirmDelete(items: List<LocalHistoryItem>) {
        val active = items.filter { !controller.deleting(it) }
        if (active.isEmpty()) return
        val msg = if (active.size == 1)
            KiloBundle.message("history.delete.confirm.message", title(active[0]))
        else
            KiloBundle.message("history.delete.confirm.message.multiple", active.size)
        val result = com.intellij.openapi.ui.Messages.showYesNoDialog(
            this,
            msg,
            KiloBundle.message("history.delete.confirm.title"),
            com.intellij.openapi.ui.Messages.getWarningIcon(),
        )
        if (result != com.intellij.openapi.ui.Messages.YES) return
        active.forEach { controller.delete(it) }
    }

    internal fun itemCount() = activeModel().size

    internal fun selectedSource() = if (tabs.selectedInfo === cloudInfo) HistorySource.CLOUD else HistorySource.LOCAL

    internal fun select(index: Int) {
        activeList().selectedIndex = index
    }

    internal fun selectIndices(vararg indices: Int) {
        activeList().selectedIndices = indices
    }

    internal fun selectedIndex() = activeList().selectedIndex

    internal fun listFocusable() = activeList().isFocusable

    internal fun listSelectionMode() = activeList().selectionMode

    internal fun loadMoreFocusable() = more.isFocusable

    internal fun listCursor() = activeList().cursor.type

    internal fun backText(): String? {
        val view = activeInfo().foreSideComponent ?: return null
        return UIUtil.uiTraverser(view).filter(HoverIcon::class.java).firstOrNull()?.toolTipText
    }

    internal fun backCursor(): Int? {
        val view = activeInfo().foreSideComponent ?: return null
        return UIUtil.uiTraverser(view).filter(HoverIcon::class.java).firstOrNull()?.cursor?.type
    }

    internal fun clickBack() {
        val view = activeInfo().foreSideComponent ?: return
        UIUtil.uiTraverser(view).filter(HoverIcon::class.java).firstOrNull()?.doClick()
    }

    internal fun clickDelete() {
        val items = localList.selectedValuesList.filterIsInstance<LocalHistoryItem>()
        items.forEach { controller.delete(it) }
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

    internal fun repoOnlyVisible() = repoOnly.isVisible

    internal fun repoOnlySelected() = repoOnly.isSelected

    internal fun clickRepoOnly() {
        repoOnly.doClick()
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
        controller.onRepoOnlyChanged = null
    }

    private class LoadMoreButton : JButton(KiloBundle.message("history.cloud.load.more")) {
        private var over = false

        init {
            isFocusable = true
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
