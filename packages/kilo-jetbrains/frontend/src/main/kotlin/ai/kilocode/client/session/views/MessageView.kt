package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.model.StepFinish
import ai.kilocode.client.session.ui.SessionView
import ai.kilocode.client.session.ui.SessionStyle
import ai.kilocode.client.session.ui.SessionStyleTarget
import ai.kilocode.client.ui.UiStyle

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
    private var style: SessionStyle = SessionStyle.current(),
) : ai.kilocode.client.session.ui.SessionLayoutPanel(UiStyle.Card.groupGap()), SessionStyleTarget, SessionView {

    constructor(msg: Message) : this(msg, SessionStyle.current())

    val role: String get() = msg.info.role

    override val sessionViewKind: SessionView.Kind
        get() = if (role == "user") SessionView.Kind.UserPrompt else SessionView.Kind.Default

    private val parts = LinkedHashMap<String, PartView>()

    init {
        isOpaque = false
        border = if (msg.info.role == "user") {
            UiStyle.Borders.user()
        } else {
            UiStyle.Borders.assistant()
        }

        // Populate content that already exists (e.g. after loadHistory)
        for ((_, content) in msg.parts) {
            if (content is StepFinish) continue
            val view = ViewFactory.create(content)
            view.applyStyle(style)
            parts[content.id] = view
            add(view)
        }
    }

    /** Add or update the renderer for [content]. */
    fun upsertPart(content: Content) {
        if (content is StepFinish) return
        val existing = parts[content.id]
        if (existing != null) {
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

    /** Remove the renderer for [contentId] if present. */
    fun removePart(contentId: String) {
        val view = parts.remove(contentId) ?: return
        remove(view)
        syncBorder()
        refresh()
    }

    private fun syncBorder() {
        if (msg.info.role != "assistant") return
        border = UiStyle.Borders.assistant()
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

    override fun applyStyle(style: SessionStyle) {
        this.style = style
        for (view in parts.values) view.applyStyle(style)
        refresh()
    }

    private fun refresh() {
        revalidate()
        repaint()
    }
}
