package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.ui.SessionLayoutPanel
import ai.kilocode.client.session.ui.SessionStyle
import ai.kilocode.client.session.ui.SessionStyleTarget
import ai.kilocode.client.ui.UiStyle

/**
 * Top-level transcript item representing one conversational turn.
 *
 * A turn contains one user [MessageView] (the "anchor") and the consecutive
 * assistant [MessageView]s that follow it. The turn id matches the user anchor
 * message id, or the first assistant message id when no user message precedes.
 *
 * Children are stacked by [ai.kilocode.client.session.ui.SessionLayout].
 */
class TurnView(
    val id: String,
    private var style: SessionStyle = SessionStyle.current(),
) : SessionLayoutPanel(UiStyle.Card.groupGap()), SessionStyleTarget {

    constructor(id: String) : this(id, SessionStyle.current())

    private val messages = LinkedHashMap<String, MessageView>()

    init {
        isOpaque = false
    }

    /** Add a new [MessageView] for [msg] at the end of this turn. */
    fun addMessage(msg: Message): MessageView {
        val view = MessageView(msg, style)
        messages[msg.info.id] = view
        add(view)
        revalidate()
        return view
    }

    /** Remove the [MessageView] for [msgId] if present. */
    fun removeMessage(msgId: String) {
        val view = messages.remove(msgId) ?: return
        remove(view)
        revalidate()
    }

    /** Look up a nested [MessageView] by message id. */
    fun messageView(id: String): MessageView? = messages[id]

    /** Ordered message ids currently displayed — stable for test assertions. */
    fun messageIds(): List<String> = messages.keys.toList()

    /** Compact dump for test assertions. */
    fun dump(): String = messages.entries.joinToString(", ") { (id, mv) -> "${mv.role}#$id" }

    override fun applyStyle(style: SessionStyle) {
        this.style = style
        for (view in messages.values) view.applyStyle(style)
        revalidate()
        repaint()
    }
}
