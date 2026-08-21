package ai.kilocode.client.session.views.permission

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.SessionDiffOpener
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Permission
import ai.kilocode.client.session.model.PermissionFileDiff
import ai.kilocode.client.session.model.PermissionRuleCandidate
import ai.kilocode.client.session.model.PermissionRuleDecision
import ai.kilocode.client.session.model.PermissionRequestState
import ai.kilocode.client.session.ui.SessionView
import ai.kilocode.client.session.views.base.DialogView
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.session.views.base.AbstractSessionPartView
import ai.kilocode.client.session.views.base.PartHeader
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.iconButton
import ai.kilocode.client.ui.editor.BashCommandHighlighter
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.ui.md.MdCodeBlockBorder
import ai.kilocode.client.ui.md.MdCodeBlockFactory
import ai.kilocode.client.ui.md.MdCodeBlockOptions
import ai.kilocode.client.ui.md.MdCommon
import ai.kilocode.client.ui.md.MdView
import ai.kilocode.client.ui.md.MdViewFactory
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.Container
import java.awt.Cursor
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Rectangle
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.Icon
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

/**
 * Transcript-style permission view — rendered inside [ai.kilocode.client.session.ui.SessionMessageListPanel]
 * at the end of the transcript when the session is in
 * [ai.kilocode.client.session.model.SessionState.AwaitingPermission].
 *
 * Shows a compact row with action label and target as an inline code fragment, plus diff badges.
 */
