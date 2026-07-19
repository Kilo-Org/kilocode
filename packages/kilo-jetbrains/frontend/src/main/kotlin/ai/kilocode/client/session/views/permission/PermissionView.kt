package ai.kilocode.client.session.views.permission

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.model.Permission
import ai.kilocode.client.session.model.PermissionFileDiff
import ai.kilocode.client.session.model.PermissionRuleCandidate
import ai.kilocode.client.session.model.PermissionRuleDecision
import ai.kilocode.client.session.model.PermissionRequestState
import ai.kilocode.client.session.ui.SessionView
import ai.kilocode.client.session.views.base.BaseQuestionView
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.iconButton
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.ui.md.MdCodeBlockBorder
import ai.kilocode.client.ui.md.MdCodeBlockFactory
import ai.kilocode.client.ui.md.MdCodeBlockOptions
import ai.kilocode.client.ui.md.MdView
import ai.kilocode.client.ui.md.MdViewFactory
import ai.kilocode.client.ui.md.hybrid.MdShellHighlight
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.editor.markup.HighlighterLayer
import com.intellij.openapi.editor.markup.HighlighterTargetArea
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.util.Disposer
import com.intellij.ui.JBColor
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Dimension
import java.awt.Container
import java.awt.Cursor
import java.awt.FlowLayout
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Rectangle
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
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
    private val selection: SessionSelection? = null,
    focus: (() -> Unit)? = null,
) : BorderLayoutPanel(), SessionEditorStyleTarget, SessionView, Disposable {
    override val sessionViewKind = SessionView.Kind.Default

    private var requestId: String? = null
    private var style = SessionEditorStyle.current()

    private val card = BaseQuestionView(selection, focus)

    private val body = Stack.vertical(gap = UiStyle.Gap.sm())
    private val desc = makeDescription()
    private val codeSlot = BorderLayoutPanel().apply { isVisible = false }
    private val diffRow = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply { isVisible = false }
    private val rules = PermissionRulesView(selection) { syncPrimaryText() }.apply { isVisible = false }
    private val state = JBLabel().apply {
        border = JBUI.Borders.empty(UiStyle.Gap.sm(), 0, 0, 0)
        isVisible = false
    }

    private var md: MdView? = null
    private val diffViews = mutableListOf<PermissionDiffView>()

    private val ID_DENY = "deny"
    private val ID_RUN = "run"

    init {
        isOpaque = false
        isVisible = false

        card.setHeaderIcon(AllIcons.General.Warning, KiloBundle.message("session.permission.title"))
        card.setContent(body)
        body.next(desc).next(codeSlot).next(diffRow).next(rules).next(state)
        card.setActions(
            listOf(
                BaseQuestionView.Action(ID_DENY, KiloBundle.message("session.permission.reject"), primary = false) { reject() },
                BaseQuestionView.Action(ID_RUN, KiloBundle.message("session.permission.allow.once"), primary = true) { allow() },
            ),
        )
        addToCenter(card)
    }

    /** Populate the view for [permission] and make it visible. */
    @RequiresEdt
    fun show(permission: Permission) {
        val prev = requestId
        requestId = permission.id

        card.setHeader(KiloBundle.message("session.permission.title"))
        syncDescription(description(permission))

        val tool = permission.name
        val target = if (tool == "bash") permission.meta.command else resolveTarget(permission)
        syncCode(tool, target)
        syncDiffs(permission.meta.fileDiffs)
        rules.update(permission.meta.ruleDecisions, reset = prev != permission.id)
        syncState(permission)
        syncPrimaryText()

        val responding = permission.state == PermissionRequestState.RESPONDING || permission.state == PermissionRequestState.RESOLVED
        card.setActionEnabled(ID_RUN, !responding)
        card.setActionEnabled(ID_DENY, !responding)
        rules.setControlsEnabled(!responding)

        isVisible = true
        refresh()
    }

    /** Hide this view and clear the active request id. */
    @RequiresEdt
    fun hideView() {
        requestId = null
        disposeMd()
        diffViews.clear()
        diffRow.removeAll()
        diffRow.isVisible = false
        rules.update(emptyList(), reset = true)
        state.isVisible = false
        isVisible = false
        refresh()
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        card.applyStyle(style)
        desc.font = style.hintFont
        desc.foreground = UiStyle.Colors.weak()
        rules.applyStyle(style)
        md?.let { applyCodeStyle(it) }
        for (dv in diffViews) {
            dv.applyStyle(style)
        }
    }

    @RequiresEdt
    private fun syncDescription(text: String) {
        if (desc.text != text) desc.text = text
        desc.isVisible = text.isNotBlank()
    }

    @RequiresEdt
    private fun syncDiffs(diffs: List<PermissionFileDiff>) {
        diffRow.removeAll()
        diffViews.clear()
        diffRow.isVisible = diffs.isNotEmpty()
        if (diffs.isNotEmpty()) {
            for (diff in diffs) {
                val dv = PermissionDiffView(diff)
                diffViews.add(dv)
                diffRow.add(dv)
            }
        }
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
    private fun syncCode(tool: String, target: String?) {
        if (target.isNullOrBlank()) {
            codeSlot.isVisible = false
            md?.clear()
            return
        }

        val view = ensureMd()
        val lang = if (tool == "bash") "shell-command" else ""
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
        view.background = style.editorBackground
        view.preBg = style.editorBackground
        view.codeFont = style.editorFamily
        view.component.border = JBUI.Borders.empty()
    }

    private fun description(permission: Permission): String = if (permission.name == "bash") {
        permission.meta.raw["description"] ?: toolLabel(permission.name)
    } else {
        toolLabel(permission.name)
    }

    private fun makeDescription(): JBTextArea {
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
        }.apply {
            isEditable = false
            isOpaque = false
            isFocusable = false
            caret.isVisible = false
            caret.isSelectionVisible = false
            lineWrap = true
            wrapStyleWord = true
            foreground = UiStyle.Colors.weak()
            font = style.hintFont
            border = JBUI.Borders.empty()
            isVisible = false
        }
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
        card.setActionEnabled(ID_RUN, false)
        card.setActionEnabled(ID_DENY, false)
        rules.setControlsEnabled(false)
        reply(id, PermissionReplyDto(reply = "once"), rulePayload())
    }

    @RequiresEdt
    private fun reject() {
        val id = requestId ?: return
        card.setActionEnabled(ID_RUN, false)
        card.setActionEnabled(ID_DENY, false)
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
        val changed = rules.anyDecided()
        val key = when {
            !changed -> "session.permission.allow.once"
            rules.denied().isEmpty() && rules.approved().isNotEmpty() -> "session.permission.allow.save"
            else -> "session.permission.allow.once.save"
        }
        card.setActionText(
            ID_RUN,
            KiloBundle.message(key),
        )
        card.setActionText(
            ID_DENY,
            KiloBundle.message(if (changed) "session.permission.reject.save" else "session.permission.reject"),
        )
    }

    private fun refresh() {
        revalidate()
        repaint()
        parent?.revalidate()
        parent?.repaint()
    }

    @RequiresEdt
    private fun disposeMd() {
        val view = md ?: return
        md = null
        codeSlot.remove(view.component)
        codeSlot.isVisible = false
        Disposer.dispose(view)
    }

    override fun dispose() {
        disposeMd()
        Disposer.dispose(rules)
    }

    private fun codeEditors(): List<EditorTextField> = mdScrolls().mapNotNull { it.viewport.view as? EditorTextField }

    private fun mdScrolls(): List<JBScrollPane> = (md?.component as? JPanel)?.components?.filterIsInstance<JBScrollPane>() ?: emptyList()

    private fun fence(text: String): String {
        val size = Regex("`+").findAll(text).maxOfOrNull { it.value.length } ?: 0
        return "`".repeat(maxOf(3, size + 1))
    }

    // Test helpers
    internal fun runButtonForTest() = buttons(card).first { it.text == KiloBundle.message("session.permission.allow.once") || it.text == KiloBundle.message("session.permission.allow.save") || it.text == KiloBundle.message("session.permission.allow.once.save") }
    internal fun denyButtonForTest() = buttons(card).first { it.text == KiloBundle.message("session.permission.reject") || it.text == KiloBundle.message("session.permission.reject.save") }
    internal fun codeLabelsForTest() = codeEditors()
    internal fun diffViewsForTest() = diffViews.toList()
    internal fun headerFontForTest() = textAreas(card).first { it.font.isBold }.font
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

internal class PermissionRulesView(
    private val selection: SessionSelection?,
    private val changed: () -> Unit,
) : Stack(StackAxis.VERTICAL, UiStyle.Gap.sm()), Disposable {
    private val title = JBLabel(KiloBundle.message("session.permission.rules.title"))
    private val arrow = JBLabel(SessionViewIcons.chevronCollapsed)
    private val header = Stack.horizontal(gap = UiStyle.Gap.xs())
    private var box: Stack? = null
    private val rows = mutableListOf<RuleRow>()
    private var style = SessionEditorStyle.current()

    init {
        header.next(arrow.align(HAlign.LEFT, VAlign.CENTER)).next(title.align(HAlign.LEFT, VAlign.CENTER)).fill(0)
        header.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        header.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                toggle()
            }
        })
        next(header)
        syncArrow()
    }

    private var candidates = emptyList<PermissionRuleCandidate>()
    private var baseline = emptyMap<String, PermissionRuleDecision>()
    private var decisions = emptyMap<String, PermissionRuleDecision>()

    @RequiresEdt
    fun update(candidates: List<PermissionRuleCandidate>, reset: Boolean = false) {
        isVisible = candidates.isNotEmpty()
        val old = if (reset) emptyMap() else decisions + rows.associate { it.pattern to it.decision }
        val patterns = candidates.map { it.pattern }
        val stale = this.candidates.map { it.pattern } != patterns
        this.candidates = candidates
        if (reset || stale) baseline = candidates.associate { it.pattern to it.decision }
        decisions = candidates.associate { it.pattern to (old[it.pattern] ?: it.decision) }
        if (candidates.isEmpty()) {
            box?.let {
                if (it.parent === this) remove(it)
            }
            box = null
            disposeRows()
            syncArrow()
            changed()
            return
        }
        if (stale && box != null) syncBody(rebuild = true) else syncRows()
        syncExpanded()
        syncArrow()
        changed()
    }

    @RequiresEdt
    private fun body(): Stack {
        val current = box
        if (current != null) return current
        val root = Stack.vertical(gap = UiStyle.Gap.xs())
        box = root
        syncBody(rebuild = true)
        return root
    }

    @RequiresEdt
    private fun syncBody(rebuild: Boolean) {
        val root = box ?: return
        if (rebuild) {
            root.removeAll()
            disposeRows()
            for (candidate in candidates) {
                val row = RuleRow(candidate.pattern, style, selection) { pattern, decision ->
                    decisions = decisions + (pattern to decision)
                    syncRows()
                    changed()
                }
                rows.add(row)
                root.next(row)
            }
        }
        syncRows()
        root.revalidate()
        root.repaint()
    }

    @RequiresEdt
    private fun syncRows() {
        for (row in rows) row.update(decisions[row.pattern] ?: PermissionRuleDecision.PENDING)
    }

    @RequiresEdt
    private fun syncExpanded() {
        if (box?.parent === this) return
        if (!KiloPluginSettings.getPermissionRulesExpanded()) return
        add(body())
    }

    @RequiresEdt
    fun toggle() {
        if (candidates.isEmpty()) return
        val root = body()
        if (isExpanded()) remove(root) else add(root)
        KiloPluginSettings.setPermissionRulesExpanded(isExpanded())
        syncArrow()
        revalidate()
        repaint()
    }

    @RequiresEdt
    fun isExpanded(): Boolean = box?.parent === this

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
    fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        for (row in rows) row.applyStyle(style)
    }

    @RequiresEdt
    fun approveButtonsForTest(): List<JButton> = rows.map { it.approveButtonForTest() }

    @RequiresEdt
    fun denyButtonsForTest(): List<JButton> = rows.map { it.denyButtonForTest() }

    @RequiresEdt
    fun commandFieldsForTest(): List<EditorTextField> = rows.map { it.commandFieldForTest() }

    @RequiresEdt
    fun decisionForTest(pattern: String): PermissionRuleDecision = decisions[pattern] ?: PermissionRuleDecision.PENDING

    @RequiresEdt
    fun bodyCreatedForTest(): Boolean = box != null

    @RequiresEdt
    private fun syncArrow() {
        arrow.icon = if (isExpanded()) SessionViewIcons.chevronExpanded else SessionViewIcons.chevronCollapsed
    }

    @RequiresEdt
    private fun disposeRows() {
        for (row in rows) Disposer.dispose(row)
        rows.clear()
    }

    override fun dispose() {
        disposeRows()
    }

    private class RuleRow(
        val pattern: String,
        style: SessionEditorStyle,
        selection: SessionSelection?,
        private val changed: (String, PermissionRuleDecision) -> Unit,
    ) : Stack(StackAxis.HORIZONTAL, UiStyle.Gap.xs()), Disposable {
        var decision = PermissionRuleDecision.PENDING
            private set

        private val approve = RuleToggleButton(true) {
            changed(pattern, if (decision == PermissionRuleDecision.APPROVED) PermissionRuleDecision.PENDING else PermissionRuleDecision.APPROVED)
        }
        private val deny = RuleToggleButton(false) {
            changed(pattern, if (decision == PermissionRuleDecision.DENIED) PermissionRuleDecision.PENDING else PermissionRuleDecision.DENIED)
        }
        private val field = RuleCommandField(pattern, style, selection)

        init {
            next(approve.align(HAlign.LEFT, VAlign.CENTER))
            next(deny.align(HAlign.LEFT, VAlign.CENTER))
            gap(UiStyle.Gap.lg())
            next(field.align(HAlign.LEFT, VAlign.CENTER))
            fill(0)
            update(PermissionRuleDecision.PENDING)
        }

        @RequiresEdt
        fun update(value: PermissionRuleDecision) {
            decision = value
            approve.update(value == PermissionRuleDecision.APPROVED)
            deny.update(value == PermissionRuleDecision.DENIED)
        }

        @RequiresEdt
        fun setControlsEnabled(enabled: Boolean) {
            approve.isEnabled = enabled
            deny.isEnabled = enabled
        }

        @RequiresEdt
        fun applyStyle(style: SessionEditorStyle) {
            field.applyStyle(style)
        }

        fun approveButtonForTest(): JButton = approve

        fun denyButtonForTest(): JButton = deny

        fun commandFieldForTest(): EditorTextField = field

        override fun dispose() {
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
            ed.backgroundColor = style.editorBackground
            ed.scrollPane.background = style.editorBackground
            ed.scrollPane.isOpaque = true
            ed.scrollPane.viewport.isOpaque = true
            ed.scrollPane.viewport.background = style.editorBackground
            ed.settings.isUseSoftWraps = false
            ed.settings.isAdditionalPageAtBottom = false
            ed.scrollPane.horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            ed.scrollPane.verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER
            syncHighlight(ed)
        }

        private fun syncHighlight(ed: EditorEx) {
            ed.markupModel.removeAllHighlighters()
            val size = ed.document.textLength
            for (range in MdShellHighlight.command(text).ranges) {
                val start = range.start.coerceAtMost(size)
                val end = range.end.coerceAtMost(size)
                if (start >= end) continue
                ed.markupModel.addRangeHighlighter(
                    range.key,
                    start,
                    end,
                    HighlighterLayer.SYNTAX + 1,
                    HighlighterTargetArea.EXACT_RANGE,
                )
            }
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
                val base = UiStyle.Colors.bg()
                g2.color = when {
                    active -> UiStyle.Colors.blend(base, if (approve) approvedColor() else deniedColor(), 0.15f)
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

private fun approvedColor(): Color = JBColor.namedColor(
    "Kilo.PermissionRule.approvedForeground",
    JBColor(Color(0x1f, 0x9d, 0x66), Color(0x35, 0xd4, 0x9a)),
)

private fun deniedColor(): Color = JBColor.namedColor(
    "Kilo.PermissionRule.deniedForeground",
    JBColor(Color(0xdb, 0x58, 0x66), Color(0xff, 0x6b, 0x7a)),
)
