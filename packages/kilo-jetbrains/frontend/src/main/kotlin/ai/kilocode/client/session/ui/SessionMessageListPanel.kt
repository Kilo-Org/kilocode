package ai.kilocode.client.session.ui

import ai.kilocode.client.session.SessionDiffOpener
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.model.FileAttachment
import ai.kilocode.client.session.model.ToolCallRef
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.LoginRequiredView
import ai.kilocode.client.session.views.MessageView
import ai.kilocode.client.session.views.permission.PermissionView
import ai.kilocode.client.session.views.question.QuestionView
import ai.kilocode.client.session.views.TurnView
import ai.kilocode.client.session.views.base.PartView
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Insets
import javax.swing.JComponent

/**
 * Scrollable transcript panel that maps the model's turn grouping to
 * [TurnView] children and keeps secondary indexes for fast message lookup.
 *
 * **Primary index**: `turnId -> TurnView` — one entry per top-level transcript item.
 * **Secondary indexes**:
 * - `messageId -> TurnView` — which turn does a message live in?
 * - `messageId -> MessageView` — the nested renderer for that message.
 *
 * The panel reacts to [SessionModelEvent.TurnAdded], [TurnUpdated], and
 * [TurnRemoved] for structural changes, and to [ContentAdded], [ContentUpdated],
 * [ContentRemoved], [ContentDelta] for fine-grained part updates.
 *
 * [HistoryLoaded] and [Cleared] both trigger a full rebuild from the model.
 *
 * A [ProgressPanel] is always kept as the last child — it appears at the
 * bottom of the transcript inside the scroll pane and shows a spinner while
 * the session is busy.
 *
 * Optional [question] and [permission] views are kept immediately before
 * [progress] in component order and shown/hidden in response to
 * [SessionModelEvent.StateChanged].
 *
 * All method calls must happen on the EDT.
 */