class PermissionView(
    private val reply: (String, PermissionReplyDto, PermissionAlwaysRulesDto?) -> Unit,
    private val openFile: SessionFileOpener = { _, _ -> },
    private val selection: SessionSelection? = null,
    focus: (() -> Unit)? = null,
) : DialogView(selection, focus), SessionView, Disposable {
    override val sessionViewKind = SessionView.Kind.Default

    private var requestId: String? = null
    private var responding = false
    private var style = SessionEditorStyle.current()
    private var openDiff: SessionDiffOpener = { _, _, _ -> }
    private var sessionId: String? = null
    private var hover: ((PartView, Boolean) -> Unit)? = null

    private val body = Stack.vertical(gap = UiStyle.Gap.sm())
    private val desc = makeDescription()
    private val codeSlot = BorderLayoutPanel().apply { isVisible = false }
    private val diffRow = Stack.vertical().apply { isVisible = false }
    private val rules = PermissionRulesView(selection) { syncPrimaryText() }.apply { isVisible = false }
    private val state = JBLabel().apply {
        border = JBUI.Borders.empty(UiStyle.Gap.sm(), 0, 0, 0)
        isVisible = false
    }

    private var md: MdView? = null
    private var diffView: PermissionDiffView? = null

    private val ID_DENY = "deny"
    private val ID_RUN = "run"

    init {
        isOpaque = false
        isVisible = false

        setHeaderIcon(AllIcons.General.Warning, KiloBundle.message("session.permission.title"))
        setContent(body)
        body.next(desc).next(codeSlot).next(diffRow).next(rules).next(state)
        setActions(
            listOf(
                DialogView.Action(ID_DENY, KiloBundle.message("session.permission.reject"), primary = false) { reject() },
                DialogView.Action(ID_RUN, KiloBundle.message("session.permission.allow.once"), primary = true) { allow() },
            ),
        )
    }

    /** Populate the view for [permission] and make it visible. */
    @RequiresEdt
    fun show(permission: Permission) {
        val prev = requestId
        requestId = permission.id

        val skillShell = permission.meta.raw["skillShell"] == "true"
        val skill = permission.meta.raw["skill"]
        setHeader(
            if (skillShell && !skill.isNullOrBlank())
                // skill is the untrusted SKILL.md frontmatter name; escape it the same way as
                // the command list so it can't reorder/repaint the header.
                KiloBundle.message("session.permission.skillShell.title", escapeControl(skill))
            else KiloBundle.message("session.permission.title"),
        )
        syncDescription(description(permission))

        val tool = permission.name
        // A skill-shell bash batch shows the verbatim command list (control-char-escaped so the
        // displayed command can't repaint the line). Its external_directory sibling still shows
        // directories via resolveTarget; only the header carries the skill attribution.
        val target = when {
            skillShell && tool == "bash" -> permission.meta.skillCommands.joinToString("\n") { escapeControl(it) }
            tool == "bash" -> permission.meta.command
            else -> resolveTarget(permission)
        }
        syncCode(tool, target)
        syncDiffs(permission.meta.fileDiffs)
        responding = permission.state == PermissionRequestState.RESPONDING || permission.state == PermissionRequestState.RESOLVED
        // Skill-shell approvals are never persisted, so no auto-approve rule toggles even if a
        // future backend change starts sending candidates for this batch.
        rules.update(if (skillShell) emptyList() else permission.meta.ruleDecisions, reset = prev != permission.id)
        syncState(permission)
        syncPrimaryText()

        syncButtons(responding)
        rules.setControlsEnabled(!responding)

        isVisible = true
        refresh()
    }

    @RequiresEdt
    fun setDiffOpener(openDiff: SessionDiffOpener, sessionId: String?) {
        this.openDiff = openDiff
        this.sessionId = sessionId
        diffView?.setDiffOpener(openDiff, sessionId, requestId)
    }

    @RequiresEdt
    fun setHoverSink(sink: (PartView, Boolean) -> Unit) {
        hover = sink
        diffView?.hover = sink
    }

    /** Hide this view and clear the active request id. */
    @RequiresEdt
    fun hideView() {
        requestId = null
        responding = false
        disposeMd()
        disposeDiffs()
        rules.update(emptyList(), reset = true)
        state.isVisible = false
        isVisible = false
        refresh()
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        super.applyStyle(style)
        desc.font = SessionUiStyle.Text.Secondary.font(style)
        desc.foreground = SessionUiStyle.Text.Secondary.foreground()
        rules.applyStyle(style)
        md?.let { applyCodeStyle(it) }
        diffView?.applyStyle(style)
    }

    @RequiresEdt
    private fun syncDescription(text: String) {
        if (desc.text != text) desc.text = text
        desc.isVisible = text.isNotBlank()
    }

    @RequiresEdt
    private fun syncDiffs(diffs: List<PermissionFileDiff>) {
        if (diffs.isEmpty()) {
            disposeDiffs()
            return
        }
        // Retain the card across the RESPONDING/ERROR re-renders of the same request so an
        // expanded inline preview is not torn down; setDiffs updates it in place. The card is
        // disposed in hideView when the request resolves, so a new request always starts fresh.
        val existing = diffView
        if (existing != null) {
            existing.setDiffOpener(openDiff, sessionId, requestId)
            existing.setDiffs(diffs)
        } else {
            val dv = PermissionDiffView(diffs, openFile, selection)
            dv.setDiffOpener(openDiff, sessionId, requestId)
            dv.hover = hover
            dv.applyStyle(style)
            diffView = dv
            diffRow.add(dv)
        }
        diffRow.isVisible = true
        diffRow.revalidate()
        diffRow.repaint()
    }

    private fun resolveTarget(permission: Permission): String? {
        val path = permission.meta.filePath
        if (!path.isNullOrBlank()) return path

        val filtered = permission.patterns.filter { it != "*" }
        return when {
            filtered.size == 1 -> filtered[0]
            filtered.size > 1 -> filtered.joinToString(", ")
            else -> null
        }
    }

    @RequiresEdt
    private fun syncState(permission: Permission) {
        val msg = when (permission.state) {
            PermissionRequestState.ERROR ->
                permission.message ?: KiloBundle.message("session.permission.error")
            PermissionRequestState.RESPONDING ->
                KiloBundle.message("session.permission.responding")
            else -> null
        }
        state.text = msg.orEmpty()
        state.isVisible = msg != null
    }

    @RequiresEdt
    private fun syncButtons(responding: Boolean) {
        val approved = rules.approved().isNotEmpty()
        val denied = rules.denied().isNotEmpty()
        setActionEnabled(ID_RUN, !responding && !(denied && !approved))
        setActionEnabled(ID_DENY, !responding && !(approved && !denied))
    }

    @RequiresEdt
    private fun syncCode(tool: String, target: String?) {
        if (target.isNullOrBlank()) {
            codeSlot.isVisible = false
            md?.clear()
            return
        }

        val view = ensureMd()
        val lang = if (tool == "bash") "bash" else ""
        val text = fenced(target, lang)
        if (view.markdown() != text) view.set(text)
        applyCodeStyle(view)
        codeSlot.isVisible = true
    }

    @RequiresEdt
    private fun ensureMd(): MdView {
        md?.let { return it }
        val view = MdViewFactory.create(
            style,
            selection,
            MdCodeBlockFactory.default(
                MdCodeBlockOptions(
                    border = MdCodeBlockBorder.None,
                    verticalPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
                    editorOnly = true,
                ),
            ),
        )
        md = view
        applyCodeStyle(view)
        codeSlot.add(view.component, BorderLayout.CENTER)
        return view
    }

    @RequiresEdt
    private fun applyCodeStyle(view: MdView) {
        view.applyStyle(style)
        view.font = style.transcriptFont
        view.foreground = style.editorForeground
        view.background = SessionUiStyle.Colors.codeBlockBackground()
        view.preBg = MdCommon.defaults(style).preBg
        view.codeFont = style.editorFamily
        view.component.border = JBUI.Borders.empty()
    }

    // Escape control chars (CR/LF/ESC/etc.) and bidi/format characters so a skill command can't
    // repaint the prompt or use Trojan-Source reordering to make the displayed text differ from
    // what executes; newlines become a visible marker. Mirrors displayCommand in the CLI
    // (packages/opencode/src/kilocode/skills/display.ts); keep the ranges in sync.
    private fun escapeControl(command: String): String = buildString {
        for (ch in command) {
            val code = ch.code
            when {
                ch == '\n' -> append("\\n")
                ch == '\r' -> append("\\r")
                ch == '\t' -> append("\\t")
                isEscapedControlOrFormat(code) -> append(if (code <= 0xff) "\\x%02x".format(code) else "\\u%04x".format(code))
                else -> append(ch)
            }
        }
    }

    private fun isEscapedControlOrFormat(code: Int): Boolean =
        code < 0x20 ||
            code in 0x7f..0x9f ||
            code in 0x200e..0x200f ||
            code in 0x2028..0x2029 ||
            code in 0x202a..0x202e ||
            code in 0x2066..0x2069

    private fun description(permission: Permission): String = if (permission.name == "bash") {
        permission.meta.raw["description"] ?: toolLabel(permission.name)
    } else {
        toolLabel(permission.name)
    }

    private fun makeDescription(): JBTextArea {
        val area = wrappingSecondaryText(style).apply { isVisible = false }
        selection?.register(area)
        return area
    }

    private fun fenced(text: String, lang: String): String = buildString {
        val fence = fence(text)
        append(fence).append(lang).append('\n')
        append(text)
        if (!text.endsWith('\n')) append('\n')
        append(fence)
    }

    private fun toolLabel(tool: String): String = when (tool) {
        "read" -> KiloBundle.message("session.permission.tool.read")
        "edit" -> KiloBundle.message("session.permission.tool.edit")
        "write" -> KiloBundle.message("session.permission.tool.write")
        "patch" -> KiloBundle.message("session.permission.tool.patch")
        "multiedit" -> KiloBundle.message("session.permission.tool.multiedit")
        "glob" -> KiloBundle.message("session.permission.tool.glob")
        "grep" -> KiloBundle.message("session.permission.tool.grep")
        "list" -> KiloBundle.message("session.permission.tool.list")
        "bash" -> KiloBundle.message("session.permission.tool.bash")
        "external_directory" -> KiloBundle.message("session.permission.tool.external_directory")
        "webfetch" -> KiloBundle.message("session.permission.tool.webfetch")
        "websearch" -> KiloBundle.message("session.permission.tool.websearch")
        "codesearch" -> KiloBundle.message("session.permission.tool.codesearch")
        "todoread" -> KiloBundle.message("session.permission.tool.todoread")
        "todowrite" -> KiloBundle.message("session.permission.tool.todowrite")
        "task" -> KiloBundle.message("session.permission.tool.task")
        "skill" -> KiloBundle.message("session.permission.tool.skill")
        "lsp" -> KiloBundle.message("session.permission.tool.lsp")
        else -> tool
    }

    @RequiresEdt
    private fun allow() {
        val id = requestId ?: return
        setActionEnabled(ID_RUN, false)
        setActionEnabled(ID_DENY, false)
        rules.setControlsEnabled(false)
        reply(id, PermissionReplyDto(reply = "once", interactive = true), rulePayload())
    }

    @RequiresEdt
    private fun reject() {
        val id = requestId ?: return
        setActionEnabled(ID_RUN, false)
        setActionEnabled(ID_DENY, false)
        rules.setControlsEnabled(false)
        reply(id, PermissionReplyDto(reply = "reject"), rulePayload())
    }

    @RequiresEdt
    private fun rulePayload(): PermissionAlwaysRulesDto? {
        if (!rules.anyDecided()) return null
        return PermissionAlwaysRulesDto(approvedAlways = rules.approved(), deniedAlways = rules.denied())
    }

    @RequiresEdt
    private fun syncPrimaryText() {
        val key = if (rules.anyDecided()) "session.permission.allow" else "session.permission.allow.once"
        setActionText(
            ID_RUN,
            KiloBundle.message(key),
        )
        setActionText(
            ID_DENY,
            KiloBundle.message("session.permission.reject"),
        )
        syncButtons(responding)
    }

    @RequiresEdt
    private fun disposeMd() {
        val view = md ?: return
        md = null
        codeSlot.remove(view.component)
        codeSlot.isVisible = false
        Disposer.dispose(view)
    }

    @RequiresEdt
    private fun disposeDiffs() {
        diffView?.let(Disposer::dispose)
        diffView = null
        diffRow.removeAll()
        diffRow.isVisible = false
    }

    override fun dispose() {
        disposeMd()
        disposeDiffs()
        Disposer.dispose(rules)
    }

    private fun codeEditors(): List<EditorTextField> = mdScrolls().mapNotNull { it.viewport.view as? EditorTextField }

    private fun mdScrolls(): List<JBScrollPane> = (md?.component as? JPanel)?.components?.filterIsInstance<JBScrollPane>() ?: emptyList()

    private fun fence(text: String): String {
        val size = Regex("`+").findAll(text).maxOfOrNull { it.value.length } ?: 0
        return "`".repeat(maxOf(3, size + 1))
    }

    // Test helpers
    internal fun runButtonForTest() = buttons(this).first { it.text == KiloBundle.message("session.permission.allow") || it.text == KiloBundle.message("session.permission.allow.once") }
    internal fun denyButtonForTest() = buttons(this).first { it.text == KiloBundle.message("session.permission.reject") }
    internal fun codeLabelsForTest() = codeEditors()
    internal fun diffViewsForTest() = listOfNotNull(diffView)
    internal fun headerFontForTest() = textAreas(this).first { it.font.isBold }.font
    internal fun rulesForTest() = rules

    private fun buttons(root: Container): List<JButton> {
        val result = mutableListOf<JButton>()
        if (root is JButton) result.add(root)
        for (child in root.components) {
            if (child is Container) result.addAll(buttons(child))
        }
        return result
    }

    private fun textAreas(root: Container): List<JBTextArea> {
        val result = mutableListOf<JBTextArea>()
        if (root is JBTextArea) result.add(root)
        for (child in root.components) {
            if (child is Container) result.addAll(textAreas(child))
        }
        return result
    }
}

