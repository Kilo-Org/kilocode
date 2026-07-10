package ai.kilocode.client.session.ui

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
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.util.ui.JBUI
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
    private val banner: RevertBanner? = null,
) : SessionLayoutPanel(
    JBUI.scale(SessionUiStyle.SessionLayout.GAP),
    JBUI.insets(
        SessionUiStyle.SessionLayout.InnerInsets.top,
        SessionUiStyle.SessionLayout.InnerInsets.left,
        SessionUiStyle.SessionLayout.InnerInsets.bottom,
        SessionUiStyle.SessionLayout.InnerInsets.right + SessionUiStyle.SessionLayout.TRANSCRIPT_SCROLLBAR_PADDING,
    ),
), Disposable, SessionEditorStyleTarget {

    private val turnViews = LinkedHashMap<String, TurnView>()
    private val msgToTurn = HashMap<String, TurnView>()
    private val msgToView = HashMap<String, MessageView>()
    private var style = SessionEditorStyle.current()
    private var hiddenTool: ToolCallRef? = null
    private var hovered: PartView? = null

    var onHover: ((PartView, Boolean) -> Unit)? = null

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
                    msgToView[event.messageId]?.upsertPart(event.content)
                    msgToTurn[event.messageId]?.syncCopyToolbars()
                    refresh()
                }

                is SessionModelEvent.ContentUpdated -> {
                    msgToView[event.messageId]?.upsertPart(event.content)
                    msgToTurn[event.messageId]?.syncCopyToolbars()
                    refresh()
                }

                is SessionModelEvent.ContentRemoved -> {
                    msgToView[event.messageId]?.removePart(event.contentId)
                    msgToTurn[event.messageId]?.syncCopyToolbars()
                    refresh()
                }

                is SessionModelEvent.ContentDelta -> {
                    if (event.created) return@addListener
                    val handled = msgToView[event.messageId]?.appendDelta(event.contentId, event.delta) == true
                    if (handled) {
                        msgToTurn[event.messageId]?.syncCopyToolbars()
                        return@addListener
                    }
                    val content = model.content(event.messageId, event.contentId)
                    if (content != null) {
                        msgToView[event.messageId]?.upsertPart(content)
                        msgToTurn[event.messageId]?.syncCopyToolbars()
                    }
                }

                is SessionModelEvent.HistoryLoaded -> rebuild()
                is SessionModelEvent.Cleared -> clear()

                is SessionModelEvent.StateChanged -> {
                    syncActive(event.state)
                    syncReverted()
                    anchorFooter()
                    refresh()
                }

                is SessionModelEvent.RevertChanged -> {
                    syncReverted()
                    banner?.update()
                    refresh()
                }

                // Message events: structural changes are handled via turn events above.
                is SessionModelEvent.MessageAdded,
                is SessionModelEvent.MessageUpdated,
                is SessionModelEvent.MessageRemoved,
                is SessionModelEvent.TodosUpdated,
                is SessionModelEvent.SessionUpdated,
                is SessionModelEvent.HeaderUpdated,
                is SessionModelEvent.Compacted -> Unit

                is SessionModelEvent.DiffUpdated -> {
                    banner?.update()
                    refresh()
                }
            }
        }

        // Populate from any turns already present (e.g. existing session opened before panel was created)
        rebuild()
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

    // ------ private event handlers ------

    private fun onTurnAdded(turn: ai.kilocode.client.session.model.Turn) {
        val tv = TurnView(turn.id, openFile, style, openUrl, selection, openAttachment, resize, repo, ::hover, revert)
        turnViews[turn.id] = tv
        for (msgId in turn.messageIds) {
            val msg = model.message(msgId) ?: continue
            val mv = tv.addMessage(msg)
            register(msgId, tv, mv)
        }
        tv.syncCopyToolbars()
        syncReverted()
        add(tv)
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
                tv.removeMessage(id)
                unregister(id)
            }
        }

        // Add new messages (appended at the end of the turn)
        for (id in next) {
            if (id in prev) continue
            val msg = model.message(id) ?: continue
            val mv = tv.addMessage(msg)
            register(id, tv, mv)
        }
        tv.syncCopyToolbars()
        syncReverted()

        refresh()
    }

    private fun onTurnRemoved(id: String) {
        val tv = turnViews.remove(id) ?: return
        for (msgId in tv.messageIds()) unregister(msgId)
        remove(tv)
        Disposer.dispose(tv)
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
            val tv = TurnView(turn.id, openFile, style, openUrl, selection, openAttachment, resize, repo, ::hover, revert)
            turnViews[turn.id] = tv
            for (msgId in turn.messageIds) {
                val msg = model.message(msgId) ?: continue
                val mv = tv.addMessage(msg)
                register(msgId, tv, mv)
            }
            tv.syncCopyToolbars()
            add(tv)
        }

        syncActive(model.state)
        syncReverted()
        banner?.update()
        anchorFooter()
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
        clearHover()
        turnViews.values.forEach {
            remove(it)
            Disposer.dispose(it)
        }
        turnViews.clear()
        msgToTurn.clear()
        msgToView.clear()
        removeAll()
        syncActive(model.state)
        banner?.update()
        anchorFooter()
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

    /** Fan out the hidden question tool ref to all registered [MessageView]s. */
    private fun setHiddenQuestionTool(ref: ToolCallRef?) {
        if (hiddenTool == ref) return
        hiddenTool = ref
        for (mv in msgToView.values) mv.setHiddenQuestionTool(ref)
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

    private fun register(msgId: String, tv: TurnView, mv: MessageView) {
        msgToTurn[msgId] = tv
        msgToView[msgId] = mv
        mv.setHiddenQuestionTool(hiddenTool)
    }

    private fun unregister(msgId: String) {
        msgToTurn.remove(msgId)
        msgToView.remove(msgId)
    }

    private fun refresh() {
        revalidate()
        repaint()
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
        refresh()
    }

    override fun dispose() {
        clearHover()
        turnViews.values.forEach {
            remove(it)
            Disposer.dispose(it)
        }
        turnViews.clear()
        msgToTurn.clear()
        msgToView.clear()
        onHover = null
        removeAll()
    }
}
