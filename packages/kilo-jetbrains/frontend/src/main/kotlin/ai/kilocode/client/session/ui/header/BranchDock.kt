package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.ChangesPanel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.rpc.dto.BranchStatusDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.GhAvailability
import com.intellij.ide.ActivityTracker
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.application.ApplicationManager
import com.intellij.ui.SimpleTextAttributes
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Color
import java.awt.Dimension

internal class BranchDock @RequiresEdt constructor(
    openDiff: () -> Unit,
    private val onMove: (() -> Unit)?,
    private val onNewWorktree: (() -> Unit)? = null,
    titleStyle: Int = SimpleTextAttributes.STYLE_PLAIN,
    /**
     * Whether the dock carries the branch's pull request and its changes summary above the action row.
     * A host whose own header already shows the branch, its PR, and its counts (the worktree editor
     * tab) takes just the action row, and leaves that reporting to the header it already has.
     */
    private val header: Boolean = true,
) : BorderLayoutPanel(), SessionEditorStyleTarget, UiDataProvider {
    private val core = PrHeaderView(titleStyle = titleStyle, mode = ChangesPanel.Mode.COMPACT, openDiff = openDiff)
    private val changes = ChangesPanel(ChangesPanel.Mode.COMPACT, onBase = openDiff)
    private val group = DefaultActionGroup().apply {
        ActionManager.getInstance().getAction("Kilo.Chat.NewWorktree")?.let { add(it) }
        ActionManager.getInstance().getAction("Kilo.Chat.MoveToWorktree")?.let { add(it) }
    }
    private val toolbar = ActionManager.getInstance().createActionToolbar(PLACE, group, true)
    private val actionRow = Stack.horizontal(UiStyle.Gap.sm())
        .next(toolbar.component)
        .next(changes.align(HAlign.CENTER, VAlign.CENTER))
        .align(HAlign.CENTER, VAlign.CENTER)
    private var files = emptyList<DiffFileDto>()
    private var local = 0
    private var branch: BranchStatusDto? = null
    private var hasMessages = false
    private var hasSession = false
    private var busy = false

    init {
        isOpaque = true
        toolbar.targetComponent = this
        toolbar.component.isOpaque = false
        addToCenter(Stack.vertical().next(core).next(actionRow).align(HAlign.TRACK, VAlign.CENTER))
        isVisible = false
        sync()
    }

    @RequiresEdt
    override fun getBackground(): Color = SessionUiStyle.Colors.codeBlockBackground()

    @RequiresEdt
    override fun updateUI() {
        super.updateUI()
        border = JBUI.Borders.compound(
            JBUI.Borders.customLineTop(JBUI.CurrentTheme.EditorTabs.borderColor()),
            JBUI.Borders.empty(),
        )
    }

    @RequiresEdt
    override fun uiDataSnapshot(sink: DataSink) {
        sink[ChatDockKeys.DOCK] = this
    }

    @RequiresEdt
    fun setChanges(files: List<DiffFileDto>) {
        if (this.files == files) return
        this.files = files
        sync()
    }

    @RequiresEdt
    fun setLocal(files: List<DiffFileDto>) {
        if (local == files.size) return
        local = files.size
        sync()
    }

    @RequiresEdt
    fun setBranch(branch: BranchStatusDto?) {
        if (this.branch == branch) return
        this.branch = branch
        sync()
    }

    @RequiresEdt
    fun setHasMessages(value: Boolean) {
        if (hasMessages == value) return
        hasMessages = value
        sync()
    }

    @RequiresEdt
    fun setBusy(value: Boolean) {
        if (busy == value) return
        busy = value
        sync()
    }

    @RequiresEdt
    fun setHasSession(value: Boolean) {
        if (hasSession == value) return
        hasSession = value
        syncToolbar()
    }

    @RequiresEdt
    fun newWorktreeEnabled(): Boolean = onNewWorktree != null && dockActive()

    @RequiresEdt
    fun moveEnabled(): Boolean = onMove != null && dockActive()

    @RequiresEdt
    fun changeCount(): Int = local

    @RequiresEdt
    fun hasSession(): Boolean = hasSession

    @RequiresEdt
    fun triggerNewWorktree() = onNewWorktree?.invoke() ?: Unit

    @RequiresEdt
    fun triggerMove() = onMove?.invoke() ?: Unit

    @RequiresEdt
    private fun dockActive(): Boolean = gitAvailable() && !busy && (hasMessages || local > 0)

    private fun gitAvailable(): Boolean {
        val branch = branch ?: return false
        return branch.availability != GhAvailability.GIT_MISSING
    }

    @RequiresEdt
    private fun sync() {
        // A header-less host treats the branch as having no PR, so the PR row never shows and never
        // takes the place of the action row below it.
        val pull = branch?.pr?.takeIf { header }
        val count = files.size
        val additions = files.sumOf { it.additions }
        val deletions = files.sumOf { it.deletions }
        core.update(count, additions, deletions, pull, branch?.branch.orEmpty())
        changes.update(count, additions, deletions)
        if (core.isVisible != (pull != null)) core.isVisible = pull != null
        val visible = pull == null && gitAvailable() && !busy &&
            (files.isNotEmpty() || hasMessages || newWorktreeEnabled() || moveEnabled())
        if (actionRow.isVisible != visible) actionRow.isVisible = visible
        val next = pull != null || visible
        if (isVisible != next) isVisible = next
        syncToolbar()
        revalidate()
        repaint()
    }

    @RequiresEdt
    private fun syncToolbar() {
        if (ApplicationManager.getApplication().isUnitTestMode) {
            @Suppress("DEPRECATION")
            toolbar.updateActionsImmediately()
            return
        }
        ActivityTracker.getInstance().inc()
    }

    @RequiresEdt
    override fun getPreferredSize(): Dimension {
        val base = super.getPreferredSize()
        return Dimension(base.width, maxOf(base.height, JBUI.scale(ROW_HEIGHT)))
    }

    @RequiresEdt
    override fun getMinimumSize(): Dimension = preferredSize

    @RequiresEdt
    override fun getMaximumSize(): Dimension = Dimension(Int.MAX_VALUE, preferredSize.height)

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        core.applyStyle(style)
        changes.font = style.smallFont
        changes.foreground = SessionUiStyle.Text.Secondary.foreground()
    }

    private companion object {
        const val ROW_HEIGHT = 34
        const val PLACE = "KiloChatBranchDock"
    }
}
