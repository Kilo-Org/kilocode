package ai.kilocode.client.session.views

import ai.kilocode.client.session.SessionDiffOpener
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.Compaction
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.FileAttachment
import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.model.StepFinish
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolCallRef
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.RevertProgress
import ai.kilocode.client.session.ui.SessionView
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionCopyTarget
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.session.views.tool.EditToolView
import ai.kilocode.client.session.views.tool.ApprovalReasonTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.ui.toolbarButton
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.MessageErrorDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Point
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
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
    private val revert: ((String) -> Unit)? = null,
    // Forks the session at this message. Null on surfaces that cannot fork (sidebar, read-only tabs).
    private val fork: ((String) -> Unit)? = null,
    private val onOpenSubagent: ((String, String) -> Unit)? = null,
) : ai.kilocode.client.session.ui.SessionLayoutPanel(
    SessionUiStyle.SessionLayout.GAP,
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
    // Every Content this view has been handed, in arrival order, including parts currently
    // suppressed by [isHidden]. SessionModel replaces the Message instance on every metadata delta
    // (see syncError), so msg.parts goes stale almost immediately and cannot be the rebuild source.
    // Values are the live Content instances the model mutates in place, not copies.
    private val known = LinkedHashMap<String, Content>()
    // Compact-mode tool groups, in render order, plus the reverse index from a grouped content id.
    private val groups = LinkedHashMap<String, ToolGroupView>()
    private val owner = HashMap<String, ToolGroupView>()
    private var segments = emptyList<Segment>()
    private var attachments: PromptAttachmentView? = null
    private var hidden: ToolCallRef? = null
    private var prompt: PromptView? = null
    private var promptBox: JPanel? = null
    private var wrap: PromptWrap? = null
    private var openDiff: SessionDiffOpener = { _, _, _ -> }
    private var sessionId: String? = null
    private var reverted = false
    private var failure: MessageErrorView? = null

    init {
        isOpaque = false
        if (msg.info.role == SessionUiStyle.View.Message.USER_ROLE) background = SessionUiStyle.View.Prompt.bgColor(style)
        border = assistantBorder()

        // Populate content that already exists (e.g. after loadHistory)
        for ((_, content) in msg.parts) {
            if (content is StepFinish) continue
            known[content.id] = content
            if (isHidden(content)) continue
            addPart(content)
        }
        applyPlan()
        syncVisibility()
    }

    /**
     * Show, update, or drop the failure this message ended with. Returns true when anything visible
     * changed, so the panel only relayouts on a real change — `message.updated` also fires on every
     * streamed token/cost delta.
     *
     * [SessionModel.upsertMessage] replaces the [Message] instance while this view keeps the original,
     * so the error has to be passed in rather than read back off [msg].
     */
    @RequiresEdt
    fun syncError(error: MessageErrorDto?): Boolean {
        val text = failureText(error)
        val existing = failure
        if (text == null) {
            if (existing == null) return false
            failure = null
            remove(existing)
            refresh()
            return true
        }
        if (existing != null) {
            if (!existing.setText(text)) return false
            refresh()
            return true
        }
        val view = MessageErrorView().also {
            it.applyStyle(style)
            it.setText(text)
        }
        failure = view
        add(view)
        refresh()
        return true
    }

    /** Insertion slot that keeps the failure card last, or -1 to append when there is none. */
    private fun tail(): Int = failure?.let { components.indexOf(it) } ?: -1

    fun setDiffOpener(openDiff: SessionDiffOpener, sessionId: String?) {
        this.openDiff = openDiff
        this.sessionId = sessionId
        // Rebind parts created before the opener was wired (e.g. history load), matching the
        // late-binding TurnView already does for its ModifiedFilesView card.
        for (view in parts.values) if (view is EditToolView) view.setDiffOpener(openDiff, sessionId)
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

    @RequiresEdt
    fun syncApprovalReasons(visible: Boolean): Boolean {
        var changed = false
        for (view in parts.values) {
            if (view is ApprovalReasonTarget) changed = view.syncApprovalReason(visible) || changed
        }
        if (changed) refresh()
        return changed
    }

    /** Add or update the renderer for [content]. */
    @RequiresEdt
    fun upsertPart(content: Content) {
        upsertPartChanged(content)
    }

    @RequiresEdt
    fun upsertPartChanged(content: Content): Boolean {
        if (content is StepFinish) return false
        known[content.id] = content
        if (isHidden(content)) {
            if (isPromptMention(content)) syncPromptMentions()
            // Remove any stale view for this content so it disappears when suppressed
            val id = aliases.remove(content.id)
            sources.remove(content.id)
            val grouped = owner.remove(content.id)
            if (grouped != null) {
                grouped.drop(content.id)
                parts.remove(content.id)?.let {
                    detach(it)
                    Disposer.dispose(it)
                }
                applyPlan()
                refresh()
                return true
            }
            val stale = if (id == null) parts.remove(content.id) else null
            if (stale != null) {
                if (stale is PromptAttachmentView) {
                    stale.remove(content.id)
                    if (!stale.isEmpty()) {
                        refresh()
                        return true
                    }
                    attachments = null
                }
                detach(stale)
                remove(stale)
                Disposer.dispose(stale)
                syncBorder()
                refresh()
                return true
            }
            return false
        }
        val id = aliases[content.id]
        if (id != null && content is Reasoning) {
            if (!updateAlias(content, id)) return false
            refresh()
            return true
        }
        if (id != null) {
            aliases.remove(content.id)
            sources.remove(content.id)
        }
        val group = owner[content.id]
        if (group != null && content is Tool) return updateGrouped(group, content)
        val existing = parts[content.id]
        if (existing != null) {
            if (existing is PromptAttachmentView && content is FileAttachment) {
                existing.upsert(content)
                refresh()
                return true
            }
            if (ViewFactory.shouldReplace(existing, content)) {
                replacePart(content, existing)
                return true
            }
            if (content is Text && existing is TextView && existing !is PromptView && existing.markdown() == content.content.toString()) {
                return false
            }
            existing.update(content)
            syncPromptToolbar()
            refresh()
            return true
        }
        addPart(content)
        applyPlan()
        syncBorder()
        refresh()
        return true
    }

    /**
     * Update a tool that a compact-mode group owns. While the group is collapsed no child renderer
     * exists, so only the group's summary moves; the live [Tool] stays reachable through [known] for
     * the eventual lazy build.
     */
    @RequiresEdt
    private fun updateGrouped(group: ToolGroupView, tool: Tool): Boolean {
        var changed = group.note(tool)
        val view = parts[tool.id] ?: return changed
        if (ViewFactory.shouldReplace(view, tool)) {
            // Never route a grouped child through replacePart: its index math is relative to this
            // panel, while the child lives in the group's body. The group re-derives its own order.
            parts.remove(tool.id)
            removeView(view)
            Disposer.dispose(view)
            group.rebuild()
            refresh()
            return true
        }
        view.update(tool)
        if (changed) refresh()
        return changed
    }

    @RequiresEdt
    private fun addPart(content: Content) {
        if (content is FileAttachment && role == SessionUiStyle.View.Message.USER_ROLE) {
            addAttachment(content)
            return
        }
        if (content is Reasoning) {
            // Merge into the preceding reasoning block. The decision comes from render order rather
            // than from the last created view, because a deferred group child leaves no view behind
            // and would otherwise make two reasonings separated by tools look adjacent.
            val previous = rendered().lastOrNull { it.id != content.id }
            if (previous is Reasoning) {
                val ownerId = aliases[previous.id] ?: previous.id
                val host = parts[ownerId] as? ReasoningView
                if (host != null) {
                    aliases[content.id] = host.contentId
                    sources[content.id] = content.content.toString()
                    host.update(merged(host, content, content.content.toString()))
                    return
                }
            }
        }
        // A groupable tool gets no renderer here. [applyPlan] decides whether it joins a collapsed
        // group — in which case nothing is built — or renders standalone.
        if (groupable(content)) return
        addView(content, tail())
    }

    /** Create, wire, and index the renderer for [content], inserting it at [at]. */
    @RequiresEdt
    private fun addView(content: Content, at: Int): PartView {
        val view = view(content)
        view.resize = resize
        view.hover = hover
        view.applyStyle(style)
        parts[content.id] = view
        wrapPrompt(view)?.let { add(it, at) }
        return view
    }

    /**
     * Rendered content in order: everything this view knows about, minus suppressed parts and minus
     * reasoning children that were merged into an earlier block.
     */
    @RequiresEdt
    private fun rendered(): List<Content> = known.values.filter { !isHidden(it) && it.id !in aliases }

    /** True when [content] is a tool the current compact-mode settings would put in a group. */
    private fun groupable(content: Content): Boolean = kindOf(content) != null

    /**
     * Group kind for [content], or null when it must render standalone. Only assistant messages
     * group: a user message's parts are the prompt bubble and its attachments, which have their own
     * chrome and never form tool runs.
     */
    private fun kindOf(content: Content): ToolGroupKind? {
        if (role != SessionUiStyle.View.Message.ASSISTANT_ROLE) return null
        if (content !is Tool) return null
        return groupKindOf(content)
    }

    /**
     * Segment the rendered parts into standalone cards and tool groups.
     *
     * A run collects consecutive tools of the same group kind. Runs shorter than
     * [SessionUiStyle.View.Group.MIN_RUN] stay standalone, because a group wrapping a single card
     * costs a row and a click while hiding nothing.
     */
    @RequiresEdt
    private fun plan(): List<Segment> {
        val out = mutableListOf<Segment>()
        val run = mutableListOf<String>()
        var kind: ToolGroupKind? = null

        for (content in rendered()) {
            val next = kindOf(content)
            if (next != kind) {
                flush(out, kind, run)
                kind = next
            }
            if (next == null) {
                out.add(Segment.Single(content.id))
                continue
            }
            run.add(content.id)
        }
        flush(out, kind, run)
        return out
    }

    /** Emit the pending run as a group, or as standalone cards when it is too short to be worth one. */
    private fun flush(out: MutableList<Segment>, kind: ToolGroupKind?, run: MutableList<String>) {
        if (run.isEmpty()) return
        if (kind != null && run.size >= SessionUiStyle.View.Group.MIN_RUN) {
            out.add(Segment.Grouped(kind, run.toList()))
        } else {
            run.forEach { out.add(Segment.Single(it)) }
        }
        run.clear()
    }

    /**
     * Reconcile containment with [plan]. Only the changed tail is rebuilt: an appended part leaves
     * every earlier segment untouched, so streaming costs a constant number of container operations
     * even though the plan itself is recomputed.
     */
    @RequiresEdt
    private fun applyPlan(): Boolean {
        val next = plan()
        if (next == segments) return false
        val keep = next.zip(segments).takeWhile { it.first == it.second }.count()
        for (index in segments.size - 1 downTo keep) teardown(segments[index])
        for (index in keep until next.size) build(next[index])
        segments = next
        syncBorder()
        return true
    }

    /** Detach a segment's containers, keeping every child renderer instance alive in [parts]. */
    @RequiresEdt
    private fun teardown(segment: Segment) {
        when (segment) {
            is Segment.Single -> parts[segment.id]?.let { if (it.parent === this) remove(it) }
            is Segment.Grouped -> {
                val group = groups.remove(groupId(segment)) ?: return
                group.release()
                segment.ids.forEach { owner.remove(it) }
                remove(group)
                Disposer.dispose(group)
            }
        }
    }

    @RequiresEdt
    private fun build(segment: Segment) {
        when (segment) {
            is Segment.Single -> {
                val content = known[segment.id] ?: return
                val existing = parts[segment.id]
                if (existing == null) {
                    addView(content, tail())
                    return
                }
                // A detached instance was either torn down above or released by a group. Anything
                // still parented (a prompt bubble inside its box, an attachment strip) is left alone.
                if (existing.parent == null) add(existing, tail())
            }
            is Segment.Grouped -> {
                val group = ToolGroupView(groupId(segment), segment.kind, ::groupChild)
                group.resize = resize
                group.hover = hover
                group.applyStyle(style)
                groups[group.contentId] = group
                for (id in segment.ids) {
                    owner[id] = group
                    (known[id] as? Tool)?.let { group.note(it) }
                }
                add(group, tail())
            }
        }
    }

    /**
     * Renderer for a grouped child: the retained instance when one exists, else a fresh one built
     * from the live [Content]. Called only while a group is expanded, so a collapsed group never
     * causes a build.
     */
    @RequiresEdt
    private fun groupChild(id: String): PartView? {
        parts[id]?.let { return it }
        val content = known[id] ?: return null
        val view = view(content)
        view.resize = resize
        view.hover = hover
        view.applyStyle(style)
        parts[id] = view
        return view
    }

    /** Stable synthetic id for a group, derived from the run's first content id. */
    private fun groupId(segment: Segment.Grouped): String = "group:${msg.info.id}:${segment.ids.first()}"

    /**
     * Re-derive grouping after the compact-mode settings changed. Returns true when containment
     * moved, so the caller can drop the turn's cached height and relayout once.
     */
    @RequiresEdt
    fun syncCompact(): Boolean {
        if (!applyPlan()) return false
        refresh()
        return true
    }

    /** Compact-mode groups in render order — for tests and dumps. */
    @RequiresEdt
    internal fun groupViews(): List<ToolGroupView> = groups.values.toList()

    @RequiresEdt
    private fun addAttachment(content: FileAttachment) {
        val view = attachments ?: PromptAttachmentView(msg.info.id) { openAttachment(msg.info.id, it) }.also {
            it.resize = resize
            it.hover = hover
            it.applyStyle(style)
            attachments = it
            val node = ensurePromptWrap()
            promptBox?.add(it, BorderLayout.SOUTH)
            if (node.parent == null) add(node, tail())
        }
        view.upsert(content)
        parts[content.id] = view
    }

    @RequiresEdt
    private fun updateAlias(content: Reasoning, id: String): Boolean {
        val view = parts[id] as? ReasoningView ?: return false
        val prev = sources[content.id].orEmpty()
        val next = content.content.toString()
        val delta = if (next.startsWith(prev)) next.removePrefix(prev) else next
        sources[content.id] = next
        if (delta.isEmpty()) return false
        view.update(merged(view, content, delta))
        return true
    }

    private fun merged(view: ReasoningView, content: Reasoning, delta: String) = Reasoning(view.contentId).also {
        it.done = content.done
        it.content.append(view.markdown())
        it.content.append(delta)
    }

    @RequiresEdt
    private fun replacePart(content: Content, existing: PartView) {
        // A replaced tool view is a direct child, so re-insert at its own slot. Only fall back to
        // the prompt wrap's index when the replaced view is nested inside it, otherwise the wrap's
        // lower index would push the replacement above the prompt bubble on user messages.
        val at = (if (existing.parent !== this) components.indexOf(wrap) else components.indexOfFirst { it === existing })
            .takeIf { it >= 0 } ?: componentCount
        parts.remove(content.id)
        aliases.values.removeAll { it == content.id }
        sources.keys.removeAll { it !in aliases }
        removeView(existing)
        if (existing === prompt) prompt = null
        Disposer.dispose(existing)
        val view = view(content)
        view.resize = resize
        view.hover = hover
        view.applyStyle(style)
        parts[content.id] = view
        wrapPrompt(view)?.let { add(it, at) }
        syncBorder()
        refresh()
    }

    /** Remove the renderer for [contentId] if present. */
    @RequiresEdt
    fun removePart(contentId: String) {
        removePartChanged(contentId)
    }

    @RequiresEdt
    fun removePartChanged(contentId: String): Boolean {
        known.remove(contentId)
        if (aliases.remove(contentId) != null) {
            sources.remove(contentId)
            return true
        }
        val group = owner.remove(contentId)
        if (group != null) {
            group.drop(contentId)
            parts.remove(contentId)?.let {
                removeView(it)
                Disposer.dispose(it)
            }
            applyPlan()
            refresh()
            return true
        }
        val view = parts.remove(contentId) ?: return applyPlan()
        if (view is PromptAttachmentView) {
            view.remove(contentId)
            if (!view.isEmpty()) {
                refresh()
                return true
            }
            attachments = null
        }
        aliases.values.removeAll { it == contentId }
        sources.keys.removeAll { it !in aliases }
        removeView(view)
        Disposer.dispose(view)
        if (view === prompt) prompt = null
        applyPlan()
        syncBorder()
        syncPromptWrap()
        refresh()
        return true
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
     * Clear and rebuild all part views from [known].
     * Called only when the hidden ref changes to avoid unnecessary rebuilds.
     */
    @RequiresEdt
    private fun rebuildParts() {
        groups.values.forEach {
            it.release()
            remove(it)
            Disposer.dispose(it)
        }
        groups.clear()
        owner.clear()
        segments = emptyList()
        parts.values.distinct().forEach {
            removeView(it)
            Disposer.dispose(it)
        }
        wrap?.let { remove(it) }
        parts.clear()
        aliases.clear()
        sources.clear()
        attachments = null
        prompt = null
        promptBox = null
        wrap = null
        for ((_, content) in known) {
            if (content is StepFinish) continue
            if (isHidden(content)) continue
            addPart(content)
        }
        applyPlan()
        syncBorder()
        refresh()
    }

    @RequiresEdt
    private fun syncBorder() {
        if (msg.info.role != SessionUiStyle.View.Message.ASSISTANT_ROLE) return
        border = assistantBorder()
    }

    private fun view(content: Content) = if (msg.info.role == SessionUiStyle.View.Message.USER_ROLE) {
        ViewFactory.createUser(content, openFile, openUrl, selection, repo, promptMentions(msg), { openAttachment(msg.info.id, it) }, openDiff, sessionId, onOpenSubagent)
    } else {
        ViewFactory.create(content, openFile, openUrl, selection, repo, { openAttachment(msg.info.id, it) }, openDiff, sessionId, onOpenSubagent)
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
        if (delta.isEmpty()) return false
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

    /**
     * Rendered part ids in render order — stable for test assertions. A grouped id appears even
     * while its renderer is deferred, because the transcript does render it, just summarised.
     */
    fun partIds(): List<String> = segments.flatMap {
        when (it) {
            is Segment.Single -> listOf(it.id)
            is Segment.Grouped -> it.ids
        }
    }

    /** Compact dump for test assertions. Groups print as one entry with their children nested. */
    fun dump(): String = dumpLabels().joinToString(", ")

    /**
     * One label per top-level slot, in render order. A grouped slot prints the group followed by its
     * children in brackets, and a child with no renderer yet prints as `deferred#id` — a collapsed
     * group builds nothing, so there is no label to ask for.
     */
    fun dumpLabels(): List<String> = segments.map { segment ->
        when (segment) {
            is Segment.Single -> parts[segment.id]?.dumpLabel() ?: "deferred#${segment.id}"
            is Segment.Grouped -> {
                val group = groups[groupId(segment)]
                val children = segment.ids.joinToString(", ") { parts[it]?.dumpLabel() ?: "deferred#$it" }
                "${group?.dumpLabel() ?: "ToolGroupView"}[$children]"
            }
        }
    }

    @RequiresEdt
    fun promptToolbarActive() = promptToolbar?.active() == true

    @RequiresEdt
    fun setReverting(active: Boolean, text: String, onCancel: () -> Unit) {
        if (role != SessionUiStyle.View.Message.USER_ROLE) return
        wrap?.setReverting(active, text, onCancel)
    }

    @RequiresEdt
    fun setQueued(active: Boolean, onDelete: () -> Unit) {
        if (role != SessionUiStyle.View.Message.USER_ROLE) return
        wrap?.setQueued(active, onDelete)
    }

    private val promptToolbar: MessageToolbar?
        get() = wrap?.bar

    @RequiresEdt
    private fun syncPromptToolbar() {
        promptToolbar?.setActive(prompt?.copyMarkdown(trim = false)?.isNotEmpty() == true)
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        if (msg.info.role == SessionUiStyle.View.Message.USER_ROLE) background = SessionUiStyle.View.Prompt.bgColor(style)
        for (view in parts.values) view.applyStyle(style)
        for (group in groups.values) group.applyStyle(style)
        failure?.applyStyle(style)
        refresh()
    }

    @RequiresEdt
    override fun dispose() {
        groups.values.forEach {
            it.release()
            remove(it)
            Disposer.dispose(it)
        }
        groups.clear()
        owner.clear()
        segments = emptyList()
        parts.values.forEach {
            removeView(it)
            Disposer.dispose(it)
        }
        wrap?.let { remove(it) }
        failure?.let { remove(it) }
        failure = null
        parts.clear()
        aliases.clear()
        sources.clear()
        known.clear()
        prompt = null
        promptBox = null
        wrap = null
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
        // Historical user prompts render their text as a plain child that relies on this surface fill,
        // so paint it whenever the message has content. An empty user message (a bare turn anchor with
        // no parts) lays out ~1px tall; painting its bubble there would leave a thin light stripe at
        // the top of the turn, so skip it.
        if (componentCount > 0) paintPromptBox(g, this)
        super.paintComponent(g)
    }

    private fun paintPromptBox(g: Graphics, box: JComponent) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            val arc = JBUI.scale(SessionUiStyle.View.BLOCK_ARC)
            val pt = if (box === this) Point() else SwingUtilities.convertPoint(box, Point(), this)
            g2.color = SessionUiStyle.View.Prompt.bgColor(style)
            g2.fillRoundRect(pt.x, pt.y, box.width, box.height, arc, arc)
        } finally {
            g2.dispose()
        }
    }

    /**
     * Mark this message as reverted (rolled back). A reverted message is hidden regardless of its
     * content; the panel drives this from the model's revert state.
     */
    @RequiresEdt
    fun setReverted(value: Boolean) {
        reverted = value
        syncVisibility()
    }

    /**
     * An empty message (no rendered parts) would otherwise lay out as a ~1px row and add a stray gap
     * at the top of its turn — a bare user turn anchor is the common case. Keep such a message present
     * for lookup/streaming but invisible so [ai.kilocode.client.session.ui.SessionLayout] skips it and
     * its gap; it reappears as soon as content arrives. Reverted messages stay hidden either way.
     */
    @RequiresEdt
    private fun syncVisibility() {
        isVisible = componentCount > 0 && !reverted
    }

    @RequiresEdt
    private fun refresh() {
        syncVisibility()
        revalidate()
        repaint()
    }

    @RequiresEdt
    private fun detach(view: PartView) {
        view.setHovered(false)
        view.hover = null
    }

    @RequiresEdt
    private fun removeView(view: PartView) {
        detach(view)
        view.parent?.remove(view)
    }

    @RequiresEdt
    private fun wrapPrompt(view: PartView): JComponent? {
        if (role != SessionUiStyle.View.Message.USER_ROLE) return view
        if (view !is PromptView) return view
        prompt = view
        val node = ensurePromptWrap()
        val box = promptBox ?: return node
        if (view.parent !== box) box.add(view, BorderLayout.CENTER)
        node.bar.setActive(true)
        return node.takeIf { it.parent == null }
    }

    @RequiresEdt
    private fun ensurePromptWrap(): PromptWrap {
        val existing = wrap
        if (existing != null) return existing
        val box = JPanel(BorderLayout()).also {
            it.isOpaque = false
            promptBox = it
        }
        return PromptWrap(box).also { wrap = it }
    }

    @RequiresEdt
    private fun syncPromptWrap() {
        val node = wrap ?: return
        val box = promptBox ?: return
        if (box.componentCount > 0) return
        node.parent?.remove(node)
        wrap = null
        promptBox = null
    }

    private inner class PromptWrap(
        private val box: JPanel,
    ) : JPanel(BorderLayout()), SessionCopyTarget {
        private val footer = JPanel(BorderLayout()).also { it.isOpaque = false }
        val bar = MessageToolbar(
            { prompt?.copyMarkdown(trim = false) },
            revert?.let { fn -> { fn(msg.info.id) } },
            fork?.let { fn -> { fn(msg.info.id) } },
        )
        private val placeholder = bar.placeholder()
        private var reverting = false
        private var progress: RevertProgress? = null
        private var queuedRow: JPanel? = null
        private var queued = false

        override val copyAnchor: JComponent get() = placeholder
        override val copyToolbar: JComponent? get() = if (reverting || queued) null else bar

        init {
            isOpaque = false
            add(box, BorderLayout.CENTER)
            footer.border = JBUI.Borders.emptyTop(UiStyle.Gap.xs())
            footer.add(placeholder.align(HAlign.RIGHT, VAlign.TOP), BorderLayout.CENTER)
            add(footer, BorderLayout.SOUTH)
        }

        override fun copyText(): String? = prompt?.copyMarkdown(trim = false)

        @RequiresEdt
        fun setReverting(active: Boolean, text: String, onCancel: () -> Unit) {
            if (active) {
                val node = progress ?: RevertProgress(onCancel).also {
                    it.applyStyle(style)
                    progress = it
                }
                node.setText(text)
                if (reverting) return
                reverting = true
                swapFooter(node.align(HAlign.LEFT, VAlign.TOP))
                revalidate()
                repaint()
                return
            }
            if (!reverting) return
            reverting = false
            swapFooter(placeholder.align(HAlign.RIGHT, VAlign.TOP))
            revalidate()
            repaint()
        }

        @RequiresEdt
        fun setQueued(active: Boolean, onDelete: () -> Unit) {
            if (active) {
                val node = queuedRow ?: queue(onDelete).also { queuedRow = it }
                if (queued) return
                queued = true
                swapFooter(node.align(HAlign.RIGHT, VAlign.TOP))
                revalidate()
                repaint()
                return
            }
            if (!queued) return
            queued = false
            swapFooter(placeholder.align(HAlign.RIGHT, VAlign.TOP))
            revalidate()
            repaint()
        }

        private fun swapFooter(node: JComponent) {
            footer.removeAll()
            footer.add(node, BorderLayout.CENTER)
        }

        private fun queue(onDelete: () -> Unit) = Stack.horizontal(UiStyle.Gap.sm()).also { row ->
            row.isOpaque = false
            row.next(JBLabel(KiloBundle.message("session.queued")).apply {
                foreground = SessionUiStyle.Text.Secondary.foreground()
            })
            row.next(toolbarButton(
                ToolbarButtonAction(
                    AllIcons.Actions.Close,
                    KiloBundle.message("session.queued.remove"),
                    onDelete,
                ),
            ))
        }
    }

    private fun assistantBorder() = JBUI.Borders.empty()

    /**
     * One top-level slot in this message. Value equality drives the containment diff in [applyPlan],
     * so an appended part leaves every earlier slot untouched.
     */
    private sealed interface Segment {
        data class Single(val id: String) : Segment
        data class Grouped(val kind: ToolGroupKind, val ids: List<String>) : Segment
    }
}
