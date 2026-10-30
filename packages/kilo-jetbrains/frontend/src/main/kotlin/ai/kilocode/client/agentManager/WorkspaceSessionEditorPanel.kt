package ai.kilocode.client.agentManager

import ai.kilocode.client.agentManager.worktree.attention
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.ui.list.ActiveList
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListMenu
import ai.kilocode.client.ui.list.ActiveListSurface
import ai.kilocode.client.ui.list.ActiveListWeight
import ai.kilocode.client.ui.list.activeListToolWindowBackground
import com.intellij.ide.ActivityTracker
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionToolbar
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.application.ApplicationManager
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
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.JSeparator
import javax.swing.ListSelectionModel
import javax.swing.SwingConstants

/** Retained editor chrome shared by local worktrees and hosted workspaces. */
abstract class WorkspaceSessionEditorPanel @RequiresEdt constructor(
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

    override fun getBackground(): Color = activeListToolWindowBackground()

    @RequiresEdt
    internal fun initialize(
        content: JComponent,
        header: JComponent,
        actions: DefaultActionGroup = DefaultActionGroup(),
        menu: ActiveListMenu<*>? = null,
        open: (ActiveListItem, Boolean) -> Unit,
    ) {
        list = ActiveList(
            KiloBundle.message("worktree.session.list.empty"),
            cfg = ActiveListConfig(
                description = false,
                selection = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION,
                hoverActions = true,
                title = ActiveListWeight.PLAIN,
            ),
            surface = ActiveListSurface.ToolWindow,
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
            override fun getBackground(): Color = activeListToolWindowBackground()

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
            override fun getBackground(): Color = activeListToolWindowBackground()

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

    private companion object {
        /** Classic UI leaves the toolbar inset key unset; matches the platform fallback. */
        const val STRIP_PAD = 2
        const val PROPORTION = 0.25f
    }
}
