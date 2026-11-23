package ai.kilocode.client.agentManager

import ai.kilocode.client.agentManager.worktree.attention
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SessionHost
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.history.HistorySection
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.ui.list.ActiveList
import ai.kilocode.client.ui.list.ActiveListOptions
import ai.kilocode.client.ui.list.ActiveSection
import ai.kilocode.client.ui.active.ActiveConfig
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveMenu
import ai.kilocode.client.ui.active.ActiveSelection
import ai.kilocode.client.ui.active.ActiveSurface
import ai.kilocode.client.ui.active.ActiveWeight
import ai.kilocode.client.ui.active.activeToolWindowBackground
import com.intellij.icons.AllIcons
import com.intellij.ide.ActivityTracker
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionToolbar
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.util.Disposer
import com.intellij.ui.IdeBorderFactory
import com.intellij.ui.OnePixelSplitter
import com.intellij.ui.SideBorder
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBInsets
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Color
import java.awt.event.HierarchyEvent
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.JSeparator
import javax.swing.ListSelectionModel
import javax.swing.SwingConstants

/** Retained editor chrome shared by local worktrees and hosted workspaces. */
internal abstract class WorkspaceSessionEditorPanel @RequiresEdt constructor(
    parent: Disposable,
) : BorderLayoutPanel(), Disposable {
    init {
        // Register before subclasses create session hosts or coroutine-backed controls.
        Disposer.register(parent, this)
        isOpaque = true
    }

    private val toggle = WorkspaceSessionListToggle { flip() }
    private lateinit var toolbar: ActionToolbar
    private val splitter = OnePixelSplitter(false, PROPORTION)
    private val top = Stack.vertical()
    internal lateinit var list: ActiveList
        private set
    private var ready = false
    private var save: (Boolean) -> Unit = {}
    private var count = 0
    private var kind: SessionActivityKind? = null

    /** The backend this editor drives; subclasses build it in their own init. */
    protected abstract fun host(): WorkspaceSessionEditorManager

    /** Session rows only; [syncList] prepends the pending New Session row. */
    protected abstract fun rows(): List<ActiveItem>

    protected abstract fun sessionIds(): Set<String>

    protected abstract fun openKey(key: String, focus: Boolean)

    protected open fun onStart() {}

    /** Every transition to showing, after [onStart] on the first one; refresh anything polled. */
    protected open fun onShown() {}

    protected open fun onHostChanged() {}

    private var started = false

    override fun getBackground(): Color = activeToolWindowBackground()

    @RequiresEdt
    internal fun initialize(
        content: JComponent,
        header: JComponent,
        actions: DefaultActionGroup = DefaultActionGroup(),
        menu: ActiveMenu<*>? = null,
        open: (ActiveItem, Boolean) -> Unit,
    ) {
        list = ActiveList(
            KiloBundle.message("worktree.session.list.empty"),
            cfg = ActiveConfig(
                description = false,
                hoverActions = true,
                title = ActiveWeight.PLAIN,
            ),
            surface = ActiveSurface.ToolWindow,
            options = ActiveListOptions(selection = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION),
            showSearch = false,
            enter = { true },
            onCell = { _, _ -> },
            onOpen = open,
            menu = menu,
        )
        toolbar = ActionManager.getInstance().createActionToolbar(ActionPlaces.TOOLBAR, actions, true)
        toolbar.targetComponent = this
        toolbar.component.isOpaque = false
        splitter.secondComponent = content
        val strip = object : JPanel(BorderLayout()) {
            override fun getBackground(): Color = activeToolWindowBackground()

            override fun updateUI() {
                super.updateUI()
                val ins = (JBUI.CurrentTheme.Toolbar.horizontalToolbarInsets() as? JBInsets)?.unscaled
                border = JBUI.Borders.merge(
                    JBUI.Borders.empty(ins?.top ?: STRIP_PAD, ins?.left ?: STRIP_PAD, ins?.bottom ?: STRIP_PAD, 0),
                    IdeBorderFactory.createBorder(SideBorder.RIGHT),
                    true,
                )
            }
        }.apply {
            add(
                Stack.horizontal(UiStyle.Gap.sm())
                    .next(toggle.align(HAlign.LEFT, VAlign.CENTER))
                    .next(JSeparator(SwingConstants.VERTICAL)),
                BorderLayout.WEST,
            )
            add(toolbar.component, BorderLayout.CENTER)
        }
        val bar = object : JPanel(BorderLayout()) {
            override fun getBackground(): Color = activeToolWindowBackground()

            override fun updateUI() {
                super.updateUI()
                border = IdeBorderFactory.createBorder(SideBorder.BOTTOM)
            }
        }.apply {
            add(strip, BorderLayout.WEST)
            add(header, BorderLayout.CENTER)
        }
        addToTop(top.next(bar))
        addToCenter(splitter)
        syncToolbar()
    }

    @RequiresEdt
    protected fun banner(component: JComponent) {
        top.next(component)
    }

    @RequiresEdt
    protected fun visibility(load: ((Boolean?) -> Unit) -> Unit, save: (Boolean) -> Unit) {
        this.save = save
        load(::restore)
    }

    @RequiresEdt
    fun preferredFocus(): JComponent = if (expanded()) list.preferredFocus() else splitter.secondComponent

    @RequiresEdt
    protected fun expanded(): Boolean = splitter.firstComponent != null

    @RequiresEdt
    protected fun syncToolbar() {
        if (ApplicationManager.getApplication().isUnitTestMode) {
            @Suppress("DEPRECATION")
            toolbar.updateActionsImmediately()
            return
        }
        ActivityTracker.getInstance().inc()
    }

    @RequiresEdt
    protected fun syncToggle(
        ids: Set<String>,
        activity: Map<String, SessionActivityKind>,
        current: String?,
        deleting: Set<String> = emptySet(),
    ) {
        count = ids.count { it !in deleting }
        kind = attention(activity.filterKeys { it in ids }, current, deleting)
        toggle.update(expanded(), count, kind)
    }

    @RequiresEdt
    private fun flip() {
        syncExpanded(!expanded())
        ready = true
        save(expanded())
    }

    @RequiresEdt
    private fun restore(value: Boolean?) {
        if (ready || Disposer.isDisposed(this)) return
        ready = true
        value?.let(::syncExpanded)
    }

    @RequiresEdt
    private fun syncExpanded(value: Boolean) {
        val changed = expanded() != value
        if (changed) splitter.firstComponent = if (value) list else null
        syncToolbar()
        toggle.update(expanded(), count, kind)
        if (!changed) return
        splitter.revalidate()
        splitter.repaint()
    }

    @RequiresEdt
    protected fun syncList(select: ActiveSelection? = null) {
        val key = host().currentKey()
        val pending = host().hasPendingNew()
        val kinds = host().activity()
        val deleting = host().deleting()
        val rows = buildList {
            if (pending || key == SessionHost.NEW) add(NewRow)
            addAll(rows())
        }
        // The host owns which session is shown, so it also owns the selection: name the row and let
        // the list hold that key until a refresh brings it in.
        val shown = if (pending) SessionHost.NEW else key
        list.update(rows, select ?: shown?.let { ActiveSelection.Key(it) } ?: ActiveSelection.Preserve)
        syncToggle(sessionIds(), kinds, key, deleting)
    }

    @RequiresEdt
    protected fun openRow(row: ActiveItem, focus: Boolean) {
        if (row.key == SessionHost.NEW) {
            host().newSession()
            return
        }
        openKey(row.key, focus)
    }

    /**
     * Wires selection and list-refresh callbacks to [host] and starts the panel the first time it is
     * shown. Subclasses only implement [onStart] / [onHostChanged].
     */
    @RequiresEdt
    protected fun bindHost() {
        host().onPresent = { key -> key?.let { list.select(it) } }
        host().onListChanged = { onHostChanged() }
        addHierarchyListener { event ->
            if (event.changeFlags and HierarchyEvent.SHOWING_CHANGED.toLong() == 0L) return@addHierarchyListener
            if (!isShowing) return@addHierarchyListener
            start()
            onShown()
        }
    }

    @RequiresEdt
    protected fun selectedKeys(): List<String> =
        list.selectedKeys().filter { it != SessionHost.NEW && it !in host().deleting() }

    @RequiresEdt
    protected fun snapshot(sink: DataSink) {
        sink[SessionManager.KEY] = host()
    }

    override fun dispose() {
        host().onPresent = null
        host().onListChanged = null
    }

    @RequiresEdt
    protected fun ensureStarted() {
        start()
    }

    @RequiresEdt
    private fun start() {
        if (started) return
        started = true
        onStart()
    }

    /** Adds the "New Session" row to the toolbar of either editor. */
    protected inner class NewAction : DumbAwareAction(
        KiloBundle.message("worktree.session.new.action"),
        null,
        AllIcons.General.Add,
    ) {
        override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

        override fun actionPerformed(e: AnActionEvent) {
            host().newSession()
        }
    }

    protected object NewRow : ActiveSection {
        override val key: String get() = SessionHost.NEW
        override val title: String get() = KiloBundle.message("worktree.session.new")
        // Group the pending session under Today so it appears inside the list right away instead of
        // as a detached row pinned above the first section header.
        override val section: String get() = HistoryTime.title(HistorySection.TODAY)
    }

    private companion object {
        /** Classic UI leaves the toolbar inset key unset; matches the platform fallback. */
        const val STRIP_PAD = 2
        const val PROPORTION = 0.25f
    }
}
