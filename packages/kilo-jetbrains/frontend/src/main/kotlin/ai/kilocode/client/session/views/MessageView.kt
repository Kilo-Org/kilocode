package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.model.StepFinish
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolCallRef
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.SessionView
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.ui.RoundedLineBorder
import com.intellij.util.ui.JBUI

/**
 * A single message container inside a [TurnView].
 *
 * Holds an ordered map of [PartView]s keyed by part id. The layout is
 * driven by [ai.kilocode.client.session.ui.SessionLayout] so that each
 * part view gets the full available width and height is computed correctly
 * for HTML-backed views.
 *
 * Styling: user messages render as rounded prompt bubbles. Spacing around
 * messages is owned by [ai.kilocode.client.session.ui.SessionLayout].
 */
class MessageView(
    val msg: Message,
    private var style: SessionEditorStyle = SessionEditorStyle.current(),
) : ai.kilocode.client.session.ui.SessionLayoutPanel(
    JBUI.scale(SessionUiStyle.SessionLayout.GAP),
), SessionEditorStyleTarget, SessionView {

    constructor(msg: Message) : this(msg, SessionEditorStyle.current())

    val role: String get() = msg.info.role

    override val sessionViewKind: SessionView.Kind
        get() = if (role == SessionUiStyle.View.Message.USER_ROLE) SessionView.Kind.UserPrompt else SessionView.Kind.Default

    private val parts = LinkedHashMap<String, PartView>()
    private var hidden: ToolCallRef? = null

    init {
        isOpaque = false
        border = if (msg.info.role == SessionUiStyle.View.Message.USER_ROLE) {
            userBorder()
        } else {
            assistantBorder()
        }

        // Populate content that already exists (e.g. after loadHistory)
        for ((_, content) in msg.parts) {
            if (content is StepFinish) continue
            if (isHidden(content)) continue
            val view = ViewFactory.create(content)
            view.applyStyle(style)
            parts[content.id] = view
            add(view)
        }
    }

    /**
     * Suppress the running/pending question tool part that matches [ref] while
     * the linked question request is active. Pass null to stop suppressing.
     */
    fun setHiddenQuestionTool(ref: ToolCallRef?) {
        if (hidden == ref) return
        hidden = ref
        rebuildParts()
    }

    /** Add or update the renderer for [content]. */
    fun upsertPart(content: Content) {
        if (content is StepFinish) return
        if (isHidden(content)) {
            // Remove any stale view for this content so it disappears when suppressed
            val stale = parts.remove(content.id)
            if (stale != null) {
                remove(stale)
                syncBorder()
                refresh()
            }
            return
        }
        val existing = parts[content.id]
        if (existing != null) {
            if (ViewFactory.shouldReplace(existing, content)) {
                replacePart(content, existing)
                return
            }
            existing.update(content)
            refresh()
            return
        }
        val view = ViewFactory.create(content)
        view.applyStyle(style)
        parts[content.id] = view
        add(view)
        syncBorder()
        refresh()
    }

    private fun replacePart(content: Content, existing: PartView) {
        val at = components.indexOfFirst { it === existing }.takeIf { it >= 0 } ?: componentCount
        parts.remove(content.id)
        remove(existing)
        val view = ViewFactory.create(content)
        view.applyStyle(style)
        parts[content.id] = view
        add(view, at)
        syncBorder()
        refresh()
    }

    /** Remove the renderer for [contentId] if present. */
    fun removePart(contentId: String) {
        val view = parts.remove(contentId) ?: return
        remove(view)
        syncBorder()
        refresh()
    }

    /**
     * Returns true when [content] should be suppressed because it is the
     * pending/running question tool part linked to the active question.
     */
    private fun isHidden(content: Content): Boolean {
        val ref = hidden ?: return false
        if (content !is Tool) return false
        if (content.name != "question") return false
        if (content.state != ToolExecState.PENDING && content.state != ToolExecState.RUNNING) return false
        return msg.info.id == ref.messageId && content.callId == ref.callId
    }

    /**
     * Clear and rebuild all part views from [msg.parts].
     * Called only when the hidden ref changes to avoid unnecessary rebuilds.
     */
    private fun rebuildParts() {
        parts.values.forEach { remove(it) }
        parts.clear()
        for ((_, content) in msg.parts) {
            if (content is StepFinish) continue
            if (isHidden(content)) continue
            val view = ViewFactory.create(content)
            view.applyStyle(style)
            parts[content.id] = view
            add(view)
        }
        syncBorder()
        refresh()
    }

    private fun syncBorder() {
        if (msg.info.role != SessionUiStyle.View.Message.ASSISTANT_ROLE) return
        border = assistantBorder()
    }

    /** Append a streaming delta to the renderer for [contentId]. */
    fun appendDelta(contentId: String, delta: String) {
        val part = parts[contentId] ?: return
        part.appendDelta(delta)
        refresh()
    }

    /** Look up a renderer by part id. */
    fun part(id: String): PartView? = parts[id]

    /** Ordered part ids — stable for test assertions. */
    fun partIds(): List<String> = parts.keys.toList()

    /** Compact dump for test assertions. */
    fun dump(): String = parts.values.joinToString(", ") { it.dumpLabel() }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        for (view in parts.values) view.applyStyle(style)
        refresh()
    }

    private fun refresh() {
        revalidate()
        repaint()
    }

    private fun userBorder() = JBUI.Borders.compound(
        RoundedLineBorder(SessionUiStyle.View.line(), JBUI.scale(SessionUiStyle.View.Message.USER_BORDER_ARC)),
        JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.Message.USER_BORDER_VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Message.USER_BORDER_HORIZONTAL_PADDING),
        ),
    )!!

    private fun assistantBorder() = JBUI.Borders.empty()
}
