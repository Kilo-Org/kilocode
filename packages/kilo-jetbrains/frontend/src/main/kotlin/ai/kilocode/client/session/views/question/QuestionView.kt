package ai.kilocode.client.session.views.question

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Question
import ai.kilocode.client.session.model.QuestionItem
import ai.kilocode.client.session.model.QuestionOption
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.SessionView
import ai.kilocode.client.session.ui.editor.SessionEditorTextField
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.session.views.base.BaseQuestionView
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.QuestionReplyDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBRadioButton
import com.intellij.ui.components.JBTextArea
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Dimension
import java.awt.GridBagLayout
import java.awt.Rectangle
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import java.awt.event.FocusAdapter
import java.awt.event.FocusEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.AbstractButton
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.ButtonGroup
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.SwingUtilities

/** Question tool form rendered inside the session transcript. */
class QuestionView(
    private val project: Project,
    private val reply: (String, QuestionReplyDto, List<List<String>>) -> Unit,
    private val reject: (String) -> Unit,
    private val follow: () -> Boolean = { true },
    private val scroll: (Boolean) -> Unit = {},
    private val selection: SessionSelection? = null,
    focus: (() -> Unit)? = null,
) : BorderLayoutPanel(), SessionEditorStyleTarget, SessionView {
    override val sessionViewKind = SessionView.Kind.Default

    private var request: String? = null
    private var question: Question? = null
    private var idx = 0
    private var selections = emptyList<MutableSet<String>>()
    // Per-question custom text state — survives navigation.
    private var customTexts = emptyList<String>()
    // Per-question: whether the custom row is currently selected/open.
    private var customOpen = emptyList<Boolean>()
    private var style = SessionEditorStyle.current()
    private val texts = mutableListOf<Pair<JBTextArea, Boolean>>()
    private val regs = mutableListOf<Disposable>()
    // The custom editor for the currently shown question; null when not shown.
    private var customEditor: SessionEditorTextField? = null
    private var customFocus: FocusAdapter? = null
    private val resize = object : ComponentAdapter() {
        @RequiresEdt
        override fun componentResized(e: ComponentEvent) {
            customEditor?.let(::syncEditorHeight)
        }
    }

    private val card = BaseQuestionView(selection, focus)

    private val summary = JBLabel()
    private val nav = JPanel().apply {
        isOpaque = false
        layout = BoxLayout(this, BoxLayout.X_AXIS)
    }
    private val back = HoverIcon().apply {
        val ico = SessionViewIcons.chevronLeft
        icon = ico
        disabledIcon = IconLoader.getDisabledIcon(ico)
        toolTipText = KiloBundle.message("session.question.back")
        addActionListener { goBack() }
    }
    private val fwd = HoverIcon().apply {
        val ico = SessionViewIcons.chevronRight
        icon = ico
        disabledIcon = IconLoader.getDisabledIcon(ico)
        toolTipText = KiloBundle.message("session.question.next")
        addActionListener { goForward() }
    }
    private val topPanel = JPanel(BorderLayout()).apply {
        isOpaque = false
        border = JBUI.Borders.empty()
        alignmentX = Component.LEFT_ALIGNMENT
    }
    private val body = JPanel().apply {
        isOpaque = false
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        alignmentX = Component.LEFT_ALIGNMENT
    }

    // Stable action ids for setActionEnabled calls
    private val ID_DISMISS = "dismiss"
    private val ID_BACK = "back"
    private val ID_MAIN = "main"  // next / review / submit

    init {
        isOpaque = false
        isVisible = false
        addComponentListener(resize)

        nav.add(back)
        nav.add(fwd)
        topPanel.add(summary, BorderLayout.WEST)
        topPanel.add(nav, BorderLayout.EAST)

        card.setTopPanel(topPanel)
        card.setContent(body)
        add(card, BorderLayout.CENTER)
    }

    @RequiresEdt
    override fun addNotify() {
        super.addNotify()
        customEditor?.let(::syncEditorHeight)
    }

    @RequiresEdt
    fun show(q: Question) {
        if (q.items.isEmpty()) {
            hideView()
            return
        }
        request = q.id
        question = q
        idx = 0
        val tail = follow()
        selections = List(q.items.size) { mutableSetOf() }
        customTexts = List(q.items.size) { "" }
        customOpen = List(q.items.size) { false }
        isVisible = true
        applyStyle(SessionEditorStyle.current())
        syncPage()
        scroll(tail)
    }

    @RequiresEdt
    fun hideView() {
        request = null
        question = null
        idx = 0
        selections = emptyList()
        customTexts = emptyList()
        customOpen = emptyList()
        disposeCustomEditor()
        customFocus = null
        disposeRegs()
        texts.clear()
        body.removeAll()
        card.setActions(emptyList())
        isVisible = false
        refresh()
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        card.applyStyle(style)
        customEditor?.let { ed ->
            style.applyTranscriptToField(ed)
            ed.background = style.editorBackground
            syncEditorHeight(ed)
        }
        val changed = texts.fold(false) { acc, item -> setFont(item.first, item.second) || acc }
        if (!changed) return
        refresh()
    }

    @RequiresEdt
    private fun syncPage() {
        val q = question ?: return
        disposeRegs()
        texts.clear()
        disposeCustomEditor()
        customFocus = null
        body.removeAll()
        if (review(q)) {
            card.setHeader(KiloBundle.message("session.question.review.title"))
            addReview(q)
        } else {
            val item = q.items[idx]
            val hint = KiloBundle.message(
                if (item.multiple) "session.question.hint.multi" else "session.question.hint.single"
            )
            card.setHeader(item.question, hint)
            addContent(item, selections[idx])
        }
        syncHeader(q)
        syncFooter(q)
        syncControls(q)
        refresh()
    }

    @RequiresEdt
    private fun syncHeader(q: Question) {
        val total = q.items.size
        val shown = minOf(idx + 1, total)
        summary.text = KiloBundle.message("session.question.summary", shown, total)
        summary.foreground = UiStyle.Colors.weak()
        summary.isVisible = total > 1
        nav.isVisible = total > 1
        topPanel.isVisible = total > 1
        if (total > 1) {
            topPanel.border = JBUI.Borders.empty(0, 0, UiStyle.Gap.sm(), 0)
            card.setSpacing(UiStyle.Gap.sm(), UiStyle.Gap.pad())
            return
        }
        card.setSpacing(UiStyle.Gap.xl(), UiStyle.Gap.pad())
    }

    @RequiresEdt
    private fun syncFooter(q: Question) {
        val actions = mutableListOf<BaseQuestionView.Action>()
        actions.add(BaseQuestionView.Action(ID_DISMISS, KiloBundle.message("session.question.dismiss"), primary = false) { doReject() })

        if (review(q)) {
            actions.add(BaseQuestionView.Action(ID_BACK, KiloBundle.message("session.question.back"), primary = false) { goBack() })
            actions.add(BaseQuestionView.Action(ID_MAIN, KiloBundle.message("session.question.submit"), primary = true) { doReply() })
        } else {
            val label = when {
                direct(q) -> KiloBundle.message("session.question.submit")
                lastItem(q) -> KiloBundle.message("session.question.review")
                else -> KiloBundle.message("session.question.next")
            }
            val isPrimary = direct(q) || lastItem(q)
            actions.add(BaseQuestionView.Action(ID_MAIN, label, isPrimary) {
                when {
                    direct(q) -> doReply()
                    lastItem(q) -> goReview()
                    else -> goForward()
                }
            })
        }
        card.setActions(actions)
    }

    @RequiresEdt
    private fun syncControls(q: Question) {
        val ready = isReady(idx)
        back.isEnabled = idx > 0
        fwd.isEnabled = idx < q.items.size && ready
        card.setActionEnabled(ID_MAIN, review(q) || ready)
    }

    /**
     * Computes whether the question at [i] has an effective (non-blank) answer.
     * For a question with custom=true and custom row selected, the custom text
     * must be non-blank. For option-only answers the selection set must be non-empty.
     */
    private fun isReady(i: Int): Boolean {
        val open = customOpen.getOrElse(i) { false }
        val txt = customTexts.getOrElse(i) { "" }.trim()
        val sel = selections.getOrNull(i)
        return if (open) txt.isNotEmpty() else sel?.isNotEmpty() == true
    }

    /**
     * Returns the effective answers for question at index [i] — what will be sent
     * in the reply payload. Custom text is included when non-blank and the custom
     * row is selected (single-select) or active (multi-select).
     */
    private fun effectiveAnswers(i: Int): List<String> {
        val q = question ?: return emptyList()
        val item = q.items.getOrNull(i) ?: return emptyList()
        val txt = customTexts.getOrElse(i) { "" }.trim()
        val open = customOpen.getOrElse(i) { false }
        val sel = selections.getOrNull(i) ?: emptySet()

        return if (item.multiple) {
            val result = sel.toMutableList()
            if (open && txt.isNotEmpty() && txt !in result) result.add(txt)
            result
        } else {
            // single-select: if custom is open, use custom text; otherwise use selection
            if (open && txt.isNotEmpty()) listOf(txt)
            else sel.toList()
        }
    }

    private fun optionAnswers(i: Int): List<String> = selections.getOrNull(i)?.toList() ?: emptyList()

    @RequiresEdt
    private fun addContent(item: QuestionItem, set: MutableSet<String>) {
        val opts = optionList(item, set)
        opts.alignmentX = Component.LEFT_ALIGNMENT
        body.add(opts)
    }

    @RequiresEdt
    private fun addReview(q: Question) {
        for ((i, item) in q.items.withIndex()) {
            val row = reviewRow(item, i)
            row.alignmentX = Component.LEFT_ALIGNMENT
            body.add(row)
        }
        // Remove bottom padding on the last review row to match the top gap.
        (body.components.lastOrNull() as? JPanel)?.border = JBUI.Borders.empty()
    }

    @RequiresEdt
    private fun reviewRow(item: QuestionItem, i: Int): JPanel {
        val row = JPanel().apply {
            isOpaque = false
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            border = JBUI.Borders.emptyBottom(UiStyle.Gap.lg())
        }
        val qText = text(item.question, UiStyle.Colors.weak())
        qText.alignmentX = Component.LEFT_ALIGNMENT
        row.add(qText)

        val answers = effectiveAnswers(i)
        val joined = answers.joinToString(", ")
        val answer = text(
            joined.ifBlank { KiloBundle.message("session.question.review.notAnswered") },
            UiStyle.Colors.fg(),
            true,
        )
        answer.alignmentX = Component.LEFT_ALIGNMENT
        row.add(answer)
        return row
    }

    @RequiresEdt
    private fun optionList(item: QuestionItem, set: MutableSet<String>): JPanel {
        val panel = JPanel().apply {
            isOpaque = false
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
        }
        if (item.multiple) {
            for (opt in item.options) panel.add(checkboxRow(opt, set))
        } else {
            val group = ButtonGroup()
            for (opt in item.options) panel.add(radioRow(opt, set, group))
        }

        if (item.custom) {
            panel.add(customRow(item, set))
        } else {
            // Remove bottom padding on the last option so the gap before the action
            // footer matches the gap above the options (both use Gap.lg).
            (panel.components.lastOrNull() as? JPanel)?.border = JBUI.Borders.empty()
        }
        return panel
    }

    @RequiresEdt
    private fun customRow(item: QuestionItem, set: MutableSet<String>): JPanel {
        val open = customOpen.getOrElse(idx) { false }
        val existing = customTexts.getOrElse(idx) { "" }.trim()
        val showEditor = open || existing.isNotEmpty()
        val row = JPanel().apply {
            isOpaque = false
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            // No bottom padding — it's the last row
            border = JBUI.Borders.empty()
        }

        val toggle: AbstractButton = if (item.multiple) {
            JBCheckBox().apply {
                actionCommand = ""
                isSelected = open
                isOpaque = false
            }
        } else {
            JBRadioButton().apply {
                actionCommand = ""
                isSelected = open
                isOpaque = false
            }
        }

        val toggleListener = {
            val wasOpen = customOpen.getOrElse(idx) { false }
            if (!wasOpen) {
                // Opening custom row
                if (!item.multiple) {
                    // Single-select: clear option selection
                    set.clear()
                }
                customOpen = customOpen.toMutableList().also { it[idx] = true }
            } else {
                // Closing custom row
                customOpen = customOpen.toMutableList().also { it[idx] = false }
            }
            refreshCustomRow()
        }

        if (item.multiple) {
            (toggle as JBCheckBox).addActionListener { toggleListener() }
        } else {
            (toggle as JBRadioButton).addActionListener {
                // When the custom radio is selected, deselect any option radio
                set.clear()
                customOpen = customOpen.toMutableList().also { it[idx] = true }
                refreshCustomRow()
            }
        }

        val press = object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (toggle.isEnabled) toggle.doClick()
            }
        }

        val icon = JPanel(GridBagLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.emptyRight(UiStyle.Gap.sm())
            add(toggle)
            addMouseListener(press)
        }

        val col = JPanel().apply {
            isOpaque = false
            layout = GridBagLayout()
            addMouseListener(press)
        }

        val label = text(KiloBundle.message("session.question.custom.label"), UiStyle.Colors.fg(), true)
        label.alignmentX = Component.LEFT_ALIGNMENT
        label.addMouseListener(press)
        col.add(label)

        val header = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.emptyBottom(UiStyle.Gap.lg())
            toolTipText = null
            alignmentX = Component.LEFT_ALIGNMENT
        }
        header.addMouseListener(press)
        header.add(icon, BorderLayout.WEST)
        header.add(col, BorderLayout.CENTER)
        row.add(header)

        if (showEditor) {
            val ed = buildCustomEditor()
            customEditor = ed
            val focus = object : FocusAdapter() {
                override fun focusGained(e: FocusEvent) = selectCustom(item, set)
            }
            customFocus = focus
            ed.addFocusListener(focus)
            ed.addSettingsProvider { ex ->
                ex.contentComponent.addFocusListener(focus)
                ex.component.addFocusListener(focus)
            }
            val edWrapper = JPanel(BorderLayout()).apply {
                isOpaque = false
                border = JBUI.Borders.empty(0, UiStyle.Gap.lg() + JBUI.scale(20), UiStyle.Gap.lg(), 0)
                alignmentX = Component.LEFT_ALIGNMENT
                add(ed, BorderLayout.CENTER)
            }
            row.add(edWrapper)
        }

        return row
    }

    @RequiresEdt
    internal fun testFocusCustomEditor() {
        val ed = customEditor ?: return
        val focus = customFocus ?: return
        focus.focusGained(FocusEvent(ed, FocusEvent.FOCUS_GAINED))
    }

    @RequiresEdt
    private fun selectCustom(item: QuestionItem, set: MutableSet<String>) {
        if (customOpen.getOrElse(idx) { false }) return
        if (!item.multiple) set.clear()
        customOpen = customOpen.toMutableList().also { it[idx] = true }
        refreshCustomRow()
    }

    /**
     * Builds and wires a custom-answer [SessionEditorTextField].
     *
     * The component is created on the EDT (as required for all Swing components).
     * [SessionEditorTextField] extends [com.intellij.ui.EditorTextField] which
     * lazily initialises its IntelliJ editor via [com.intellij.openapi.editor.EditorThreading]
     * the first time the component becomes visible, satisfying the platform's
     * read-context requirement without any additional wrapping here.
     */
    @RequiresEdt
    private fun buildCustomEditor(): SessionEditorTextField {
        val ed = SessionEditorTextField(project, selection = selection)
        ed.border = JBUI.Borders.empty()
        ed.setFontInheritedFromLAF(false)
        ed.setPlaceholder(KiloBundle.message("session.question.custom.placeholder"))
        ed.setShowPlaceholderWhenFocused(true)
        ed.setOneLineMode(false)
        ed.addSettingsProvider { ex ->
            style.applyPromptToEditor(ex)
            ex.settings.isUseSoftWraps = true
            ex.settings.isPaintSoftWraps = false
            ex.settings.isAdditionalPageAtBottom = false
            ex.setHorizontalScrollbarVisible(false)
            ex.scrollPane.verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER
            ex.scrollPane.horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            syncEditorHeight(ed, ex)
        }
        selection?.register(ed)?.let(regs::add)
        style.applyTranscriptToField(ed)
        ed.background = style.editorBackground

        // Pre-fill with saved text. This call also forces lazy document creation so
        // that addDocumentListener can install on a non-null document immediately.
        val saved = customTexts.getOrElse(idx) { "" }
        ed.text = saved

        // Sync preferred height to line count; update stored text on edits.
        // EditorTextField.addDocumentListener is the preferred (non-deprecated) API.
        // The document was already created above (ed.text = saved ensures getDocument()
        // was called), so installDocumentListener succeeds.
        ed.addDocumentListener(object : DocumentListener {
            @RequiresEdt
            override fun documentChanged(e: DocumentEvent) {
                val txt = ed.text
                customTexts = customTexts.toMutableList().also { it[idx] = txt }
                syncEditorHeight(ed)
                question?.let(::syncControls)
                refresh()
                scroll(follow())
            }
        })

        syncEditorHeight(ed)
        return ed
    }

    @RequiresEdt
    private fun disposeCustomEditor() {
        val ed = customEditor ?: return
        customEditor = null
        ed.getEditor(false)?.let { EditorFactory.getInstance().releaseEditor(it) }
    }

    @RequiresEdt
    private fun syncEditorHeight(ed: SessionEditorTextField) {
        syncEditorHeight(ed, ed.getEditor(false))
    }

    @RequiresEdt
    private fun syncEditorHeight(ed: SessionEditorTextField, editor: EditorEx?) {
        val estimated = estimatedLines(ed)
        val lines = maxOf(editor?.offsetToVisualPosition(editor.document.textLength)?.line?.plus(1) ?: estimated, estimated)
        val line = editor?.lineHeight ?: ed.getFontMetrics(ed.font).height
        val min = line + JBUI.scale(SessionUiStyle.View.Prompt.EDITOR_CHROME)
        val content = line * lines.coerceAtLeast(1) + JBUI.scale(SessionUiStyle.View.Prompt.EDITOR_CHROME)
        val cap = rootCap(min)
        val height = minOf(content, cap ?: content).coerceAtLeast(min)
        syncEditorScroll(editor, content > height)
        // height is already scaled px (from the editor lineHeight); assign with plain
        // Dimension so IDE zoom does not scale it again via the user scale factor.
        ed.preferredSize = Dimension(0, height)
        ed.minimumSize = Dimension(0, height)
    }

    @RequiresEdt
    private fun syncEditorScroll(ed: EditorEx?, overflow: Boolean) {
        // AS_NEEDED keeps the standard auto-hiding editor scrollbar (appears on
        // scroll/hover, fades on inactivity); NEVER hides it entirely when the
        // content fits so no bar is shown at all.
        ed?.scrollPane?.verticalScrollBarPolicy = if (overflow) {
            ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        } else {
            ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER
        }
    }

    @RequiresEdt
    private fun rootCap(min: Int): Int? {
        val root = SwingUtilities.getAncestorOfClass(SessionRootPanel::class.java, this) as? SessionRootPanel
            ?: return null
        if (root.height <= 0) return null
        return (root.height / 3).coerceAtLeast(min)
    }

    @RequiresEdt
    private fun estimatedLines(ed: SessionEditorTextField): Int {
        val width = space(ed)
        if (width <= 0) return (ed.text.count { it == '\n' } + 1).coerceAtLeast(1)
        val metrics = ed.getFontMetrics(ed.font)
        val columns = (width / metrics.charWidth('m').coerceAtLeast(1)).coerceAtLeast(1)
        return ed.text.lineSequence().sumOf { line ->
            ((line.length + columns - 1) / columns).coerceAtLeast(1)
        }.coerceAtLeast(1)
    }

    @RequiresEdt
    private fun space(component: Component): Int {
        if (component.width > 0) return component.width
        var node = component.parent
        while (node != null) {
            if (node.width > 0) {
                val ins = node.insets
                return (node.width - ins.left - ins.right).coerceAtLeast(0)
            }
            node = node.parent
        }
        return 0
    }

    /** Re-syncs the current page after the custom row toggle changes. */
    @RequiresEdt
    private fun refreshCustomRow() {
        val q = question ?: return
        syncPage()
        // Request focus on the editor when opening
        if (customOpen.getOrElse(idx) { false }) {
            customEditor?.requestFocusInWindow()
        }
        syncControls(q)
        scroll(follow())
    }

    @RequiresEdt
    private fun radioRow(opt: QuestionOption, set: MutableSet<String>, group: ButtonGroup): JPanel {
        val radio = JBRadioButton().apply {
            actionCommand = opt.label
            isSelected = opt.label in set
            isOpaque = false
        }
        group.add(radio)
        radio.addActionListener {
            set.clear()
            set.add(opt.label)
            // Selecting a normal option closes the custom row
            customOpen = customOpen.toMutableList().also { it[idx] = false }
            if (customEditor == null) {
                refreshSelection()
                return@addActionListener
            }
            refreshCustomRow()
        }
        return optionRow(radio, opt)
    }

    @RequiresEdt
    private fun checkboxRow(opt: QuestionOption, set: MutableSet<String>): JPanel {
        val box = JBCheckBox().apply {
            actionCommand = opt.label
            isSelected = opt.label in set
            isOpaque = false
        }
        box.addActionListener {
            if (box.isSelected) set.add(opt.label) else set.remove(opt.label)
            refreshSelection()
        }
        return optionRow(box, opt)
    }

    @RequiresEdt
    private fun optionRow(toggle: AbstractButton, opt: QuestionOption): JPanel {
        val row = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.emptyBottom(UiStyle.Gap.lg())
            toolTipText = opt.description.ifBlank { null }
            alignmentX = Component.LEFT_ALIGNMENT
        }
        val press = object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (toggle.isEnabled) toggle.doClick()
            }
        }
        val center = opt.description.isBlank()
        val icon = JPanel(if (center) GridBagLayout() else BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.emptyRight(UiStyle.Gap.sm())
            if (center) add(toggle) else add(toggle, BorderLayout.NORTH)
            addMouseListener(press)
        }
        val col = JPanel().apply {
            isOpaque = false
            layout = if (center) GridBagLayout() else BoxLayout(this, BoxLayout.Y_AXIS)
            addMouseListener(press)
        }
        val label = text(opt.label, UiStyle.Colors.fg(), true)
        label.alignmentX = Component.LEFT_ALIGNMENT
        label.addMouseListener(press)
        col.add(label)

        if (opt.description.isNotBlank()) {
            val desc = text(opt.description, UiStyle.Colors.weak())
            desc.alignmentX = Component.LEFT_ALIGNMENT
            desc.addMouseListener(press)
            col.add(desc)
        }

        row.addMouseListener(press)
        row.add(icon, BorderLayout.WEST)
        row.add(col, BorderLayout.CENTER)
        return row
    }

    @RequiresEdt
    private fun text(value: String, color: Color, bold: Boolean = false): JBTextArea {
        val area = object : JBTextArea(value) {
            override fun getPreferredSize() = withWidth(super.getPreferredSize().height)

            override fun getMaximumSize(): Dimension {
                val size = preferredSize
                return Dimension(Int.MAX_VALUE, size.height)
            }

            override fun scrollRectToVisible(aRect: Rectangle) {}

            private fun withWidth(fallback: Int): Dimension {
                val width = space()
                if (width <= 0) return Dimension(super.getPreferredSize().width, fallback)
                val old = size
                setSize(width, Int.MAX_VALUE)
                val size = super.getPreferredSize()
                setSize(old)
                return Dimension(width, size.height)
            }

            private fun space(): Int {
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
            foreground = color
            border = JBUI.Borders.empty()
        }
        texts.add(area to bold)
        selection?.register(area)?.let(regs::add)
        setFont(area, bold)
        return area
    }

    private fun disposeRegs() {
        regs.forEach(Disposer::dispose)
        regs.clear()
    }

    private fun single(q: Question): Boolean = q.items.size == 1 && !q.items[0].multiple

    private fun review(q: Question): Boolean = !single(q) && idx == q.items.size

    private fun lastItem(q: Question): Boolean = idx == q.items.size - 1

    private fun direct(q: Question): Boolean = single(q)

    @RequiresEdt
    private fun goBack() {
        if (idx <= 0) return
        idx--
        syncPage()
        scroll(true)
    }

    @RequiresEdt
    private fun goForward() {
        val q = question ?: return
        if (idx >= q.items.size || !isReady(idx)) return
        val toReview = idx == q.items.size - 1 && !direct(q)
        if (toReview) {
            goReview()
        }
        if (!toReview) {
            idx++
            syncPage()
            scroll(true)
        }
    }

    @RequiresEdt
    private fun goReview() {
        val q = question ?: return
        if (idx == q.items.size - 1 && isReady(idx)) {
            idx = q.items.size
            syncPage()
            scroll(true)
        }
    }

    @RequiresEdt
    private fun refreshSelection() {
        question?.let(::syncControls)
        refresh()
        scroll(follow())
    }

    @RequiresEdt
    private fun doReply() {
        val id = request ?: return
        if ((question?.items?.indices ?: return).any { !isReady(it) }) return
        val answers = (question?.items?.indices ?: return).map { effectiveAnswers(it) }
        val opts = (question?.items?.indices ?: return).map { optionAnswers(it) }
        reply(id, QuestionReplyDto(answers), opts)
        hideView()
        scroll(follow())
    }

    @RequiresEdt
    private fun doReject() {
        val id = request ?: return
        reject(id)
        hideView()
        scroll(follow())
    }

    @RequiresEdt
    private fun setFont(area: JBTextArea, bold: Boolean): Boolean {
        val font = if (bold) style.boldFont else style.regularFont
        if (area.font == font) return false
        area.font = font
        return true
    }

    @RequiresEdt
    private fun refresh() {
        revalidate()
        repaint()
        parent?.revalidate()
        parent?.repaint()
    }
}
