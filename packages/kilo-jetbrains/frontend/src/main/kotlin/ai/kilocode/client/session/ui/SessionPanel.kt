package ai.kilocode.client.session.ui

import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.views.MessageView
import ai.kilocode.client.session.views.TurnView
import com.intellij.openapi.Disposable
import com.intellij.util.ui.JBUI

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
 * All method calls must happen on the EDT.
 */
class SessionPanel(
    private val model: SessionModel,
    parent: Disposable,
) : SessionLayoutPanel() {

    private val turnViews = LinkedHashMap<String, TurnView>()
    private val msgToTurn = HashMap<String, TurnView>()
    private val msgToView = HashMap<String, MessageView>()

    /** Progress footer — always the last child inside the scroll. */
    val progress = ProgressPanel(model, parent)

    init {
        isOpaque = false
        border = JBUI.Borders.empty(JBUI.scale(4), JBUI.scale(8))

        model.addListener(parent) { event ->
            when (event) {
                is SessionModelEvent.TurnAdded -> onTurnAdded(event.turn)
                is SessionModelEvent.TurnUpdated -> onTurnUpdated(event.turn)
                is SessionModelEvent.TurnRemoved -> onTurnRemoved(event.id)

                is SessionModelEvent.ContentAdded ->
                    msgToView[event.messageId]?.upsertPart(event.content)

                is SessionModelEvent.ContentUpdated ->
                    msgToView[event.messageId]?.upsertPart(event.content)

                is SessionModelEvent.ContentRemoved ->
                    msgToView[event.messageId]?.removePart(event.contentId)

                is SessionModelEvent.ContentDelta -> {
                    // Use the full current content from the model rather than
                    // an incremental append. This avoids the double-write that
                    // occurs when ContentAdded and ContentDelta both fire for
                    // the same first delta (the model auto-creates the content
                    // on first appendDelta and fires both events in sequence).
                    val content = model.content(event.messageId, event.contentId)
                    if (content != null) msgToView[event.messageId]?.upsertPart(content)
                }

                is SessionModelEvent.HistoryLoaded -> rebuild()
                is SessionModelEvent.Cleared -> clear()

                // Message events: structural changes are handled via turn events above.
                // State/diff/todos changes are handled by other panels in SessionUi.
                is SessionModelEvent.MessageAdded,
                is SessionModelEvent.MessageUpdated,
                is SessionModelEvent.MessageRemoved,
                is SessionModelEvent.StateChanged,
                is SessionModelEvent.DiffUpdated,
                is SessionModelEvent.TodosUpdated,
                is SessionModelEvent.Compacted -> Unit
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
        val tv = TurnView(turn.id)
        turnViews[turn.id] = tv
        for (msgId in turn.messageIds) {
            val msg = model.message(msgId) ?: continue
            val mv = tv.addMessage(msg)
            register(msgId, tv, mv)
        }
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

        refresh()
    }

    private fun onTurnRemoved(id: String) {
        val tv = turnViews.remove(id) ?: return
        for (msgId in tv.messageIds()) unregister(msgId)
        remove(tv)
        anchorFooter()
        refresh()
    }

    private fun rebuild() {
        turnViews.clear()
        msgToTurn.clear()
        msgToView.clear()
        removeAll()

        for (turn in model.turns()) {
            val tv = TurnView(turn.id)
            turnViews[turn.id] = tv
            for (msgId in turn.messageIds) {
                val msg = model.message(msgId) ?: continue
                val mv = tv.addMessage(msg)
                register(msgId, tv, mv)
            }
            add(tv)
        }

        anchorFooter()
        refresh()
    }

    private fun clear() {
        turnViews.clear()
        msgToTurn.clear()
        msgToView.clear()
        removeAll()
        anchorFooter()
        refresh()
    }

    /** Re-insert [progress] as the last child so it always renders after all turn views. */
    private fun anchorFooter() {
        remove(progress)
        add(progress)
    }

    private fun register(msgId: String, tv: TurnView, mv: MessageView) {
        msgToTurn[msgId] = tv
        msgToView[msgId] = mv
    }

    private fun unregister(msgId: String) {
        msgToTurn.remove(msgId)
        msgToView.remove(msgId)
    }

    private fun refresh() {
        revalidate()
        repaint()
    }
}
