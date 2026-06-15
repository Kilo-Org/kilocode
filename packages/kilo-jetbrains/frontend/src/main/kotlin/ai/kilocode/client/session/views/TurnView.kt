package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.ui.SessionLayoutPanel
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.PartView
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.util.ui.JBUI
import javax.swing.JComponent

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
    private val openFile: (String) -> Unit,
    private var style: SessionEditorStyle = SessionEditorStyle.current(),
    private val openUrl: (String) -> Unit = {},
    private val selection: SessionSelection? = null,
    private val resize: ((JComponent, () -> Unit) -> Unit)? = null,
    private val repo: String? = null,
    private val hover: ((PartView, Boolean) -> Unit)? = null,
) : SessionLayoutPanel(JBUI.scale(SessionUiStyle.SessionLayout.GAP)), Disposable, SessionEditorStyleTarget {

    constructor(id: String, openFile: (String) -> Unit) : this(id, openFile, SessionEditorStyle.current())

    private val messages = LinkedHashMap<String, MessageView>()

    init {
        isOpaque = false
    }

    /** Add a new [MessageView] for [msg] at the end of this turn. */
    fun addMessage(msg: Message): MessageView {
        val view = MessageView(msg, openFile, style, openUrl, selection, resize, repo, hover)
        messages[msg.info.id] = view
        add(view)
        revalidate()
        return view
    }

    /** Remove the [MessageView] for [msgId] if present. */
    fun removeMessage(msgId: String) {
        val view = messages.remove(msgId) ?: return
        remove(view)
        Disposer.dispose(view)
        revalidate()
    }

    /** Look up a nested [MessageView] by message id. */
    fun messageView(id: String): MessageView? = messages[id]

    /** Ordered message ids currently displayed — stable for test assertions. */
    fun messageIds(): List<String> = messages.keys.toList()

    /** Compact dump for test assertions. */
    fun dump(): String = messages.entries.joinToString(", ") { (id, mv) -> "${mv.role}#$id" }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        for (view in messages.values) view.applyStyle(style)
        revalidate()
        repaint()
    }

    override fun dispose() {
        messages.values.forEach {
            remove(it)
            Disposer.dispose(it)
        }
        messages.clear()
    }
}
