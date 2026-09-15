package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.SessionLayoutPanel
import ai.kilocode.client.session.ui.popup.HeaderPopupRequest
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.AbstractSessionPartView
import ai.kilocode.client.session.views.base.PartHeader
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.session.views.tool.setFont
import ai.kilocode.client.session.views.tool.setForeground
import ai.kilocode.client.session.views.tool.setIcon
import ai.kilocode.client.session.views.tool.setText
import ai.kilocode.client.ui.UiStyle
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Insets

/**
 * Compact-mode summary card for a run of consecutive tool calls.
 *
 * While collapsed the group owns nothing but the content ids in the run and each id's
 * [ToolExecState], so the header is derived without a single child renderer existing. Child cards
 * are built on first expansion through [make] — which routes back to the owning
 * [MessageView] so that view stays the sole creator and disposer — and are then *retained*: a
 * collapse only detaches them, and re-expanding reuses the same instances.
 *
 * The group never auto-expands. A running or failed tool is reported in the header instead, so
 * compact mode stays compact while the turn streams.
 */
class ToolGroupView private constructor(
    override val contentId: String,
    val kind: ToolGroupKind,
    private val make: (String) -> PartView?,
    private val parts: Parts,
) : AbstractSessionPartView(parts.header, { body() }) {

    constructor(
        contentId: String,
        kind: ToolGroupKind,
        make: (String) -> PartView?,
    ) : this(contentId, kind, make, Parts())

    private val states = LinkedHashMap<String, ToolExecState>()
    private val attached = LinkedHashMap<String, PartView>()
    private var style = SessionEditorStyle.current()
    /** Plain header text. The label itself holds the HTML-wrapped form, which reads badly in dumps. */
    private var caption = ""

    init {
        applyStyle(style)
        syncHeader()
    }

    /** Content ids in run order. */
    fun ids(): List<String> = states.keys.toList()

    val size: Int get() = states.size

    /**
     * Record or refresh [tool]'s state. Returns true only when the group changed, so a streamed
     * delta that moves neither the count nor the state does not repaint the card.
     */
    @RequiresEdt
    fun note(tool: Tool): Boolean {
        val existed = states.put(tool.id, tool.state)
        val changed = syncHeader()
        if (existed == null && isExpanded()) {
            syncChildren()
            return true
        }
        return changed
    }

    /** Forget [id]. Returns true when the group changed. */
    @RequiresEdt
    fun drop(id: String): Boolean {
        if (states.remove(id) == null) return false
        detach(id)
        syncHeader()
        return true
    }

    @RequiresEdt
    override fun expand(): Boolean {
        val changed = super.expand()
        syncChildren()
        return changed
    }

    /**
     * Re-derive the attached children from the run. The owner calls this after replacing a child
     * renderer, since a replacement changes which instance [make] hands back for that id.
     */
    @RequiresEdt
    fun rebuild() {
        syncChildren()
    }

    /**
     * Reset the run to exactly [ids], in that order, resolving ids the group has not seen through
     * [lookup]. Returns true when anything moved.
     *
     * This is what keeps the card — and any expansion the user performed — alive across a run that
     * merely grows or shrinks. A streaming turn extends its trailing run one tool at a time, so
     * rebuilding the card per arrival would hand back a collapsed replacement each time.
     */
    @RequiresEdt
    fun reconcile(ids: List<String>, lookup: (String) -> Tool?): Boolean {
        if (states.keys.toList() == ids) return false
        val next = LinkedHashMap<String, ToolExecState>()
        for (id in ids) next[id] = states[id] ?: lookup(id)?.state ?: continue
        states.clear()
        states.putAll(next)
        for (id in attached.keys.toList()) {
            if (id in next) continue
            detach(id)
        }
        syncHeader()
        if (isExpanded()) syncChildren()
        return true
    }

    @RequiresEdt
    override fun collapse(): Boolean {
        val changed = super.collapse()
        // Children stay alive in MessageView.parts; only containment is dropped, so re-expanding
        // reuses the same instances.
        if (changed) detachAll()
        return changed
    }

    /**
     * Detach every child without forgetting the run, so the owner can re-parent them back inline
     * when compact mode turns off. The group itself is disposed by the owner afterwards.
     */
    @RequiresEdt
    fun release(): List<PartView> {
        val views = attached.values.toList()
        detachAll()
        return views
    }

    @RequiresEdt
    override fun update(content: Content) {
        if (content !is Tool) return
        note(content)
    }

    // A collapsed group deliberately previews nothing: building a preview would mean building the
    // child content the group exists to avoid building.
    @RequiresEdt
    override fun headerPopup(): HeaderPopupRequest? = null

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        var changed = setFont(parts.title, style.boldEditorFont)
        changed = syncHeader() || changed
        for (view in attached.values) view.applyStyle(style)
        if (changed) refresh()
    }

    override fun dumpLabel() = "ToolGroupView#$contentId($caption)"

    /** Header text as plain, unwrapped words. */
    @RequiresEdt
    fun caption(): String = caption

    @RequiresEdt
    internal fun attachedCount() = attached.size

    @RequiresEdt
    internal fun attachedView(id: String): PartView? = attached[id]

    @RequiresEdt
    private fun detachAll() {
        if (attached.isEmpty()) return
        val panel = if (hasBody()) groupBody() else null
        for (view in attached.values) panel?.remove(view)
        attached.clear()
        panel?.revalidate()
        panel?.repaint()
    }

    /**
     * Rebuild the body's child order from the run. A late arrival or a removal would otherwise leave
     * the cards out of order, because a [ai.kilocode.client.ui.layout.Stack]-style container appends.
     * Re-adding a retained instance keeps its identity.
     */
    @RequiresEdt
    private fun syncChildren() {
        // Containment, not the cached body, is the honest gate here. collapse() keeps the body
        // instance so hasBody() stays true afterwards, and rebuild() on a collapsed group would then
        // build and attach every child the group exists to avoid building. The expand path is
        // unaffected: super.expand() attaches the body before this runs.
        if (!isExpanded()) return
        val panel = groupBody()
        for (view in attached.values) panel.remove(view)
        attached.clear()
        for (id in states.keys) {
            val view = make(id) ?: continue
            view.applyStyle(style)
            attached[id] = view
            panel.add(view)
        }
        panel.revalidate()
        panel.repaint()
    }

    @RequiresEdt
    private fun detach(id: String) {
        val view = attached.remove(id) ?: return
        if (!hasBody()) return
        val panel = groupBody()
        panel.remove(view)
        panel.revalidate()
        panel.repaint()
    }

    private fun groupBody() = bodyComponent() as SessionLayoutPanel

    @RequiresEdt
    private fun syncHeader(): Boolean {
        val total = states.size
        val failed = states.values.count { it == ToolExecState.ERROR }
        val active = states.values.any { it == ToolExecState.PENDING || it == ToolExecState.RUNNING }
        caption = label(total, failed, active)
        var changed = setText(parts.title, caption)
        changed = setForeground(parts.title, if (failed > 0) SessionUiStyle.View.Tool.error() else SessionUiStyle.Colors.foreground()) || changed
        changed = setIcon(parts.glyph, if (kind == ToolGroupKind.SUBAGENT) SessionViewIcons.task else SessionViewIcons.code) || changed
        changed = setForeground(parts.glyph, glyphColor(failed, active)) || changed
        changed = syncExpandable(total > 0) || changed
        return changed
    }

    private fun glyphColor(failed: Int, active: Boolean) = when {
        failed > 0 -> SessionUiStyle.View.Tool.error()
        active -> SessionUiStyle.View.Tool.running()
        else -> SessionUiStyle.View.Tool.completed()
    }

    /**
     * A run that is still working reads in the present tense, but a failure has to show through
     * immediately — waiting for the run to settle would hide a broken tool behind a progress line
     * the user cannot act on.
     */
    private fun label(total: Int, failed: Int, active: Boolean): String {
        if (kind == ToolGroupKind.SUBAGENT) {
            if (active && failed > 0) return KiloBundle.message("session.group.subagents.running.failed", total, failed)
            if (active) return KiloBundle.message("session.group.subagents.running", total)
            if (failed > 0) return KiloBundle.message("session.group.subagents.failed", total - failed, failed)
            return KiloBundle.message("session.group.subagents", total)
        }
        if (active && failed > 0) return KiloBundle.message("session.group.tools.running.failed", total, failed)
        if (active) return KiloBundle.message("session.group.tools.running", total)
        if (failed > 0) return KiloBundle.message("session.group.tools.failed", total, failed)
        return KiloBundle.message("session.group.tools", total)
    }

    /** Header labels, built once so the view never has to dig them back out of the component tree. */
    class Parts {
        val glyph = JBLabel()
        val title = JBLabel()
        val header: PartHeader = PartHeader().leading(glyph).left(title)
    }

    private companion object {
        fun body(): SessionLayoutPanel = SessionLayoutPanel(
            SessionUiStyle.SessionLayout.GAP,
            // Unscaled: SessionLayout scales its own padding, so a scaled value would double up.
            Insets(0, UiStyle.Gap.PAD, 0, 0),
        )
    }
}
