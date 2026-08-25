package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
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

/**
 * Branch/PR dock shown above the prompt in the chat side panel.
 *
 * Two mutually exclusive layouts, stacked so the row height stays stable:
 * - PR present: the shared [PrHeaderView] (state badge + PR title + changes badge).
 * - No PR: a horizontally centered row with the New Worktree / Move to Worktree toolbar actions and
 *   the changes badge.
 *
 * The two actions are registered platform actions (`Kilo.Chat.NewWorktree`, `Kilo.Chat.MoveToWorktree`)
 * rendered through an [com.intellij.openapi.actionSystem.ActionToolbar]; each is invisible when it is
 * not enabled. The dock exposes its state to those actions via [ChatDockKeys.DOCK]. Collapses to
 * nothing unless it has a PR, changes, messages, or an enabled action.
 *
 * The action row is offered only while the session is idle: an active turn ([setBusy]) withdraws it.
 * The PR row stays through a turn — it is informational, not an action.
 */
internal class BranchDock(
    openDiff: () -> Unit,
    private val onMove: (() -> Unit)?,
    private val onNewWorktree: (() -> Unit)? = null,
    titleStyle: Int = SimpleTextAttributes.STYLE_PLAIN,
) : BorderLayoutPanel(), SessionEditorStyleTarget, UiDataProvider {
    private val core = PrHeaderView(titleStyle = titleStyle, openDiff = openDiff)
    private val changes = BranchChangesBadge(openDiff)
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
    private var branch: BranchStatusDto? = null
    private var hasMessages = false
    private var hasSession = false
    private var busy = false

    init {
        isOpaque = true
        toolbar.targetComponent = this
        // Transparent so the toolbar shows the dock's prompt-matching background and tracks LaF.
        toolbar.component.isOpaque = false
        addToCenter(Stack.vertical().next(core).next(actionRow).align(HAlign.TRACK, VAlign.CENTER))
        isVisible = false
        sync()
    }

    override fun getBackground(): Color = SessionUiStyle.Colors.codeBlockBackground()

    override fun updateUI() {
        super.updateUI()
        border = JBUI.Borders.compound(
            JBUI.Borders.customLineTop(JBUI.CurrentTheme.EditorTabs.borderColor()),
            JBUI.Borders.empty(),
        )
    }

    override fun uiDataSnapshot(sink: DataSink) {
        sink[ChatDockKeys.DOCK] = this
    }

    @RequiresEdt
    fun setChanges(files: List<DiffFileDto>) {
        this.files = files
        sync()
    }

    @RequiresEdt
    fun setBranch(branch: BranchStatusDto?) {
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

    /**
     * Whether the chat already has a persisted session. A session-less move transfers only local
     * changes; this value affects action wording, not visibility.
     */
    @RequiresEdt
    fun setHasSession(value: Boolean) {
        if (hasSession == value) return
        hasSession = value
        syncToolbar()
    }

    // ---- state read by the toolbar actions ----

    fun newWorktreeEnabled(): Boolean = onNewWorktree != null && dockActive()

    fun moveEnabled(): Boolean = onMove != null && dockActive()

    fun changeCount(): Int = files.size

    fun hasSession(): Boolean = hasSession

    fun triggerNewWorktree() = onNewWorktree?.invoke() ?: Unit

    fun triggerMove() = onMove?.invoke() ?: Unit

    private fun dockActive(): Boolean = gitAvailable() && !busy && (hasMessages || files.isNotEmpty())

    private fun gitAvailable(): Boolean {
        val branch = branch ?: return false
        return branch.availability != GhAvailability.GIT_MISSING
    }

    private fun sync() {
        val pull = branch?.pr
        val count = files.size
        core.update(count, files.sumOf { it.additions }, files.sumOf { it.deletions }, pull, branch?.branch.orEmpty())
        changes.update(count, files.sumOf { it.additions }, files.sumOf { it.deletions })

        // PR present -> the informational PR header; otherwise the centered action row.
        core.isVisible = pull != null
        val rowVisible = pull == null && dockActive()
        actionRow.isVisible = rowVisible

        val next = pull != null || rowVisible
        if (isVisible != next) isVisible = next
        syncToolbar()
        revalidate()
        repaint()
    }

    private fun syncToolbar() {
        // Tests need a synchronous refresh to assert action presentations; production nudges the
        // platform's action-update pass instead of the deprecated blocking updateActionsImmediately().
        if (ApplicationManager.getApplication().isUnitTestMode) {
            @Suppress("DEPRECATION")
            toolbar.updateActionsImmediately()
            return
        }
        ActivityTracker.getInstance().inc()
    }

    override fun getPreferredSize(): Dimension {
        val base = super.getPreferredSize()
        // Reserve a stable row height so the transcript does not jump as stats/PR arrive late.
        return Dimension(base.width, maxOf(base.height, JBUI.scale(ROW_HEIGHT)))
    }

    override fun getMinimumSize(): Dimension = preferredSize

    override fun getMaximumSize(): Dimension = Dimension(Int.MAX_VALUE, preferredSize.height)

    override fun applyStyle(style: SessionEditorStyle) {
        core.applyStyle(style)
        changes.applyStyle(style)
    }

    private companion object {
        const val ROW_HEIGHT = 34
        const val PLACE = "KiloChatBranchDock"
    }
}