/**
 * Transparent, non-editable, secondary-styled text area that soft-wraps to its parent width. Shared
 * by the permission description and the auto-approve rule hints so wrapping prose reads the same
 * everywhere instead of clipping in a single-line label.
 */
private fun wrappingSecondaryText(style: SessionEditorStyle): JBTextArea {
    val area = object : JBTextArea() {
        override fun getPreferredSize() = withWidth(super.getPreferredSize().height)

        override fun getMaximumSize(): Dimension {
            val size = preferredSize
            return Dimension(Int.MAX_VALUE, size.height)
        }

        override fun scrollRectToVisible(aRect: Rectangle) {}

        private fun withWidth(fallback: Int): Dimension {
            val w = availableWidth()
            if (w <= 0) return Dimension(super.getPreferredSize().width, fallback)
            val old = size
            setSize(w, Int.MAX_VALUE)
            val ps = super.getPreferredSize()
            setSize(old)
            return Dimension(w, ps.height)
        }

        private fun availableWidth(): Int {
            var node = parent
            while (node != null) {
                if (node.width > 0) {
                    val ins = node.insets
                    return (node.width - ins.left - ins.right).coerceAtLeast(0)
                }
                node = node.parent
            }
            return width
        }
    }
    area.isEditable = false
    area.isOpaque = false
    area.isFocusable = false
    area.caret.isVisible = false
    area.caret.isSelectionVisible = false
    area.lineWrap = true
    area.wrapStyleWord = true
    area.foreground = SessionUiStyle.Text.Secondary.foreground()
    area.font = SessionUiStyle.Text.Secondary.font(style)
    area.border = JBUI.Borders.empty()
    return area
}

