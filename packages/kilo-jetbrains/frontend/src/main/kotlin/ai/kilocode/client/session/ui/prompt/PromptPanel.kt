package ai.kilocode.client.session.ui.prompt

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.actions.SendPromptAction
import ai.kilocode.client.actions.StopSessionAction
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.ReasoningPicker
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.model.PromptAttachment
import ai.kilocode.client.session.model.PromptAttachmentExtractor
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.ui.mode.ModePicker
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.iconButton
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.PromptPartDto
import com.intellij.icons.AllIcons
import com.intellij.codeInsight.completion.CodeCompletionHandlerBase
import com.intellij.codeInsight.completion.CompletionType
import com.intellij.codeInsight.lookup.LookupEx
import com.intellij.codeInsight.lookup.LookupManagerListener
import com.intellij.codeInsight.lookup.LookupPositionStrategy
import com.intellij.codeInsight.lookup.LookupPresentation
import com.intellij.ide.DataManager
import com.intellij.ide.dnd.DnDEvent
import com.intellij.ide.dnd.DnDSupport
import com.intellij.ide.dnd.FileCopyPasteUtil
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUiKind
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.actionSystem.IdeActions
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.SpellCheckingEditorCustomizationProvider
import com.intellij.openapi.editor.colors.CodeInsightColors
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.editor.event.CaretEvent
import com.intellij.openapi.editor.event.CaretListener
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.editor.markup.HighlighterLayer
import com.intellij.openapi.editor.markup.HighlighterTargetArea
import com.intellij.openapi.editor.markup.RangeHighlighter
import com.intellij.openapi.keymap.Keymap
import com.intellij.openapi.keymap.KeymapManagerListener
import com.intellij.openapi.keymap.KeymapUtil
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.IslandsState
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.xml.util.XmlStringUtil
import com.intellij.util.ui.JBDimension
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import com.intellij.util.messages.MessageBusConnection
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.BasicStroke
import java.awt.BorderLayout
import java.awt.Cursor
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.datatransfer.DataFlavor
import java.awt.datatransfer.Transferable
import java.awt.event.FocusAdapter
import java.awt.event.FocusEvent
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.geom.Path2D
import java.util.concurrent.Future
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.Icon
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.ScrollPaneConstants
import javax.swing.SwingUtilities

/**
 * Prompt input panel with a borderless IntelliJ editor text field and
 * mode/model controls in the full bottom session area.
 */
