package ai.kilocode.client.session.views

import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.Compaction
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.FileAttachment
import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.model.Reasoning
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
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Point
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.Container
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingUtilities

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
    private val openFile: SessionFileOpener,
    private var style: SessionEditorStyle = SessionEditorStyle.current(),
    private val openUrl: (String) -> Unit = {},
    private val selection: SessionSelection? = null,
    private val openAttachment: (String, FileAttachment) -> Unit = { _, item -> AttachmentView.openDefault(item, openFile, openUrl) },
    private val resize: ((JComponent, () -> Unit) -> Unit)? = null,
    private val repo: String? = null,
    private val hover: ((PartView, Boolean) -> Unit)? = null,
) : ai.kilocode.client.session.ui.SessionLayoutPanel(
    JBUI.scale(SessionUiStyle.SessionLayout.GAP),
), Disposable, SessionEditorStyleTarget, SessionView {

    val role: String get() = msg.info.role

    override val sessionViewKind: SessionView.Kind
        get() = if (role == SessionUiStyle.View.Message.USER_ROLE && !compaction) {
            SessionView.Kind.UserPrompt
        } else {
            SessionView.Kind.Default
        }

    private val compaction: Boolean
        get() = role == SessionUiStyle.View.Message.USER_ROLE && msg.parts.values.any { it is Compaction }

    private val parts = LinkedHashMap<String, PartView>()
    // Adjacent reasoning parts render through the first ReasoningView. aliases maps each
    // merged child id to that owner id, and sources stores the child's latest full text
    // so snapshot updates can append only deltas.
    private val aliases = LinkedHashMap<String, String>()
    private val sources = LinkedHashMap<String, String>()
    private var attachments: PromptAttachmentView? = null
    private var hidden: ToolCallRef? = null
    private var prompt: PromptView? = null
    private var promptBox: JPanel? = null
    private var promptToolbar: MessageToolbar? = null
    private var promptHover = false

    init {
        isOpaque = false
        if (msg.info.role == SessionUiStyle.View.Message.USER_ROLE) background = style.editorScheme.defaultBackground
        border = assistantBorder()
        if (msg.info.role == SessionUiStyle.View.Message.USER_ROLE) {
            addMouseListener(object : MouseAdapter() {
                override fun mouseEntered(e: MouseEvent) {
                    setPromptHovered(true)
                }

                override fun mouseExited(e: MouseEvent) {
                    setPromptHovered(false)
                }
            })
        }

        // Populate content that already exists (e.g. after loadHistory)
        for ((_, content) in msg.parts) {
            if (content is StepFinish) continue
            if (isHidden(content)) continue
            addPart(content)
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
    @RequiresEdt
    fun upsertPart(content: Content) {
        if (content is StepFinish) return
        if (isHidden(content)) {
            if (isPromptMention(content)) syncPromptMentions()
            // Remove any stale view for this content so it disappears when suppressed
            val id = aliases.remove(content.id)
            sources.remove(content.id)
            val stale = if (id == null) parts.remove(content.id) else null
            if (stale != null) {
                if (stale is PromptAttachmentView) {
                    stale.remove(content.id)
                    if (!stale.isEmpty()) {
                        refresh()
                        return
                    }
                    attachments = null
                }
                detach(stale)
                remove(stale)
                Disposer.dispose(stale)
                syncBorder()
                refresh()
            }
            return
        }
        val id = aliases[content.id]
        if (id != null && content is Reasoning) {
            updateAlias(content, id)
            refresh()
            return
        }
        if (id != null) {
            aliases.remove(content.id)
            sources.remove(content.id)
        }
        val existing = parts[content.id]
        if (existing != null) {
            if (existing is PromptAttachmentView && content is FileAttachment) {
                existing.upsert(content)
                refresh()
                return
            }
            if (ViewFactory.shouldReplace(existing, content)) {
                replacePart(content, existing)
                return
            }
            existing.update(content)
            syncPromptToolbar()
            refresh()
            return
        }
        addPart(content)
        syncBorder()
        refresh()
    }

    @RequiresEdt
    private fun addPart(content: Content) {
        if (content is FileAttachment && role == SessionUiStyle.View.Message.USER_ROLE) {
            addAttachment(content)
            return
        }
        if (content is Reasoning) {
            val previous = parts.values.lastOrNull()
            if (previous is ReasoningView) {
                aliases[content.id] = previous.contentId
                sources[content.id] = content.content.toString()
                previous.update(merged(previous, content, content.content.toString()))
                return
            }
        }
        val view = view(content)
        val item = wrapPrompt(view)
        view.resize = resize
        view.hover = hover
        view.applyStyle(style)
        parts[content.id] = view
        add(item)
    }

    @RequiresEdt
    private fun addAttachment(content: FileAttachment) {
        val view = attachments ?: PromptAttachmentView(msg.info.id) { openAttachment(msg.info.id, it) }.also {
            it.resize = resize
            it.hover = hover
            it.applyStyle(style)
            attachments = it
            add(it)
        }
        view.upsert(content)
        parts[content.id] = view
    }

    @RequiresEdt
    private fun updateAlias(content: Reasoning, id: String) {
        val view = parts[id] as? ReasoningView ?: return
        val prev = sources[content.id].orEmpty()
        val next = content.content.toString()
        val delta = if (next.startsWith(prev)) next.removePrefix(prev) else next
        sources[content.id] = next
        if (delta.isEmpty()) return
        view.update(merged(view, content, delta))
    }

    private fun merged(view: ReasoningView, content: Reasoning, delta: String) = Reasoning(view.contentId).also {
        it.done = content.done
        it.content.append(view.markdown())
        it.content.append(delta)
    }

    @RequiresEdt
    private fun replacePart(content: Content, existing: PartView) {
        val at = components.indexOfFirst { it === existing }.takeIf { it >= 0 } ?: componentCount
        parts.remove(content.id)
        aliases.values.removeAll { it == content.id }
        sources.keys.removeAll { it !in aliases }
        detach(existing)
        remove(existing)
        Disposer.dispose(existing)
        val view = view(content)
        val item = wrapPrompt(view)
        view.resize = resize
        view.hover = hover
        view.applyStyle(style)
        parts[content.id] = view
        add(item, at)
        syncBorder()
        refresh()
    }

    /** Remove the renderer for [contentId] if present. */
    @RequiresEdt
    fun removePart(contentId: String) {
        if (aliases.remove(contentId) != null) {
            sources.remove(contentId)
            return
        }
        val view = parts.remove(contentId) ?: return
        if (view is PromptAttachmentView) {
            view.remove(contentId)
            if (!view.isEmpty()) {
                refresh()
                return
            }
            attachments = null
        }
        aliases.values.removeAll { it == contentId }
        sources.keys.removeAll { it !in aliases }
        detach(view)
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
        if (isPromptMention(content)) return true
        if (content !is Tool) return false
        if (role == SessionUiStyle.View.Message.USER_ROLE && content.name == "read") return true
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
    @RequiresEdt
    private fun rebuildParts() {
        parts.values.distinct().forEach {
            detach(it)
            remove(it)
            Disposer.dispose(it)
        }
        parts.clear()
        aliases.clear()
        sources.clear()
        attachments = null
        prompt = null
        promptBox = null
        promptToolbar = null
        promptHover = false
        for ((_, content) in msg.parts) {
            if (content is StepFinish) continue
            if (isHidden(content)) continue
            addPart(content)
        }
        syncBorder()
        refresh()
    }

    @RequiresEdt
    private fun syncBorder() {
        if (msg.info.role != SessionUiStyle.View.Message.ASSISTANT_ROLE) return
        border = assistantBorder()
    }

    private fun view(content: Content) = if (msg.info.role == SessionUiStyle.View.Message.USER_ROLE) {
        ViewFactory.createUser(content, openFile, openUrl, selection, repo, promptMentions(msg)) { openAttachment(msg.info.id, it) }
    } else {
        ViewFactory.create(content, openFile, openUrl, selection, repo) { openAttachment(msg.info.id, it) }
    }

    private fun syncPromptMentions() {
        val mentions = promptMentions(msg)
        for (view in parts.values) {
            if (view is PromptView) view.setMentions(mentions)
        }
    }

    private fun isPromptMention(content: Content): Boolean {
        if (role != SessionUiStyle.View.Message.USER_ROLE) return false
        if (content !is FileAttachment) return false
        return content.source != null && content.mime.lowercase().startsWith("text/plain")
    }

    /** Append a streaming delta to the renderer for [contentId]. */
    @RequiresEdt
    fun appendDelta(contentId: String, delta: String): Boolean {
        val id = aliases[contentId]
        if (id != null) sources[contentId] = sources[contentId].orEmpty() + delta
        val part = parts[id ?: contentId] ?: return false
        part.appendDelta(delta)
        syncPromptToolbar()
        return true
    }

    @RequiresEdt
    fun syncCopyToolbar(copyId: String?) {
        if (role == SessionUiStyle.View.Message.USER_ROLE) return
        for ((id, view) in parts) {
            if (view is TextView) view.setCopyToolbar(id == copyId)
        }
    }

    @RequiresEdt
    fun latestAssistantCopyId(): String? {
        if (role != SessionUiStyle.View.Message.ASSISTANT_ROLE) return null
        for ((id, view) in parts.entries.reversed()) {
            if (view is TextView && view.markdown().isNotBlank()) return id
        }
        return null
    }

    /** Look up a renderer by part id. */
    fun part(id: String): PartView? = parts[aliases[id] ?: id]

    /** Ordered part ids — stable for test assertions. */
    fun partIds(): List<String> = parts.keys.toList()

    /** Compact dump for test assertions. */
    fun dump(): String = parts.values.joinToString(", ") { it.dumpLabel() }

    @RequiresEdt
    fun setPromptHovered(value: Boolean) {
        if (role != SessionUiStyle.View.Message.USER_ROLE) return
        if (promptHover == value) return
        promptHover = value
        syncPromptToolbar()
    }

    @RequiresEdt
    fun paintsPromptToolbar() = promptToolbar?.paints() == true

    @RequiresEdt
    fun promptToolbarAlignment() = promptToolbar?.alignment()

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        if (msg.info.role == SessionUiStyle.View.Message.USER_ROLE) background = style.editorScheme.defaultBackground
        for (view in parts.values) view.applyStyle(style)
        refresh()
    }

    @RequiresEdt
    override fun dispose() {
        parts.values.forEach {
            detach(it)
            remove(it)
            Disposer.dispose(it)
        }
        parts.clear()
        aliases.clear()
        sources.clear()
        prompt = null
        promptBox = null
        promptToolbar = null
        promptHover = false
        hidden = null
    }

    override fun paintComponent(g: Graphics) {
        if (msg.info.role != SessionUiStyle.View.Message.USER_ROLE || compaction) {
            super.paintComponent(g)
            return
        }
        val box = promptBox
        if (box != null) {
            paintPromptBox(g, box)
            super.paintComponent(g)
            return
        }
        paintPromptBox(g, this)
        super.paintComponent(g)
    }

    private fun paintPromptBox(g: Graphics, box: JComponent) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            val arc = JBUI.scale(JBUI.getInt("Button.arc", SessionUiStyle.View.Prompt.CORNER_ARC))
            val pt = if (box === this) Point() else SwingUtilities.convertPoint(box, Point(), this)
            val x = pt.x
            val y = pt.y
            val w = box.width - 1
            val h = box.height - 1
            g2.color = style.editorScheme.defaultBackground
            g2.fillRoundRect(x, y, box.width, box.height, arc, arc)
            g2.color = SessionUiStyle.View.Outline.color()
            if (w > 0 && h > 0) g2.drawRoundRect(x, y, w, h, arc, arc)
        } finally {
            g2.dispose()
        }
    }

    @RequiresEdt
    private fun refresh() {
        revalidate()
        repaint()
    }

    @RequiresEdt
    private fun detach(view: PartView) {
        view.setHovered(false)
        view.hover = null
    }

    @RequiresEdt
    private fun syncPromptToolbar() {
        promptToolbar?.paint(promptHover)
    }

    @RequiresEdt
    private fun wrapPrompt(view: PartView): JComponent {
        if (role != SessionUiStyle.View.Message.USER_ROLE) return view
        if (view !is PromptView) return view
        prompt = view
        val bar = promptToolbar ?: MessageToolbar(BorderLayout.LINE_END) { prompt?.copyMarkdown(trim = false) }.also { promptToolbar = it }
        val box = JPanel(BorderLayout()).also {
            it.isOpaque = false
            it.add(view, BorderLayout.CENTER)
            promptBox = it
        }
        bar.paint(false)
        return JPanel(BorderLayout()).also {
            it.isOpaque = false
            it.add(box, BorderLayout.CENTER)
            it.add(bar, BorderLayout.SOUTH)
            installPromptHover(it)
        }
    }

    @RequiresEdt
    private fun installPromptHover(root: JComponent) {
        val mouse = object : MouseAdapter() {
            override fun mouseEntered(e: MouseEvent) {
                setPromptHovered(true)
            }

            override fun mouseExited(e: MouseEvent) {
                val point = runCatching { root.mousePosition }.getOrNull()
                if (point != null && root.contains(point)) return
                if (inside(root, e)) return
                setPromptHovered(false)
            }
        }
        visit(root) { it.addMouseListener(mouse) }
    }

    @RequiresEdt
    private fun inside(root: JComponent, e: MouseEvent): Boolean {
        val point = SwingUtilities.convertPoint(e.component, e.point, root)
        return root.contains(point)
    }

    @RequiresEdt
    private fun visit(root: Container, fn: (JComponent) -> Unit) {
        if (root is JComponent) fn(root)
        for (child in root.components) {
            if (child is Container) visit(child, fn)
        }
    }

    private fun assistantBorder() = JBUI.Borders.empty()
}
