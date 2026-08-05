package ai.kilocode.client.session.history

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.ui.LoadingPanel
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.ui.list.ACTIVE_LIST_DELETE_CELL
import ai.kilocode.client.ui.list.ACTIVE_LIST_RENAME_CELL
import ai.kilocode.client.ui.list.ActiveList
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListDeleteOptions
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import com.intellij.icons.AllIcons
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.DataProvider
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.SearchTextField
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.tabs.JBTabs
import com.intellij.ui.tabs.JBTabsFactory
import com.intellij.ui.tabs.JBTabsPosition
import com.intellij.ui.tabs.TabInfo
import com.intellij.ui.tabs.TabsListener
import com.intellij.util.concurrency.annotations.RequiresEdt
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
    private val timers: UiTimerSource = UiTimers,
) : BorderLayoutPanel(), Disposable, DataProvider {
    private val localSearch = search(controller.local)
    private val cloudSearch = search(controller.cloud)
    private var snapshot = HistoryActivitySnapshot()
    private var localRows = emptyList<LocalHistoryRow>()
    private var cloudRows = emptyList<CloudHistoryRow>()
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
    private val timer = timers.timer(ACTIVITY_MS) { syncActivity() }
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
        border = JBUI.Borders.empty(UiStyle.Gap.lg(), UiStyle.Gap.lg(), UiStyle.Gap.lg(), 0)
        more.addActionListener { controller.loadMoreCloud() }
        bind(controller.local)
        bind(controller.cloud)
        bindTheme()
        controller.onRepoOnlyChanged = { value ->
            repoOnly.isSelected = value
        }
        addHierarchyListener { e ->
            if (e.changeFlags and HierarchyEvent.SHOWING_CHANGED.toLong() == 0L) return@addHierarchyListener
            if (isShowing) {
                syncActivity()
                timer.start()
                if (stale) refresh()
                return@addHierarchyListener
            }
            timer.stop()
            stale = true
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
        sync()
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
            { activeList().selected()?.let(::activate) },
            KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
    }

    private fun back(): JComponent {
        val label = KiloBundle.message("history.back")
        val btn = HoverIcon().apply {
            icon = AllIcons.Actions.Back
            toolTipText = label
            accessibleContext.accessibleName = label
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            addActionListener { nav() }
        }
        return btn.align(HAlign.LEFT, VAlign.CENTER).apply {
            border = JBUI.Borders.emptyRight(UiStyle.Gap.lg())
        }
    }

    private fun panel(search: SearchTextField, list: ActiveList, footer: JComponent? = null): JComponent {
        return BorderLayoutPanel().apply {
            val north = BorderLayoutPanel().apply {
                add(search, BorderLayout.CENTER)
                if (list === cloudList) add(repoOnly, BorderLayout.SOUTH)
                border = JBUI.Borders.emptyRight(UiStyle.Gap.lg())
            }
            add(north, BorderLayout.NORTH)
            add(BorderLayoutPanel().apply {
                border = JBUI.Borders.emptyRight(UiStyle.Gap.lg())
                addToCenter(list)
            }, BorderLayout.CENTER)
            footer?.let {
                add(Centerizer(it, Centerizer.TYPE.HORIZONTAL).apply {
                    border = JBUI.Borders.emptyTop(UiStyle.Gap.lg())
                }, BorderLayout.SOUTH)
            }
        }
    }

    private fun localList() = ActiveList(
        KiloBundle.message("history.empty"),
        cfg = ActiveListConfig(selection = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION, hoverActions = true),
        showSearch = false,
        openOnClick = false,
        onCell = { key, id ->
            val item = localRows.firstOrNull { it.key == key }?.item ?: return@ActiveList
            when (id) {
                ACTIVE_LIST_RENAME_CELL -> beginRename(item, id)
                ACTIVE_LIST_DELETE_CELL -> showDeletePopup(listOf(item), id)
            }
        },
        onOpen = { row, _ -> activate(row) },
    ).apply {
        setListCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR))
        installContextMenu(this)
    }

    private fun cloudList() = ActiveList(
        KiloBundle.message("history.empty"),
        cfg = ActiveListConfig(selection = ListSelectionModel.SINGLE_SELECTION),
        showSearch = false,
        openOnClick = false,
        onCell = { _, _ -> },
        onOpen = { row, _ -> activate(row) },
    ).apply {
        setListCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR))
        installContextMenu(this)
    }

    private fun bind(model: HistoryModel<out HistoryItem>) {
        val listener = object : ListDataListener {
            override fun intervalAdded(e: ListDataEvent) = sync()

            override fun intervalRemoved(e: ListDataEvent) = sync()

            override fun contentsChanged(e: ListDataEvent) = sync()
        }
        model.addListDataListener(listener)
        Disposer.register(this) { model.removeListDataListener(listener) }
    }

    private fun sync() {
        syncRows()
        syncList(localList, controller.local)
        syncList(cloudList, controller.cloud)
        more.isEnabled = controller.cloud.cursor != null && !controller.cloud.loading
        more.isVisible = controller.cloud.cursor != null || controller.cloud.loading
        repoOnly.isVisible = controller.gitUrl != null
        cards.show(body, if (loading()) CARD_LOAD else CARD_TABS)
        revalidate()
        repaint()
    }

    private fun syncRows() {
        localRows = localHistoryRows(controller.local.visibleItems, snapshot, controller::deleting)
        cloudRows = cloudHistoryRows(controller.cloud.visibleItems, snapshot)
        restore(localList, localRows)
        restore(cloudList, cloudRows)
    }

    /**
     * Rebuilds [list] while keeping selection stable. Surviving selected rows stay selected; when a
     * selected row disappears (e.g. it was just deleted) selection slides to the row that took its
     * slot — the following row, or the last row when the removed one was last — so the highlight
     * moves naturally instead of vanishing. Selection clears only when nothing was selected or the
     * list is now empty.
     */
    private fun restore(list: ActiveList, rows: List<ActiveListItem>) {
        val keys = list.selectedKeys()
        val anchor = list.selectedIndex()
        list.update(rows, ActiveListSelection.PreserveNoScroll)
        val indices = keys.mapNotNull { key -> rows.indexOfFirst { it.key == key }.takeIf { it >= 0 } }.toIntArray()
        if (indices.isNotEmpty()) {
            list.setSelectionIndices(indices)
            return
        }
        if (keys.isNotEmpty() && rows.isNotEmpty()) {
            list.selectIndex(anchor.coerceIn(0, rows.size - 1))
            return
        }
        list.clearSelection()
    }

    @RequiresEdt
    internal fun syncActivity() {
        val next = HistoryActivitySnapshot(
            activity = manager?.activity() ?: controller.activity(),
            titles = manager?.titles().orEmpty(),
        )
        if (snapshot.changed(next).isEmpty()) return
        snapshot = next
        syncRows()
    }

    private fun loading(): Boolean {
        if (controller.local.loaded || controller.cloud.loaded) return false
        return controller.local.loading || controller.cloud.loading
    }

    private fun syncList(list: ActiveList, model: HistoryModel<out HistoryItem>) {
        list.setBusy(model.loading)
        list.setEmptyText(when {
            model.loading -> KiloBundle.message("history.loading")
            model.error != null -> model.error.orEmpty()
            else -> KiloBundle.message("history.empty")
        })
    }

    private fun activate(row: ActiveListItem) {
        when (row) {
            is LocalHistoryRow -> controller.open(row.item)
            is CloudHistoryRow -> controller.open(row.item)
        }
    }

    override fun getData(dataId: String): Any? {
        if (SessionManager.KEY.`is`(dataId)) return manager
        if (HistoryDataKeys.CONTROLLER.`is`(dataId)) return controller
        if (HistoryDataKeys.RENAME.`is`(dataId)) return { item: LocalHistoryItem -> beginRename(item) }
        if (HistoryDataKeys.SELECTION.`is`(dataId)) {
            val source = selectedSource()
            val local = if (source == HistorySource.LOCAL) {
                localList.selectedItems().filterIsInstance<LocalHistoryRow>().map { it.item }
            } else {
                emptyList()
            }
            val cloud = if (source == HistorySource.CLOUD) {
                cloudList.selectedItems().filterIsInstance<CloudHistoryRow>().map { it.item }
            } else {
                emptyList()
            }
            return HistorySelection(source, local, cloud)
        }
        return null
    }

    private fun installContextMenu(list: ActiveList) {
        val group = ActionManager.getInstance().getAction("Kilo.History.ContextMenu")
        if (group is ActionGroup) list.installPopup(group)
    }

    private fun showDeletePopup(items: List<LocalHistoryItem>, cell: String? = null) {
        val active = items.filter { !controller.deleting(it) }
        if (active.isEmpty()) return
        val msg = if (active.size == 1) {
            KiloBundle.message("history.delete.confirm.message", title(active[0]))
        } else {
            KiloBundle.message("history.delete.confirm.message.multiple", active.size)
        }
        controller.requestDelete(active.size)
        localList.confirmDelete(
            localList.point(active[0].id, cell),
            ActiveListDeleteOptions(message = msg),
        ) { active.forEach(controller::delete) }
    }

    internal fun confirmDelete(items: List<LocalHistoryItem>) {
        showDeletePopup(items)
    }

    /**
     * Opens the inline rename popover anchored to [item]'s row (or its pencil cell), matching the
     * worktree list. Committing sends the new title through the controller; the popover itself gates
     * out blank and unchanged names, so no modal dialog is involved.
     */
    private fun beginRename(item: LocalHistoryItem, cell: String? = null) {
        controller.requestRename()
        localList.rename(
            item.id,
            cell,
            current = { title(item) },
            commit = { _, name -> controller.rename(item, name) },
        )
    }

    internal fun itemCount() = activeRows().size

    internal fun selectedSource() = if (tabs.selectedInfo === cloudInfo) HistorySource.CLOUD else HistorySource.LOCAL

    internal fun select(index: Int) {
        activeList().selectIndex(index)
    }

    internal fun selectIndices(vararg indices: Int) {
        activeList().setSelectionIndices(indices)
    }

    internal fun selectedIndex() = activeList().selectedIndex()

    internal fun listFocusable() = activeList().preferredFocus().isFocusable

    internal fun listSelectionMode() = (activeList().preferredFocus() as javax.swing.JList<*>).selectionMode

    internal fun loadMoreFocusable() = more.isFocusable

    internal fun listCursor() = activeList().preferredFocus().cursor.type

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
        val items = localList.selectedItems().filterIsInstance<LocalHistoryRow>().map { it.item }
        showDeletePopup(items)
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

    internal fun groupTitles(): List<String> = activeRows().mapNotNull { it.section }

    internal fun runningBadgeVisible(index: Int): Boolean = activeRows().getOrNull(index)?.badges?.isNotEmpty() == true

    internal fun badgeText(index: Int): String? = activeRows().getOrNull(index)?.badges?.firstOrNull()?.text

    internal fun titleText(index: Int): String? = activeRows().getOrNull(index)?.title

    internal fun repoOnlyVisible() = repoOnly.isVisible

    internal fun repoOnlySelected() = repoOnly.isSelected

    internal fun clickRepoOnly() {
        repoOnly.doClick()
    }

    private fun activeList(): ActiveList = if (tabs.selectedInfo === cloudInfo) cloudList else localList

    private fun activeRows(): List<ActiveListItem> = if (tabs.selectedInfo === cloudInfo) cloudRows else localRows

    private fun activeSearch(): SearchTextField = if (tabs.selectedInfo === cloudInfo) cloudSearch else localSearch

    private fun activeInfo(): TabInfo = if (tabs.selectedInfo === cloudInfo) cloudInfo else localInfo

    private fun move(step: Int) {
        val size = itemCount()
        if (size <= 0) return
        val cur = selectedIndex().takeIf { it >= 0 } ?: if (step > 0) -1 else size
        val idx = (cur + step).coerceIn(0, size - 1)
        activeList().selectIndex(idx)
    }

    override fun dispose() {
        timer.stop()
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
        const val ACTIVITY_MS = 3_000
    }
}