class PromptPanel(
    private val project: Project,
    private val onSend: (String, List<PromptPartDto>) -> Unit,
    private val onAbort: () -> Unit,
    private val onEnhance: (String, (Result<String>) -> Unit) -> Unit,
    private val onMentions: suspend (String) -> List<PromptPartDto> = { emptyList() },
    private val completion: KiloPromptCompletionProvider? = null,
    private val selection: SessionSelection? = null,
    private val cs: CoroutineScope = CoroutineScope(Dispatchers.Default),
) : BorderLayoutPanel(), SessionEditorStyleTarget, SendPromptContext, UiDataProvider {

    companion object {
        private val LOG = KiloLog.create(PromptPanel::class.java)
        private val SEND_ICON: Icon = IconLoader.getIcon("/icons/send.svg", PromptPanel::class.java)
        private val STOP_ICON: Icon = IconLoader.getIcon("/icons/stop.svg", PromptPanel::class.java)
        private val SHIELD_ICON: Icon = IconLoader.getIcon("/icons/shield.svg", PromptPanel::class.java)
        private val SHIELD_FILLED_ICON: Icon = IconLoader.getIcon("/icons/shield-filled.svg", PromptPanel::class.java)
        private val WAND_ICON: Icon = IconLoader.getIcon("/icons/wand-sparkles.svg", PromptPanel::class.java)
        private val MENTION_KEY = DefaultLanguageHighlighterColors.METADATA
        private val COMMAND_KEY = DefaultLanguageHighlighterColors.KEYWORD
        private val INVALID_KEY = CodeInsightColors.WRONG_REFERENCES_ATTRIBUTES
    }

    val mode = ModePicker()
    val model = ModelPicker().apply {
        placement = ModelPicker.Placement.ABOVE
    }
    val reasoning = ReasoningPicker()
    var onReset: () -> Unit = {}
    var onChange: () -> Unit = {}
    var onAutoApproveToggle: (Boolean) -> Unit = {}
    var onFileDrag: (Boolean) -> Unit = {}
    private var style = SessionEditorStyle.current()
    private var focused = false
    private val shell = BorderLayoutPanel().apply {
        isOpaque = true
        border = JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
        )
    }
    private val attachments = mutableListOf<PromptAttachment>()
    private val highlighters = mutableListOf<RangeHighlighter>()
    private val strip = PromptAttachmentStrip(project) { removeAttachment(it) }
    private var bus: MessageBusConnection? = null
    private var lookupBus: MessageBusConnection? = null
    private var completionAction: AnAction? = null
    private var completionTarget: JComponent? = null
    private var mentionCaret = false
    private var autoApprove = false
    private var attachment = true
    private var submitting = false
    private var root: SessionRootPanel? = null
    private val resize = object : ComponentAdapter() {
        override fun componentResized(e: ComponentEvent) {
            syncEditorHeight()
        }
    }

    private val editor = PromptEditorTextField(project, this, completion, selection).apply {
        border = JBUI.Borders.empty()
        setFontInheritedFromLAF(false)
        setPlaceholder(placeholder())
        setShowPlaceholderWhenFocused(true)
        setOneLineMode(false)
        addSettingsProvider { ed ->
            style.applyTranscriptToEditor(ed)
            ed.setBorder(JBUI.Borders.empty())
            ed.scrollPane.border = JBUI.Borders.empty()
            ed.scrollPane.viewportBorder = JBUI.Borders.empty(
                0,
                JBUI.scale(SessionUiStyle.View.Prompt.EDITOR_HORIZONTAL_INSET),
                0,
                JBUI.scale(SessionUiStyle.View.Prompt.EDITOR_HORIZONTAL_INSET),
            )
            ed.backgroundColor = style.editorScheme.defaultBackground
            ed.scrollPane.background = style.editorScheme.defaultBackground
            ed.scrollPane.viewport.background = style.editorScheme.defaultBackground
            ed.settings.isUseSoftWraps = true
            ed.settings.isPaintSoftWraps = false
            ed.settings.isAdditionalPageAtBottom = false
            SpellCheckingEditorCustomizationProvider.getInstance().getDisabledCustomization()?.customize(ed)
            ed.putUserData(PROMPT_ATTACHMENT_PASTE_HANDLER_KEY, PromptAttachmentPasteHandler { processPaste(it) })
            ed.scrollPane.verticalScrollBarPolicy =
                ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
            ed.scrollPane.horizontalScrollBarPolicy =
                ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            installCompletionShortcut(ed)
            completion?.let { MentionNavigator(ed, it).install() }
            installFileDrop(ed.contentComponent, "editor")
            installFileDrop(ed.scrollPane, "scroll")
            syncHighlights()
            ed.caretModel.addCaretListener(object : CaretListener {
                override fun caretPositionChanged(e: CaretEvent) {
                    val provider = completion ?: return
                    val inside = provider.inside(ed.document.text, ed.caretModel.offset)
                    if (mentionCaret == inside) return
                    mentionCaret = inside
                    syncHighlights()
                }
            })
            ed.contentComponent.addFocusListener(object : FocusAdapter() {
                override fun focusGained(e: FocusEvent) {
                    syncFocus(true)
                }

                override fun focusLost(e: FocusEvent) {
                    syncFocus(false)
                }
            })
        }
    }

    private val button: SendButton = SendButton().apply {
        icon = SEND_ICON
        isFocusPainted = false
        addActionListener {
            syncTooltip()
            val id = if (busy) StopSessionAction.ID else SendPromptAction.ID
            val action = ActionManager.getInstance().getAction(id)
                ?: return@addActionListener
            val ctx = DataManager.getInstance().getDataContext(button)
            val event = AnActionEvent.createEvent(action, ctx, null, ActionPlaces.UNKNOWN, ActionUiKind.NONE, null)
            ActionUtil.updateAction(action, event)
            ActionUtil.performAction(action, event)
        }
    }

    private val reset = HoverIcon().apply {
        icon = AllIcons.Actions.Cancel
        toolTipText = KiloBundle.message("model.picker.reset")
        accessibleContext.accessibleName = KiloBundle.message("model.picker.reset")
        isVisible = false
        addActionListener { onReset() }
    }

    private val auto = AutoApproveButton().apply {
        icon = SHIELD_ICON
        addActionListener { onAutoApproveToggle(!autoApprove) }
    }

    private val enhancingIcon = AnimatedIcon.Default()
    private val enhance = HoverIcon().apply {
        icon = WAND_ICON
        toolTipText = KiloBundle.message("prompt.action.enhance")
        accessibleContext.accessibleName = KiloBundle.message("prompt.action.enhance")
        addActionListener { enhance() }
    }

    @Volatile
    private var busy = false
    private var ready = false
    private var enhancing = false
    private var request = 0L

    override val isSendEnabled: Boolean
        get() = ready && !busy && !submitting && (text().isNotEmpty() || attachments.isNotEmpty())

    override val isStopEnabled: Boolean
        get() = busy

    init {
        applyStyle(style)
        selection?.register(editor)
        editor.text = ""
        editor.addDocumentListener(object : DocumentListener {
            override fun documentChanged(e: DocumentEvent) {
                invalidateEnhancement()
                syncEditorHeight()
                triggerCompletion(e)
                syncHighlights()
                onChange()
            }
        })
        shell.add(strip, BorderLayout.NORTH)
        shell.add(editor, BorderLayout.CENTER)

        val bar = BorderLayoutPanel().apply {
            layout = BoxLayout(this, BoxLayout.X_AXIS)
            isOpaque = false
            border = JBUI.Borders.emptyTop(JBUI.scale(SessionUiStyle.View.Prompt.CONTROL_GAP))
        }
        bar.add(mode)
        bar.add(Box.createHorizontalStrut(JBUI.scale(SessionUiStyle.View.Prompt.CONTROL_GAP)))
        bar.add(model)
        bar.add(Box.createHorizontalStrut(JBUI.scale(SessionUiStyle.View.Prompt.CONTROL_GAP)))
        bar.add(reasoning)
        bar.add(Box.createHorizontalStrut(JBUI.scale(SessionUiStyle.View.Prompt.CONTROL_GAP)))
        bar.add(reset)
        bar.add(Box.createHorizontalGlue())
        bar.add(auto)
        bar.add(Box.createHorizontalStrut(JBUI.scale(SessionUiStyle.View.Prompt.CONTROL_GAP)))
        bar.add(enhance)
        bar.add(Box.createHorizontalStrut(JBUI.scale(SessionUiStyle.View.Prompt.CONTROL_GAP)))
        bar.add(button)
        shell.add(bar, BorderLayout.SOUTH)
        add(shell, BorderLayout.CENTER)
        addComponentListener(resize)
        installFileDrop(shell, "shell")
        syncTooltip()
        syncAutoApprove()
        syncEnhance()
    }

    override fun updateUI() {
        super.updateUI()
        syncBorder()
    }

    private fun syncFocus(value: Boolean) {
        if (focused == value) {
            repaint()
            return
        }
        focused = value
        syncBorder()
        revalidate()
        repaint()
    }

    private fun syncBorder() {
        border = JBUI.Borders.compound(
            if (focused) {
                JBUI.Borders.emptyTop(JBUI.scale(1))
            } else {
                JBUI.Borders.customLineTop(SessionUiStyle.View.Prompt.separator())
            },
            JBUI.Borders.empty(),
        )
    }

    override fun paintChildren(g: Graphics) {
        super.paintChildren(g)
        if (!editorFocused()) return
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            val line = JBUI.scale(SessionUiStyle.View.Prompt.FOCUS_WIDTH)
            val half = line / 2f
            val top = half
            val left = half
            val right = width - half
            val bottom = height - half
            val arc = if (IslandsState.isEnabled()) {
                JBUI.scale(JBUI.getInt("Island.arc", SessionUiStyle.View.Prompt.CORNER_ARC)) / 2f
            } else {
                0f
            }
            val radius = arc
                .coerceAtMost((right - left) / 2f)
                .coerceAtMost(bottom - top)
                .coerceAtLeast(0f)
            val path = Path2D.Float().apply {
                moveTo(left, top)
                lineTo(right, top)
                lineTo(right, bottom - radius)
                if (radius > 0f) {
                    quadTo(right, bottom, right - radius, bottom)
                    lineTo(left + radius, bottom)
                    quadTo(left, bottom, left, bottom - radius)
                } else {
                    lineTo(right, bottom)
                    lineTo(left, bottom)
                }
                closePath()
            }
            g2.color = JBUI.CurrentTheme.Focus.focusColor()
            g2.stroke = BasicStroke(line.toFloat(), BasicStroke.CAP_BUTT, BasicStroke.JOIN_ROUND)
            g2.draw(path)
        } finally {
            g2.dispose()
        }
    }

    private fun editorFocused(): Boolean {
        val ed = editor.getEditor(false) ?: return editor.hasFocus()
        return editor.hasFocus() || ed.contentComponent.hasFocus()
    }

    @RequiresEdt
    fun setReady(value: Boolean) {
        ready = value
        if (value) completion?.prewarm()
        if (!value) invalidateEnhancement() else syncEnhance()
    }

    @RequiresEdt
    fun setAttachmentEnabled(value: Boolean) {
        attachment = value
    }

    @RequiresEdt
    fun setBusy(value: Boolean) {
        busy = value
        if (value) invalidateEnhancement() else syncEnhance()
        button.icon = if (value) STOP_ICON else SEND_ICON
        syncTooltip()
    }

    @RequiresEdt
    fun setAutoApprove(value: Boolean) {
        if (autoApprove == value) return
        autoApprove = value
        syncAutoApprove()
    }

    @RequiresEdt
    fun setResetVisible(value: Boolean) {
        reset.isVisible = value
        revalidate()
        repaint()
    }

    @RequiresEdt
    fun text(): String = editor.text.trim()

    @RequiresEdt
    override fun send() {
        submit("action")
    }

    @RequiresEdt
    override fun stop() {
        if (!isStopEnabled) return
        onAbort()
    }

    internal fun inputFont() = editor.font

    internal fun resetVisibleForTest() = reset.isVisible

    internal fun resetForTest(): JComponent = reset

    internal fun shellForTest(): JComponent = shell

    internal fun buttonForTest(): JButton = button

    internal fun attachmentCountForTest(): Int = attachments.size

    internal val defaultFocusedComponent: JComponent get() = editor

    override fun uiDataSnapshot(sink: DataSink) {
        selection?.provideCopy(sink) { editor.text }
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        background = style.editorScheme.defaultBackground
        shell.background = style.editorScheme.defaultBackground
        editor.font = style.transcriptFont
        editor.getEditor(false)?.let(style::applyTranscriptToEditor)
        editor.background = style.editorScheme.defaultBackground
        syncEditorHeight()
        syncAutoApprove()
        syncHighlights()
    }

    @RequiresEdt
    fun refreshHighlights() {
        syncHighlights()
    }

    @RequiresEdt
    fun clear() {
        editor.text = ""
        attachments.clear()
        completion?.clearMentions()
        completion?.prewarm()
        strip.clear()
        syncEditorHeight()
        syncHighlights()
    }

    @RequiresEdt
    private fun syncHighlights() {
        val provider = completion ?: return
        val ed = editor.getEditor(false) ?: return
        highlighters.forEach(ed.markupModel::removeHighlighter)
        highlighters.clear()
        val length = ed.document.textLength
        val text = ed.document.text
        val caret = ed.caretModel.offset
        provider.validate(text, caret) {
            ApplicationManager.getApplication().invokeLater {
                if (!project.isDisposed) refreshHighlights()
            }
        }
        provider.highlights(text, caret).forEach { item ->
            val start = item.start.coerceIn(0, length)
            val end = item.end.coerceIn(start, length)
            if (start == end) return@forEach
            highlighters += ed.markupModel.addRangeHighlighter(
                key(item.kind),
                start,
                end,
                HighlighterLayer.SYNTAX + 1,
                HighlighterTargetArea.EXACT_RANGE,
            )
        }
        mentionCaret = provider.inside(text, caret)
    }

    private fun key(kind: KiloPromptCompletionProvider.HighlightKind): TextAttributesKey = when (kind) {
        KiloPromptCompletionProvider.HighlightKind.MENTION -> MENTION_KEY
        KiloPromptCompletionProvider.HighlightKind.COMMAND -> COMMAND_KEY
        KiloPromptCompletionProvider.HighlightKind.INVALID -> INVALID_KEY
    }

    @RequiresEdt
    fun addAttachmentForTest(item: PromptAttachment) {
        addAttachment(item)
    }

    internal fun processPasteForTest(transferable: Transferable): Future<*> = processPaste(transferable)

    @RequiresEdt
    fun focus() {
        editor.requestFocusInWindow()
    }

    override fun addNotify() {
        super.addNotify()
        bindRoot()
        bindKeymap()
        bindLookup()
    }

    override fun removeNotify() {
        root?.removeComponentListener(resize)
        root = null
        bus?.disconnect()
        bus = null
        lookupBus?.disconnect()
        lookupBus = null
        uninstallCompletionShortcut()
        super.removeNotify()
    }

    @RequiresEdt
    private fun enhance() {
        if (!enhance.isEnabled) return
        val source = editor.text
        if (source.isBlank()) {
            editor.text = KiloBundle.message("prompt.action.enhance.description")
            syncEditorHeight()
            focus()
            return
        }
        val id = ++request
        enhancing = true
        syncEnhance()
        onEnhance(source.trim()) { result -> completeEnhancement(id, source, result) }
    }

    @RequiresEdt
    private fun completeEnhancement(id: Long, source: String, result: Result<String>) {
        if (id != request || editor.text != source) return
        enhancing = false
        syncEnhance()
        result.onSuccess {
            editor.text = it
            syncEditorHeight()
            focus()
        }.onFailure {
            if (it is CancellationException) return@onFailure
            KiloNotifications.error(
                project,
                KiloBundle.message("prompt.action.enhance.failed"),
                KiloBundle.message("prompt.action.enhance.failed.description"),
            )
        }
    }

    @RequiresEdt
    private fun invalidateEnhancement() {
        request++
        enhancing = false
        syncEnhance()
    }

    @RequiresEdt
    private fun syncEnhance() {
        enhance.isEnabled = ready && !busy && !enhancing
        enhance.icon = if (enhancing) enhancingIcon else WAND_ICON
        enhance.toolTipText = if (enhancing) {
            KiloBundle.message("prompt.action.enhance.loading")
        } else {
            KiloBundle.message("prompt.action.enhance")
        }
    }

    @RequiresEdt
    private fun submit(src: String) {
        if (!isSendEnabled) return
        val txt = text()
        val items = attachments.toList()
        submitting = true
        cs.launch {
            try {
                val files = withContext(Dispatchers.IO) { items.map { it.part() } }
                val mentioned = onMentions(txt)
                withContext(Dispatchers.Main) {
                    submitting = false
                    if (project.isDisposed) return@withContext
                    val parts = files + mentioned
                    LOG.debug { "${ChatLogSummary.prompt(promptDto(txt, parts))} src=$src busy=$busy" }
                    onSend(txt, parts)
                }
            } catch (e: CancellationException) {
                withContext(NonCancellable + Dispatchers.Main) {
                    submitting = false
                }
                throw e
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    submitting = false
                    if (project.isDisposed) return@withContext
                    LOG.warn("kind=prompt-submit src=$src failed message=${e.message}", e)
                    notify(KiloBundle.message("prompt.attachment.send.failed", e.message ?: e.javaClass.simpleName))
                }
            }
        }
    }

    private fun triggerCompletion(e: DocumentEvent) {
        if (project.isDisposed) return
        val value = e.newFragment.toString()
        if (value.length != 1) return
        val text = editor.text
        val offset = e.offset + value.length
        val popup = value == "@" || (value == "/" && text.take(offset).trim() == "/")
        if (!popup) return
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            editor.getEditor(false)?.let(::showCompletion)
        }
    }

    @RequiresEdt
    @Suppress("UnstableApiUsage")
    private fun showCompletion(ed: com.intellij.openapi.editor.Editor) {
        // Run completion synchronously and locally on this frontend-only editor. The public entry
        // points (ACTION_CODE_COMPLETION, AutoPopupController.scheduleAutoPopup) route through
        // split-mode RD/autopopup machinery that targets a backend-shared editor: in split mode they
        // either dispatch to the backend (which has no editor and asserts) or get cancelled before the
        // popup shows. CodeCompletionHandlerBase is public (not @ApiStatus.Internal) and is the only
        // API that drives the completion engine directly against this local editor.
        CodeCompletionHandlerBase.createHandler(CompletionType.BASIC, true, false, true)
            .invokeCompletion(project, ed, 1)
    }

    @RequiresEdt
    private fun installCompletionShortcut(ed: com.intellij.openapi.editor.Editor) {
        if (completion == null) return
        val base = ActionManager.getInstance().getAction(IdeActions.ACTION_CODE_COMPLETION) ?: return
        val action = completionAction ?: object : DumbAwareAction(KiloBundle.message("prompt.completion.action")) {
            override fun actionPerformed(e: AnActionEvent) {
                editor.getEditor(false)?.let(::showCompletion)
            }
        }.also { completionAction = it }
        uninstallCompletionShortcut()
        val target = ed.contentComponent
        action.registerCustomShortcutSet(base.shortcutSet, target)
        completionTarget = target
    }

    @RequiresEdt
    private fun refreshCompletionShortcut() {
        val ed = editor.getEditor(false) ?: return
        installCompletionShortcut(ed)
    }

    @RequiresEdt
    private fun uninstallCompletionShortcut() {
        val target = completionTarget ?: return
        completionAction?.unregisterCustomShortcutSet(target)
        completionTarget = null
    }

    @RequiresEdt
    private fun addAttachment(item: PromptAttachment) {
        if (!attachment && PromptAttachmentExtractor.media(item.mime)) {
            LOG.debug { "kind=prompt-attachment add name=${item.name} mime=${item.mime} blocked=unsupported-model" }
            notify(KiloBundle.message("prompt.attachment.unsupported.model"))
            return
        }
        if (attachments.any { it.id == item.id }) {
            LOG.debug { "kind=prompt-attachment add name=${item.name} mime=${item.mime} blocked=duplicate" }
            return
        }
        attachments += item
        strip.add(item)
        LOG.debug { "kind=prompt-attachment add name=${item.name} mime=${item.mime} count=${attachments.size}" }
        syncEditorHeight()
        onChange()
    }

    @RequiresEdt
    private fun removeAttachment(item: PromptAttachment) {
        if (!attachments.removeIf { it.id == item.id }) return
        strip.remove(item)
        syncEditorHeight()
        onChange()
    }

    private fun promptDto(text: String, files: List<PromptPartDto>) = ai.kilocode.rpc.dto.PromptDto(
        parts = buildList {
            text.takeIf { it.isNotBlank() }?.let { add(PromptPartDto(type = "text", text = it)) }
            addAll(files)
        }
    )

    internal fun installFileDrop(target: JComponent, area: String) {
        LOG.debug { "kind=prompt-dnd install area=$area component=${target.javaClass.name}" }
        DnDSupport.createBuilder(target)
            .enableAsNativeTarget()
            .setTargetChecker { event ->
                if (!FileCopyPasteUtil.isFileListFlavorAvailable(event)) {
                    onFileDrag(false)
                    LOG.debug { "kind=prompt-dnd check area=$area accept=false flavor=false" }
                    return@setTargetChecker true
                }
                event.setDropPossible(true)
                onFileDrag(true)
                LOG.debug { "kind=prompt-dnd check area=$area accept=true flavor=true" }
                false
            }
            .setCleanUpOnLeaveCallback {
                onFileDrag(false)
            }
            .setDropHandlerWithResult { event ->
                val start = System.nanoTime()
                val files = dropFiles(event)
                val ms = elapsedMs(start)
                LOG.debug { "kind=prompt-dnd drop area=$area files=${files.size} extractMs=$ms queued=${files.isNotEmpty()}" }
                onFileDrag(false)
                if (files.isEmpty()) return@setDropHandlerWithResult false
                processAttachments("prompt-dnd", area, files, null, ms)
                true
            }
            .install()
    }

    private fun processPaste(transferable: Transferable): Future<*> {
        return processAttachments("prompt-paste", "editor", null, transferable, 0)
    }

    private fun processAttachments(
        kind: String,
        area: String,
        files: List<java.io.File>?,
        transferable: Transferable?,
        sourceMs: Long,
    ): Future<*> {
        return ApplicationManager.getApplication().executeOnPooledThread {
            val start = System.nanoTime()
            try {
                val list = files ?: transferable?.let { FileCopyPasteUtil.getFileList(it).orEmpty() }.orEmpty()
                val image = transferable?.takeIf { list.isEmpty() && it.isDataFlavorSupported(DataFlavor.imageFlavor) }
                    ?.getTransferData(DataFlavor.imageFlavor)
                    ?.let(PromptAttachmentExtractor::image)
                val items = PromptAttachmentExtractor.files(list) + listOfNotNull(image)
                val ms = elapsedMs(start)
                LOG.debug { "kind=$kind extract area=$area files=${list.size} image=${image != null} attachments=${items.size} extractMs=$ms sourceMs=$sourceMs" }
                if (items.isEmpty()) return@executeOnPooledThread
                ApplicationManager.getApplication().invokeLater {
                    if (project.isDisposed) return@invokeLater
                    LOG.debug { "kind=$kind attach area=$area files=${list.size} image=${image != null} attachments=${items.size} extractMs=$ms sourceMs=$sourceMs" }
                    items.forEach(::addAttachment)
                }
            } catch (e: Exception) {
                LOG.warn("kind=$kind extract area=$area failed message=${e.message}", e)
            }
        }
    }

    private fun dropFiles(event: DnDEvent): List<java.io.File> {
        if (!FileCopyPasteUtil.isFileListFlavorAvailable(event)) return emptyList()
        return FileCopyPasteUtil.getFileListFromAttachedObject(event.attachedObject).orEmpty()
    }

    private fun elapsedMs(start: Long) = (System.nanoTime() - start) / 1_000_000

    private fun notify(text: String) {
        com.intellij.notification.Notification("Kilo Code", text, com.intellij.notification.NotificationType.WARNING).notify(project)
    }

    @RequiresEdt
    private fun bindKeymap() {
        if (bus != null) return
        val connection = ApplicationManager.getApplication().messageBus.connect()
        bus = connection
        connection.subscribe(KeymapManagerListener.TOPIC, object : KeymapManagerListener {
            override fun activeKeymapChanged(keymap: Keymap?) {
                editor.setPlaceholder(placeholder())
                syncTooltip()
                refreshCompletionShortcut()
            }

            override fun shortcutsChanged(keymap: Keymap, actionIds: Collection<String>, fromSettings: Boolean) {
                if (SendPromptAction.ID in actionIds || StopSessionAction.ID in actionIds ||
                    IdeActions.ACTION_EDITOR_START_NEW_LINE in actionIds) {
                    editor.setPlaceholder(placeholder())
                    syncTooltip()
                }
                if (IdeActions.ACTION_CODE_COMPLETION in actionIds) refreshCompletionShortcut()
            }
        })
    }

    @RequiresEdt
    private fun bindLookup() {
        if (lookupBus != null) return
        val connection = project.messageBus.connect()
        lookupBus = connection
        connection.subscribe(LookupManagerListener.TOPIC, LookupManagerListener { _, next ->
            // LookupPresentation/LookupPositionStrategy are @ApiStatus.Experimental (no stable API
            // forces the lookup above the caret). LookupEx is the public lookup interface.
            val lookup = next as? LookupEx ?: return@LookupManagerListener
            if (lookup.editor !== editor.getEditor(false)) return@LookupManagerListener
            lookup.presentation = LookupPresentation.Builder(lookup.presentation)
                .withPositionStrategy(LookupPositionStrategy.ONLY_ABOVE)
                .build()
        })
    }

    @RequiresEdt
    private fun syncTooltip() {
        button.toolTipText = tooltip()
    }

    private fun syncAutoApprove() {
        auto.isSelected = autoApprove
        auto.icon = if (autoApprove) SHIELD_FILLED_ICON else SHIELD_ICON
        auto.toolTipText = if (autoApprove) {
            KiloBundle.message("prompt.action.autoApprove.enabled.tooltip")
        } else {
            KiloBundle.message("prompt.action.autoApprove.disabled.tooltip")
        }
        auto.accessibleContext.accessibleName = if (autoApprove) {
            KiloBundle.message("prompt.action.autoApprove.disable")
        } else {
            KiloBundle.message("prompt.action.autoApprove.enable")
        }
        auto.repaint()
    }

    private fun tooltip(): String {
        val id = if (busy) StopSessionAction.ID else SendPromptAction.ID
        val text = if (busy) {
            KiloBundle.message("prompt.button.stop")
        } else {
            KiloBundle.message("prompt.button.send")
        }
        val tip = KeymapUtil.createTooltipText(text, id)
        if (busy) return tip
        val stop = KeymapUtil.getFirstKeyboardShortcutText(StopSessionAction.ID)
        if (stop.isEmpty()) return tip
        return XmlStringUtil.wrapInHtml(
            XmlStringUtil.escapeString(tip) + "<br>" +
                XmlStringUtil.escapeString(KiloBundle.message("prompt.button.send.tooltip.stop", stop))
        )
    }

    private fun placeholder(): String {
        val send = KeymapUtil.getFirstKeyboardShortcutText(SendPromptAction.ID)
        val line = KeymapUtil.getFirstKeyboardShortcutText(IdeActions.ACTION_EDITOR_START_NEW_LINE)
        if (send.isNotEmpty() && line.isNotEmpty()) {
            return KiloBundle.message("prompt.placeholder.with.shortcuts", send, line)
        }
        if (send.isNotEmpty()) return KiloBundle.message("prompt.placeholder.with.send", send)
        if (line.isNotEmpty()) return KiloBundle.message("prompt.placeholder.with.newline", line)
        return KiloBundle.message("prompt.placeholder")
    }

    @RequiresEdt
    private fun syncEditorHeight() {
        val before = editor.preferredSize.height
        val lower = editor.minimumSize.height
        editor.setPreferredSize(null)
        editor.setMinimumSize(null)
        editor.getEditor(false)?.let {
            it.contentComponent.invalidate()
            it.component.invalidate()
            it.scrollPane.invalidate()
        }
        editor.invalidate()
        editor.ensureWillComputePreferredSize()
        val view = editor.getEditor(false)
        val line = view?.lineHeight ?: editor.getFontMetrics(editor.font).height
        val min = line * SessionUiStyle.View.Prompt.EDITOR_LINES + JBUI.scale(SessionUiStyle.View.Prompt.EDITOR_CHROME)
        val content = editor.preferredSize.height
        val sessionCap = rootCap(min)
        val height = minOf(content, sessionCap ?: content).coerceAtLeast(min)
        if (before == height && lower == height) {
            editor.preferredSize = JBDimension(0, height)
            editor.minimumSize = JBDimension(0, height)
            return
        }
        editor.preferredSize = JBDimension(0, height)
        editor.minimumSize = JBDimension(0, height)
        revalidate()
        repaint()
    }

    @RequiresEdt
    private fun rootCap(min: Int): Int? {
        val root = root ?: return null
        if (root.height <= 0) return null
        val chrome = (shell.preferredSize.height - editor.preferredSize.height).coerceAtLeast(0)
        return (root.height / 3 - chrome).coerceAtLeast(min)
    }

    @RequiresEdt
    private fun bindRoot() {
        val next = SwingUtilities.getAncestorOfClass(SessionRootPanel::class.java, this) as? SessionRootPanel
        if (root === next) return
        root?.removeComponentListener(resize)
        root = next
        root?.addComponentListener(resize)
        syncEditorHeight()
    }

    private inner abstract class PromptButton : JButton() {
        private var over = false

        init {
            iconButton(this)
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            addMouseListener(object : MouseAdapter() {
                override fun mouseEntered(e: MouseEvent) {
                    sync(true)
                }

                override fun mouseExited(e: MouseEvent) {
                    sync(false)
                }
            })
        }

        override fun getPreferredSize() = JBUI.size(
            SessionUiStyle.View.Prompt.SEND_BUTTON_SIZE,
            SessionUiStyle.View.Prompt.SEND_BUTTON_SIZE,
        )

        override fun getMinimumSize() = preferredSize

        override fun getMaximumSize() = preferredSize

        override fun paintComponent(g: Graphics) {
            if (over) paintHover(g)
            super.paintComponent(g)
        }

        private fun paintHover(g: Graphics) {
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                g2.color = JBUI.CurrentTheme.ActionButton.hoverBackground()
                val arc = JBUI.scale(JBUI.getInt("Button.arc", SessionUiStyle.View.Prompt.CORNER_ARC))
                g2.fillRoundRect(0, 0, width, height, arc, arc)
            } finally {
                g2.dispose()
            }
        }

        private fun sync(value: Boolean) {
            if (over == value) return
            over = value
            repaint()
        }
    }

    private inner class SendButton : PromptButton(), UiDataProvider {
        override fun uiDataSnapshot(sink: DataSink) {
            sink.set(PromptDataKeys.SEND, this@PromptPanel)
        }
    }

    private inner class AutoApproveButton : PromptButton()

}