class SessionMessageListPanel(
    private val model: SessionModel,
    parent: Disposable,
    private val question: QuestionView? = null,
    private val permission: PermissionView? = null,
    private val login: LoginRequiredView? = null,
    private val openFile: SessionFileOpener,
    private val openUrl: (String) -> Unit = {},
    private val selection: SessionSelection? = null,
    private val openAttachment: (String, FileAttachment) -> Unit = { _, item -> ai.kilocode.client.session.views.AttachmentView.openDefault(item, openFile, openUrl) },
    private val repo: String? = null,
    private val resize: ((JComponent, () -> Unit) -> Unit)? = null,
    private val revert: ((String) -> Unit)? = null,
    private val cancelRevert: (() -> Unit)? = null,
    private val deleteQueued: ((String) -> Unit)? = null,
    private val banner: RevertBanner? = null,
) : SessionLayoutPanel(
    SessionUiStyle.SessionLayout.GAP,
    Insets(
        SessionUiStyle.SessionLayout.INNER_TOP,
        SessionUiStyle.SessionLayout.INNER_HORIZONTAL,
        SessionUiStyle.SessionLayout.INNER_BOTTOM,
        SessionUiStyle.SessionLayout.INNER_HORIZONTAL,
    ),
), Disposable, SessionEditorStyleTarget {

    private val turnViews = LinkedHashMap<String, TurnView>()
    private val msgToTurn = HashMap<String, TurnView>()
    private val msgToView = HashMap<String, MessageView>()
    private var style = SessionEditorStyle.current()
    private var hiddenTool: ToolCallRef? = null
    private var hovered: PartView? = null
    private var revertingMessage: String? = null
    private var openDiff: SessionDiffOpener = { _, _, _ -> }
    private var sessionId: String? = null
    private var seq = 0
    private var stable = -1
    private var pendingReflow = false
    private var dead = false

    var onHover: ((PartView, Boolean) -> Unit)? = null
    var onReflow: ((Boolean) -> Unit)? = null

    /** Progress footer — always the last child inside the scroll. */
    val progress = ProgressPanel(model, parent)

    init {
        isOpaque = true
        Disposer.register(parent, this)
        applyStyle(style)

        model.addListener(parent) { event ->
            when (event) {
                is SessionModelEvent.TurnAdded -> onTurnAdded(event.turn)
                is SessionModelEvent.TurnUpdated -> onTurnUpdated(event.turn)
                is SessionModelEvent.TurnRemoved -> onTurnRemoved(event.id)

                is SessionModelEvent.ContentAdded -> {
                    if (msgToView[event.messageId]?.upsertPartChanged(event.content) == true) {
                        onContentChanged(event.messageId)
                    }
                }

                is SessionModelEvent.ContentUpdated -> {
                    if (msgToView[event.messageId]?.upsertPartChanged(event.content) == true) {
                        onContentChanged(event.messageId)
                    }
                }

                is SessionModelEvent.ContentRemoved -> {
                    if (msgToView[event.messageId]?.removePartChanged(event.contentId) == true) {
                        onContentChanged(event.messageId)
                    }
                }

                is SessionModelEvent.ContentDelta -> {
                    if (event.created) return@addListener
                    if (event.delta.isEmpty()) return@addListener
                    val handled = msgToView[event.messageId]?.appendDelta(event.contentId, event.delta) == true
                    if (handled) {
                        msgToTurn[event.messageId]?.syncCopyToolbars()
                        forgetTurn(event.messageId)
                        return@addListener
                    }
                    val content = model.content(event.messageId, event.contentId)
                    if (content != null) {
                        if (msgToView[event.messageId]?.upsertPartChanged(content) == true) {
                            onContentChanged(event.messageId)
                        }
                    }
                }

                is SessionModelEvent.HistoryLoaded -> rebuild()
                is SessionModelEvent.Cleared -> clear()

                is SessionModelEvent.StateChanged -> {
                    syncActive(event.state)
                    syncSettled(event.state)
                    syncReverted()
                    syncReverting(event.state)
                    anchorFooter()
                    refresh()
                }

                is SessionModelEvent.RevertChanged -> {
                    syncReverted()
                    banner?.update()
                    refresh()
                }

                is SessionModelEvent.QueueChanged -> {
                    syncQueued()
                    syncSettled()
                    refresh()
                }

                // Message events: structural changes are handled via turn events above.
                is SessionModelEvent.MessageAdded,
                is SessionModelEvent.MessageRemoved,
                is SessionModelEvent.TodosUpdated,
                is SessionModelEvent.SessionUpdated,
                is SessionModelEvent.HeaderUpdated,
                is SessionModelEvent.Compacted -> Unit

                is SessionModelEvent.MessageUpdated -> {
                    // message.updated fires on every streamed metadata delta (time/tokens/cost). Only
                    // relayout the transcript when the turn's modified-files card actually changed,
                    // not on each delta or when this message isn't a turn anchor.
                    val view = turnViews[event.info.info.id]
                    if (view?.setDiffs(event.info.info.summary?.diffs.orEmpty()) == true) {
                        (layout as? SessionLayout)?.forget(view)
                        refresh()
                    }
                }

                is SessionModelEvent.DiffUpdated -> {
                    banner?.update()
                    refresh()
                }
            }
        }

        // Populate from any turns already present (e.g. existing session opened before panel was created)
        rebuild()
    }

    override fun addNotify() {
        super.addNotify()
        scheduleReflow()
    }

    override fun doLayout() {
        super.doLayout()
        // A reflow scheduled before the panel had a width parks itself in [pendingReflow]. The first
        // layout that gives us a real width re-arms it, so the transcript is always measured on-screen
        // instead of against the zero-width state a resize used to be the only escape from. Cheap and
        // inert on the streaming path: pendingReflow is only set by a rebuild/clear that ran too early.
        if (!pendingReflow || dead || width <= 0 || turnViews.isEmpty()) return
        pendingReflow = false
        scheduleReflow()
    }

    fun setDiffOpener(openDiff: SessionDiffOpener, sessionId: String?) {
        this.openDiff = openDiff
        this.sessionId = sessionId
        turnViews.values.forEach { it.setDiffOpener(openDiff, sessionId) }
    }

    // ------ public lookup API ------

    /** Find the [MessageView] for a message by id, or null if not present. */
    fun findMessage(id: String): MessageView? = msgToView[id]

    /** Find the [TurnView] that contains a message. */
    fun findTurn(messageId: String): TurnView? = msgToTurn[messageId]

    /** Number of top-level turns currently displayed. */
    fun turnCount(): Int = turnViews.size

    /** Ordered turn ids — stable for test assertions. */
    fun turnIds(): List<String> = turnViews.keys.toList()

    // ------ dump helpers for tests ------

    /**
     * Compact structural dump: one line per turn, each listing its messages.
     *
     * Example:
     * ```
     * turn#u1: user#u1, assistant#a1
     * turn#u2: user#u2
     * ```
     */
    fun dump(): String = turnViews.values.joinToString("\n") { tv ->
        "turn#${tv.id}: ${tv.dump()}"
    }

    /**
     * Detailed dump: turns → messages → part view labels.
     */
    fun dumpDetailed(): String = buildString {
        for (tv in turnViews.values) {
            appendLine("turn#${tv.id}")
            for (mid in tv.messageIds()) {
                val mv = tv.messageView(mid)!!
                appendLine("  ${mv.role}#$mid")
                for (pid in mv.partIds()) {
                    appendLine("    ${mv.part(pid)!!.dumpLabel()}")
                }
            }
        }
    }.trimEnd()

    @RequiresEdt
    internal fun reflow(): Boolean {
        // Measuring at zero width reflows every HTML pane to a 1-char column and yields a bogus
        // height. Defer until the panel has a real width (see doLayout) so a pass can never
        // "stabilize" the transcript against a zero-width measurement.
        if (width <= 0) {
            pendingReflow = turnViews.isNotEmpty()
            return false
        }
        val before = preferredSize.height
        (layout as? SessionLayout)?.forgetAll()
        revalidate()
        doLayout()
        val after = preferredSize.height
        repaint()
        return after != before
    }

    // ------ private event handlers ------

    private fun onTurnAdded(turn: ai.kilocode.client.session.model.Turn) {
        val tv = TurnView(turn.id, openFile, style, openUrl, selection, openAttachment, resize, repo, ::hover, revert, deleteQueued).also {
            it.setDiffOpener(openDiff, sessionId)
        }
        turnViews[turn.id] = tv
        for (msgId in turn.messageIds) {
            val msg = model.message(msgId) ?: continue
            val mv = tv.addMessage(msg)
            register(msgId, tv, mv)
        }
        tv.setDiffs(diffsOf(turn))
        tv.syncCopyToolbars()
        syncQueued(tv)
        syncReverted()
        add(tv)
        syncSettled()
        anchorFooter()
        refresh()
    }

    private fun onTurnUpdated(turn: ai.kilocode.client.session.model.Turn) {
        val tv = turnViews[turn.id] ?: return
        val prev = tv.messageIds().toSet()
        val next = turn.messageIds

        // Remove messages no longer in this turn
        for (id in prev) {
            if (id !in next) {
                if (tv.removeMessageChanged(id)) unregister(id)
            }
        }

        // Add new messages (appended at the end of the turn)
        for (id in next) {
            if (id in prev) continue
            val msg = model.message(id) ?: continue
            val mv = tv.addMessage(msg)
            register(id, tv, mv)
        }
        tv.setDiffs(diffsOf(turn))
        tv.syncCopyToolbars()
        syncQueued(tv)
        syncReverted()
        syncSettled()

        refresh()
    }

    private fun onTurnRemoved(id: String) {
        val tv = turnViews.remove(id) ?: return
        for (msgId in tv.messageIds()) unregister(msgId)
        remove(tv)
        Disposer.dispose(tv)
        syncSettled()
        anchorFooter()
        refresh()
    }

    private fun rebuild() {
        clearHover()
        turnViews.values.forEach {
            remove(it)
            Disposer.dispose(it)
        }
        turnViews.clear()
        msgToTurn.clear()
        msgToView.clear()
        removeAll()

        for (turn in model.turns()) {
            val tv = TurnView(turn.id, openFile, style, openUrl, selection, openAttachment, resize, repo, ::hover, revert, deleteQueued).also {
                it.setDiffOpener(openDiff, sessionId)
            }
            turnViews[turn.id] = tv
            for (msgId in turn.messageIds) {
                val msg = model.message(msgId) ?: continue
                val mv = tv.addMessage(msg)
                register(msgId, tv, mv)
            }
            tv.setDiffs(diffsOf(turn))
            tv.syncCopyToolbars()
            syncQueued(tv)
            add(tv)
        }

        syncActive(model.state)
        syncSettled(model.state)
        syncQueued()
        syncReverted()
        syncReverting(model.state)
        banner?.update()
        anchorFooter()
        scheduleReflow()
        refresh()
    }

    private fun syncReverted() {
        for ((id, view) in msgToView) {
            view.isVisible = !model.isRevertedMessage(id)
        }
        for (view in turnViews.values) {
            view.isVisible = view.messageIds().any { msgToView[it]?.isVisible == true }
        }
    }

    private fun clear() {
        seq++
        stable = -1
        clearHover()
        turnViews.values.forEach {
            remove(it)
            Disposer.dispose(it)
        }
        turnViews.clear()
        msgToTurn.clear()
        msgToView.clear()
        revertingMessage = null
        removeAll()
        syncActive(model.state)
        syncSettled(model.state)
        syncQueued()
        syncReverting(model.state)
        banner?.update()
        anchorFooter()
        scheduleReflow()
        refresh()
    }

    /**
     * Show or hide active question/permission/login views based on [state].
     * All views are always kept as children of this panel (added in [anchorFooter]),
     * but visibility is controlled here.
     */
    private fun syncActive(state: SessionState = model.state) {
        when (state) {
            is SessionState.AwaitingQuestion -> {
                setHiddenQuestionTool(state.question.tool)
                permission?.hideView()
                login?.hideView()
                question?.show(state.question)
            }
            is SessionState.AwaitingPermission -> {
                setHiddenQuestionTool(null)
                question?.hideView()
                login?.hideView()
                permission?.show(state.permission)
            }
            is SessionState.LoginRequired -> {
                setHiddenQuestionTool(null)
                question?.hideView()
                permission?.hideView()
                login?.show(state.message)
            }
            else -> {
                setHiddenQuestionTool(null)
                question?.hideView()
                permission?.hideView()
                login?.hideView()
            }
        }
    }

    private fun syncReverting(state: SessionState) {
        val current = revertingMessage
        val rollback = state as? SessionState.Reverting
        if (rollback?.kind == SessionState.Reverting.Kind.ROLLBACK && rollback.message != null) {
            if (current != null && current != rollback.message) msgToView[current]?.setReverting(false, "", {})
            val view = msgToView[rollback.message]
            view?.setReverting(true, rollback.text) { cancelRevert?.invoke() }
            revertingMessage = if (view == null) null else rollback.message
        } else {
            if (current != null) msgToView[current]?.setReverting(false, "", {})
            revertingMessage = null
        }
        banner?.setReverting(state)
    }

    /** Fan out the hidden question tool ref to all registered [MessageView]s. */
    private fun setHiddenQuestionTool(ref: ToolCallRef?) {
        if (hiddenTool == ref) return
        hiddenTool = ref
        for (mv in msgToView.values) mv.setHiddenQuestionTool(ref)
    }

    private fun syncSettled(state: SessionState = model.state) {
        val active = if (state.isBusy()) turnViews.values.lastOrNull { !model.isQueued(it.id) } else null
        for (view in turnViews.values) view.setSettled(view !== active)
    }

    private fun syncQueued() {
        for (view in turnViews.values) syncQueued(view)
    }

    private fun syncQueued(view: TurnView) {
        view.setQueued(model.isQueued(view.id)) { id -> deleteQueued?.invoke(id) }
    }

    /**
     * Re-insert [question], [permission], [login], and [progress] as the last children
     * so active views always render after all turn views, and progress is last.
     *
     * All active views are added even when invisible — [SessionLayout] skips
     * invisible children, so no extra space is consumed, and the component tree
     * remains stable for tests.
     */
    private fun anchorFooter() {
        if (question != null) remove(question)
        if (permission != null) remove(permission)
        if (login != null) remove(login)
        if (banner != null) remove(banner)
        remove(progress)
        if (question != null) add(question)
        if (permission != null) add(permission)
        if (login != null) add(login)
        if (banner != null) add(banner)
        add(progress)
    }

    private fun diffsOf(turn: ai.kilocode.client.session.model.Turn) =
        model.message(turn.id)?.info?.summary?.diffs.orEmpty()

    private fun register(msgId: String, tv: TurnView, mv: MessageView) {
        msgToTurn[msgId] = tv
        msgToView[msgId] = mv
        mv.setHiddenQuestionTool(hiddenTool)
    }

    private fun unregister(msgId: String) {
        if (revertingMessage == msgId) revertingMessage = null
        msgToTurn.remove(msgId)
        msgToView.remove(msgId)
    }

    private fun refresh() {
        revalidate()
        repaint()
    }

    private fun scheduleReflow() {
        if (dead) return
        if (turnViews.isEmpty()) {
            pendingReflow = false
            return
        }
        stable = -1
        val id = ++seq
        ApplicationManager.getApplication().invokeLater {
            reflowPass(id, REFLOW_PASSES, REFLOW_BUDGET)
        }
    }

    @RequiresEdt
    private fun reflowPass(id: Int, remaining: Int, budget: Int) {
        if (dead || id != seq) return
        if (turnViews.isEmpty()) return
        if (width <= 0) {
            // Not laid out yet. Stop polling and let doLayout re-arm once a real width arrives,
            // rather than draining the pass budget against a zero-width height.
            pendingReflow = true
            return
        }
        val changed = reflow()
        if (changed) onReflow?.invoke(true)
        // [remaining] restarts while the height is still settling so the chain keeps re-measuring
        // until it holds steady for REFLOW_PASSES consecutive passes. [budget] never resets and is
        // the hard backstop that guarantees termination. See below for why both are needed.
        if (remaining <= 0 || budget <= 0) {
            stable = -1
            return
        }
        val height = preferredSize.height
        // A moving height only means the layout is still settling when nothing is streaming in. While
        // [SessionState.Busy] deltas land every EDT cycle, so restarting the settle window on each one
        // was the runaway that pinned the panel in a perpetual forgetAll()/re-measure loop — count the
        // pass down instead so streaming settles in REFLOW_PASSES and hands off to the per-turn
        // forgetTurn path. Every other state (idle, awaiting-permission/question, retry, offline —
        // which recoverPending() can seed right after load) has no deltas arriving, so a moving height
        // is genuine convergence and must keep restarting; [budget] caps that if a pane never settles.
        val left = if (height == stable || model.state is SessionState.Busy) remaining - 1 else REFLOW_PASSES
        stable = height
        ApplicationManager.getApplication().invokeLater {
            reflowPass(id, left, budget - 1)
        }
    }

    /**
     * Handle a content mutation that changed an already-rendered message: sync the turn's copy
     * toolbars, forget its cached height, then relayout. [forgetTurn] is essential when the update
     * lands on a settled turn — a settled [TurnView] is its own validate root, so `RepaintManager`
     * re-validates it independently and its `isValid` flag no longer signals the height change to
     * [SessionLayout]'s measurement cache.
     */
    private fun onContentChanged(messageId: String) {
        msgToTurn[messageId]?.syncCopyToolbars()
        forgetTurn(messageId)
        refresh()
    }

    /** Drop [SessionLayout]'s cached height for the turn holding [messageId] after its content changes. */
    private fun forgetTurn(messageId: String) {
        val tv = msgToTurn[messageId] ?: return
        (layout as? SessionLayout)?.forget(tv)
    }

    private fun hover(view: PartView, value: Boolean) {
        if (value) {
            val prev = hovered
            if (prev === view) return
            hovered = view
            prev?.setHovered(false)
            onHover?.invoke(view, true)
            return
        }
        if (hovered !== view) return
        hovered = null
        onHover?.invoke(view, false)
    }

    private fun clearHover() {
        val view = hovered ?: return
        hovered = null
        view.setHovered(false)
        onHover?.invoke(view, false)
    }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        background = style.editorBackground
        for (view in turnViews.values) view.applyStyle(style)
        question?.applyStyle(style)
        permission?.applyStyle(style)
        login?.applyStyle(style)
        banner?.applyStyle(style)
        progress.applyStyle(style)
        reflow()
        refresh()
    }

    override fun dispose() {
        dead = true
        seq++
        pendingReflow = false
        clearHover()
        question?.hideView()
        permission?.hideView()
        login?.hideView()
        turnViews.values.forEach {
            remove(it)
            Disposer.dispose(it)
        }
        turnViews.clear()
        msgToTurn.clear()
        msgToView.clear()
        revertingMessage = null
        onHover = null
        onReflow = null
        removeAll()
    }

    private companion object {
        const val REFLOW_PASSES = 6

        // Hard ceiling on total reflow passes per schedule, independent of height stability. Lets the
        // layout settle across several height changes (HTML panes reflow asynchronously) while capping
        // the work a streaming session can trigger, since its height never stabilizes.
        const val REFLOW_BUDGET = REFLOW_PASSES * 4
    }
}
