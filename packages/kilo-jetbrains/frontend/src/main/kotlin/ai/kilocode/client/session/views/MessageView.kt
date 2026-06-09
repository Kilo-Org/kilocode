package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.model.StepFinish
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolCallRef
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.SessionView
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.util.ui.JBUI
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints

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
    private val openFile: (String) -> Unit,
    private var style: SessionEditorStyle = SessionEditorStyle.current(),
    private val openUrl: (String) -> Unit = {},
    private val selection: SessionSelection? = null,
) : ai.kilocode.client.session.ui.SessionLayoutPanel(
    JBUI.scale(SessionUiStyle.SessionLayout.GAP),
), Disposable, SessionEditorStyleTarget, SessionView {

    constructor(msg: Message, openFile: (String) -> Unit) : this(msg, openFile, SessionEditorStyle.current())

    val role: String get() = msg.info.role

    override val sessionViewKind: SessionView.Kind
        get() = if (role == SessionUiStyle.View.Message.USER_ROLE) SessionView.Kind.UserPrompt else SessionView.Kind.Default

    private val parts = LinkedHashMap<String, PartView>()
    private var hidden: ToolCallRef? = null

    init {
        isOpaque = false
        if (msg.info.role == SessionUiStyle.View.Message.USER_ROLE) background = style.editorScheme.defaultBackground
        border = assistantBorder()

        // Populate content that already exists (e.g. after loadHistory)
        for ((_, content) in msg.parts) {
            if (content is StepFinish) continue
            if (isHidden(content)) continue
            val view = view(content)
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
                Disposer.dispose(stale)
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
        val view = view(content)
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
        Disposer.dispose(existing)
        val view = view(content)
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
        Disposer.dispose(view)
        syncBorder()
        refresh()
    }

    /**
     * Returns true when [content] should be suppressed because it is the
     * pending/running question tool part linked to the active question.
     */
    private fun isHidden(content: Content): Boolean {
        if (content !is Tool) return false
        if (content.name == "todoread") return true
        if (content.name == "todowrite" && content.state != ToolExecState.COMPLETED) return true
        val ref = hidden ?: return false
        if (content.name != "question") return false
        if (content.state != ToolExecState.PENDING && content.state != ToolExecState.RUNNING) return false
        return msg.info.id == ref.messageId && content.callId == ref.callId
    }

    /**
     * Clear and rebuild all part views from [msg.parts].
     * Called only when the hidden ref changes to avoid unnecessary rebuilds.
     */
    private fun rebuildParts() {
        parts.values.forEach {
            remove(it)
            Disposer.dispose(it)
        }
        parts.clear()
        for ((_, content) in msg.parts) {
            if (content is StepFinish) continue
            if (isHidden(content)) continue
            val view = view(content)
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

    private fun view(content: Content) = if (msg.info.role == SessionUiStyle.View.Message.USER_ROLE) {
        ViewFactory.createUser(content, openFile, openUrl, selection)
    } else {
        ViewFactory.create(content, openFile, openUrl, selection)
    }

    /** Append a streaming delta to the renderer for [contentId]. */
    fun appendDelta(contentId: String, delta: String): Boolean {
        val part = parts[contentId] ?: return false
        part.appendDelta(delta)
        return true
    }

    /** Look up a renderer by part id. */
    fun part(id: String): PartView? = parts[id]

    /** Ordered part ids — stable for test assertions. */
    fun partIds(): List<String> = parts.keys.toList()

    /** Compact dump for test assertions. */
    fun dump(): String = parts.values.joinToString(", ") { it.dumpLabel() }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        if (msg.info.role == SessionUiStyle.View.Message.USER_ROLE) background = style.editorScheme.defaultBackground
        for (view in parts.values) view.applyStyle(style)
        refresh()
    }

    override fun dispose() {
        parts.values.forEach {
            remove(it)
            Disposer.dispose(it)
        }
        parts.clear()
        hidden = null
    }

    override fun paintComponent(g: Graphics) {
        if (msg.info.role != SessionUiStyle.View.Message.USER_ROLE) {
            super.paintComponent(g)
            return
        }
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            val arc = JBUI.scale(JBUI.getInt("Button.arc", SessionUiStyle.View.Prompt.CORNER_ARC))
            g2.color = style.editorScheme.defaultBackground
            g2.fillRoundRect(0, 0, width, height, arc, arc)
            g2.color = SessionUiStyle.View.line()
            val w = width - 1
            val h = height - 1
            if (w > 0 && h > 0) g2.drawRoundRect(0, 0, w, h, arc, arc)
        } finally {
            g2.dispose()
        }
        super.paintComponent(g)
    }

    private fun refresh() {
        revalidate()
        repaint()
    }

    private fun assistantBorder() = JBUI.Borders.empty()
}