internal class PermissionRulesView private constructor(
    private val selection: SessionSelection?,
    private val changed: () -> Unit,
    private val parts: Header,
    private val box: Stack,
) : AbstractSessionPartView(parts.panel, box, expanded = KiloPluginSettings.getPermissionRulesExpanded()) {
    override val contentId = CONTENT_ID

    private val rows = mutableListOf<RuleRow>()
    private var style = SessionEditorStyle.current()

    private var candidates = emptyList<PermissionRuleCandidate>()
    private var baseline = emptyMap<String, PermissionRuleDecision>()
    private var decisions = emptyMap<String, PermissionRuleDecision>()

    constructor(selection: SessionSelection?, changed: () -> Unit) :
        this(selection, changed, Header(), Stack.vertical(gap = UiStyle.Gap.xs()))

    init {
        // Indent the rule rows under the header, matching the diff body's nested content inset.
        box.border = JBUI.Borders.emptyLeft(SessionUiStyle.View.contentIndent())
        parts.applyStyle(style)
    }

    @RequiresEdt
    fun update(candidates: List<PermissionRuleCandidate>, reset: Boolean = false) {
        isVisible = candidates.isNotEmpty()
        val old = if (reset) emptyMap() else decisions + rows.associate { it.pattern to it.decision }
        val patterns = candidates.map { it.pattern }
        val stale = this.candidates.map { it.pattern } != patterns
        this.candidates = candidates
        if (reset || stale) baseline = candidates.associate { it.pattern to it.decision }
        decisions = candidates.associate { it.pattern to (old[it.pattern] ?: it.decision) }
        syncExpandable(candidates.isNotEmpty())
        if (candidates.isEmpty()) {
            disposeRows()
            box.removeAll()
            changed()
            return
        }
        if (isExpanded()) {
            if (stale) rebuildRows() else syncRows()
        }
        changed()
    }

    // The rule rows are the card body: built lazily on first expand and rebuilt only when the
    // candidate set changes, so the editor-backed command fields are not created while collapsed.
    @RequiresEdt
    override fun expand(): Boolean {
        val changed = super.expand()
        if (changed) rebuildRows()
        return changed
    }

    @RequiresEdt
    override fun update(content: Content) = Unit

    @RequiresEdt
    private fun rebuildRows() {
        box.removeAll()
        disposeRows()
        for (candidate in candidates) {
            val row = RuleRow(candidate.pattern, candidate.defaultDecision, style, selection) { pattern, decision ->
                decisions = decisions + (pattern to decision)
                syncRows()
                changed()
            }
            rows.add(row)
            box.next(row)
        }
        syncRows()
        box.revalidate()
        box.repaint()
    }

    @RequiresEdt
    private fun syncRows() {
        for (row in rows) row.update(decisions[row.pattern] ?: PermissionRuleDecision.PENDING)
    }

    @RequiresEdt
    fun approved(): List<String> = candidates.map { it.pattern }.filter { decisions[it] == PermissionRuleDecision.APPROVED }

    @RequiresEdt
    fun denied(): List<String> = candidates.map { it.pattern }.filter { decisions[it] == PermissionRuleDecision.DENIED }

    @RequiresEdt
    fun anyDecided(): Boolean = decisions.any { baseline[it.key] != it.value }

    @RequiresEdt
    fun setControlsEnabled(enabled: Boolean) {
        for (row in rows) row.setControlsEnabled(enabled)
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        parts.applyStyle(style)
        for (row in rows) row.applyStyle(style)
        refresh()
    }

    override fun userToggled() {
        KiloPluginSettings.setPermissionRulesExpanded(isExpanded())
    }

    @RequiresEdt
    fun approveButtonsForTest(): List<JButton> = rows.map { it.approveButtonForTest() }

    @RequiresEdt
    fun denyButtonsForTest(): List<JButton> = rows.map { it.denyButtonForTest() }

    @RequiresEdt
    fun commandFieldsForTest(): List<EditorTextField> = rows.map { it.commandFieldForTest() }

    @RequiresEdt
    fun hintLabelsForTest(): List<JBTextArea> = rows.map { it.hintLabelForTest() }

    @RequiresEdt
    private fun disposeRows() {
        for (row in rows) Disposer.dispose(row)
        rows.clear()
    }

    override fun dispose() {
        disposeRows()
        super.dispose()
    }

    // Card-style header shared with the change/modified cards: leading permission glyph and title.
    // The collapse/expand chevron on the trailing edge is owned by AbstractSessionPartView.
    private class Header {
        val glyph = JBLabel(SHIELD_ICON)
        val title = JBLabel(KiloBundle.message("session.permission.rules.title"))
        val panel = PartHeader().apply {
            leading(glyph)
            left(title)
        }

        @RequiresEdt
        fun applyStyle(style: SessionEditorStyle) {
            title.font = style.boldEditorFont
            title.foreground = SessionUiStyle.Colors.foreground()
        }
    }

    private companion object {
        const val CONTENT_ID = "session-permission-rules"
        val SHIELD_ICON: Icon = IconLoader.getIcon("/icons/shield.svg", PermissionRulesView::class.java)
    }

    private class RuleRow(
        val pattern: String,
        private val default: PermissionRuleDecision,
        style: SessionEditorStyle,
        selection: SessionSelection?,
        private val changed: (String, PermissionRuleDecision) -> Unit,
    ) : Stack(StackAxis.VERTICAL, UiStyle.Gap.xs()), Disposable {
        var decision = PermissionRuleDecision.PENDING
            private set

        private val approve = RuleToggleButton(true) {
            changed(pattern, if (decision == PermissionRuleDecision.APPROVED) PermissionRuleDecision.PENDING else PermissionRuleDecision.APPROVED)
        }
        private val deny = RuleToggleButton(false) {
            changed(pattern, if (decision == PermissionRuleDecision.DENIED) PermissionRuleDecision.PENDING else PermissionRuleDecision.DENIED)
        }
        private val hint = wrappingSecondaryText(style)
        private val hintReg = selection?.register(hint)
        private val field = RuleCommandField(pattern, style, selection)
        private val controls = Stack.horizontal(gap = UiStyle.Gap.xs())

        init {
            controls.next(approve.align(HAlign.LEFT, VAlign.CENTER))
            controls.next(deny.align(HAlign.LEFT, VAlign.CENTER))
            controls.gap(UiStyle.Gap.lg())
            controls.next(field.align(HAlign.LEFT, VAlign.CENTER))
            controls.fill(0)
            next(controls)
            next(hint)
            applyStyle(style)
            update(PermissionRuleDecision.PENDING)
        }

        @RequiresEdt
        fun update(value: PermissionRuleDecision) {
            decision = value
            approve.update(value == PermissionRuleDecision.APPROVED)
            deny.update(value == PermissionRuleDecision.DENIED)
            hint.text = KiloBundle.message(when (value) {
                PermissionRuleDecision.APPROVED -> "session.permission.rule.hint.approve"
                PermissionRuleDecision.DENIED -> "session.permission.rule.hint.deny"
                PermissionRuleDecision.PENDING -> "session.permission.rule.hint.default"
            }, defaultLabel())
        }

        private fun defaultLabel(): String = when (default) {
            PermissionRuleDecision.APPROVED -> KiloBundle.message("session.permission.allow")
            PermissionRuleDecision.DENIED -> KiloBundle.message("session.permission.reject")
            PermissionRuleDecision.PENDING -> KiloBundle.message("session.permission.ask")
        }

        @RequiresEdt
        fun setControlsEnabled(enabled: Boolean) {
            approve.isEnabled = enabled
            deny.isEnabled = enabled
        }

        @RequiresEdt
        fun applyStyle(style: SessionEditorStyle) {
            hint.font = SessionUiStyle.Text.Secondary.font(style)
            hint.foreground = SessionUiStyle.Text.Secondary.foreground()
            field.applyStyle(style)
        }

        fun approveButtonForTest(): JButton = approve

        fun denyButtonForTest(): JButton = deny

        fun commandFieldForTest(): EditorTextField = field

        fun hintLabelForTest(): JBTextArea = hint

        override fun dispose() {
            hintReg?.let(Disposer::dispose)
            field.dispose()
        }
    }

    private class RuleCommandField(
        value: String,
        private var style: SessionEditorStyle,
        private val selection: SessionSelection?,
    ) : EditorTextField(
        EditorFactory.getInstance().createDocument(value.trimEnd('\n')),
        ProjectManager.getInstance().defaultProject,
        PlainTextFileType.INSTANCE,
        true,
        false,
    ) {
        private var reg: Disposable? = null

        init {
            setFontInheritedFromLAF(false)
            font = style.editorFont
            addSettingsProvider(::install)
            reg = selection?.register(this)
        }

        override fun getMaximumSize(): Dimension {
            val size = preferredSize
            return Dimension(Int.MAX_VALUE, size.height)
        }

        @RequiresEdt
        fun applyStyle(style: SessionEditorStyle) {
            this.style = style
            font = style.editorFont
            getEditor(false)?.let(::apply)
        }

        @RequiresEdt
        fun dispose() {
            reg?.let(Disposer::dispose)
            reg = null
            getEditor(false)?.let(EditorFactory.getInstance()::releaseEditor)
        }

        private fun install(ed: com.intellij.openapi.editor.Editor) {
            (ed as? EditorEx)?.let(::apply)
        }

        private fun apply(ed: EditorEx) {
            style.applyToEditor(ed)
            ed.setBorder(JBUI.Borders.empty())
            ed.scrollPane.border = JBUI.Borders.empty()
            ed.scrollPane.viewportBorder = JBUI.Borders.empty()
            ed.backgroundColor = SessionUiStyle.Colors.codeBlockBackground()
            ed.scrollPane.background = SessionUiStyle.Colors.codeBlockBackground()
            ed.scrollPane.isOpaque = true
            ed.scrollPane.viewport.isOpaque = true
            ed.scrollPane.viewport.background = SessionUiStyle.Colors.codeBlockBackground()
            ed.settings.isUseSoftWraps = false
            ed.settings.isAdditionalPageAtBottom = false
            ed.scrollPane.horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            ed.scrollPane.verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER
            BashCommandHighlighter.apply(ed, text)
        }
    }

    private class RuleToggleButton(
        private val approve: Boolean,
        private val changed: () -> Unit,
    ) : JButton() {
        private var active = false
        private var over = false

        init {
            iconButton(this)
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            addActionListener { changed() }
            addMouseListener(object : MouseAdapter() {
                override fun mouseEntered(e: MouseEvent) = syncOver(true)

                override fun mouseExited(e: MouseEvent) = syncOver(false)
            })
            update(false)
        }

        override fun getPreferredSize(): Dimension = JBUI.size(24, 24)

        override fun getMinimumSize(): Dimension = preferredSize

        override fun getMaximumSize(): Dimension = preferredSize

        override fun paintComponent(g: Graphics) {
            if (isEnabled && (active || over)) paintFill(g)
            super.paintComponent(g)
        }

        @RequiresEdt
        fun update(value: Boolean) {
            active = value
            icon = when {
                approve && value -> SessionViewIcons.ruleApproveActive
                approve -> SessionViewIcons.ruleApprove
                value -> SessionViewIcons.ruleDenyActive
                else -> SessionViewIcons.ruleDeny
            }
            val key = when {
                approve && value -> "session.permission.rule.approve.remove"
                approve -> "session.permission.rule.approve.add"
                value -> "session.permission.rule.deny.remove"
                else -> "session.permission.rule.deny.add"
            }
            val text = KiloBundle.message(key)
            toolTipText = text
            getAccessibleContext().accessibleName = text
            repaint()
        }

        private fun paintFill(g: Graphics) {
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                val base = SessionUiStyle.Colors.sessionBackground()
                g2.color = when {
                    active -> UiStyle.Colors.blend(base, if (approve) UiStyle.Colors.addedForeground() else UiStyle.Colors.removedForeground(), 0.15f)
                    else -> UiStyle.Colors.actionHoverBackground()
                }
                val arc = JBUI.scale(JBUI.getInt("Button.arc", 6))
                g2.fillRoundRect(0, 0, width, height, arc, arc)
            } finally {
                g2.dispose()
            }
        }

        private fun syncOver(value: Boolean) {
            if (over == value) return
            over = value
            repaint()
        }
    }
}
