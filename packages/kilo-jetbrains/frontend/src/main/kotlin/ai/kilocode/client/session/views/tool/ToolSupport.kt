@file:Suppress("TooManyFunctions")

package ai.kilocode.client.session.views.tool

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.selection.SessionCopyTarget
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.cli.KiloCliParser
import ai.kilocode.log.KiloLog
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.Disposable
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.util.io.OSAgnosticPathUtil
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBDimension
import com.intellij.util.ui.JBUI
import com.intellij.xml.util.XmlStringUtil
import java.awt.BorderLayout
import java.awt.CardLayout
import java.awt.Color
import java.awt.Cursor
import java.awt.Font
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

private val LOG = KiloLog.create(ToolParts::class.java)

enum class ToolBodyMode { EDITOR, TEXT }

class ToolParts(
    val header: JPanel,
    val glyph: JBLabel,
    val title: JBLabel,
    val sub: JBLabel,
    val link: JBLabel,
    val slot: JPanel,
    val state: JBLabel,
    val center: JPanel,
    val controls: JComponent,
    private val open: ((String) -> Unit)? = null,
    val extra: JBLabel? = null,
    val targets: List<JBLabel> = emptyList(),
    private val mode: ToolBodyMode = ToolBodyMode.EDITOR,
) {
    var href: String? = null
    var label: String = ""
    private var body: ToolBody? = null

    val text: JBTextArea?
        @RequiresEdt
        get() = body?.area

    val content: ToolBody?
        @RequiresEdt
        get() = body

    val scroll: JBScrollPane?
        @RequiresEdt
        get() = body?.scroll

    @RequiresEdt
    fun scroll(tool: Tool): JBScrollPane = body(tool).scroll

    @RequiresEdt
    fun bodyCreated() = body != null

    @RequiresEdt
    fun openLink() {
        val value = href ?: return
        open?.invoke(value)
    }

    @RequiresEdt
    private fun body(tool: Tool): ToolBody {
        val item = body
        if (item != null) return item
        val body = when (mode) {
            ToolBodyMode.EDITOR -> ToolBody.editor(tool)
            ToolBodyMode.TEXT -> ToolBody.text(tool)
        }
        return body.also { this.body = it }
    }
}

class ToolBody private constructor(
    val area: JBTextArea?,
    val ed: EditorTextField?,
    val scroll: JBScrollPane,
    private val disposable: Disposable?,
) : Disposable {
    var text: String
        @RequiresEdt
        get() = area?.text ?: ed?.text ?: ""
        @RequiresEdt
        set(value) {
            if (text == value) return
            area?.text = value
            ed?.text = value
            caretStart()
            size()
        }

    var font: Font
        @RequiresEdt
        get() = area?.font ?: ed?.font ?: SessionEditorStyle.current().editorFont
        @RequiresEdt
        set(value) {
            area?.font = value
            ed?.font = value
            size()
        }

    var foreground: Color
        @RequiresEdt
        get() = area?.foreground ?: ed?.foreground ?: UiStyle.Colors.fg()
        @RequiresEdt
        set(value) {
            area?.foreground = value
            ed?.foreground = value
        }

    val editable: Boolean get() = area?.isEditable ?: false
    val caretVisible: Boolean get() = area?.caret?.isVisible ?: false
    val lineWrap: Boolean get() = area?.lineWrap ?: false
    val editor: EditorTextField? get() = ed

    @RequiresEdt
    fun caretStart() {
        area?.caretPosition = 0
        ed?.getEditor(false)?.caretModel?.moveToOffset(0)
    }

    @RequiresEdt
    fun applyStyle(style: SessionEditorStyle): Boolean {
        val before = font
        area?.font = style.transcriptFont
        ed?.font = style.editorFont
        ed?.getEditor(false)?.let(style::applyToEditor)
        size()
        return before != font
    }

    @RequiresEdt
    fun register(selection: SessionSelection, parent: Disposable) {
        val field = ed
        if (field != null) {
            (field as? ToolField)?.selection = selection
            selection.register(field, parent)
            return
        }
        area?.let {
            (it as? ToolArea)?.selection = selection
            selection.register(it, parent)
        }
    }

    @RequiresEdt
    fun lineHeight(): Int = ed?.getEditor(false)?.lineHeight ?: scroll.viewport.view.getFontMetrics(font).height

    override fun dispose() {
        disposable?.let(Disposer::dispose)
    }

    private fun size() {
        val view = scroll.viewport.view as? JComponent ?: return
        val height = height(view)
        val width = width(view)
        view.preferredSize = JBUI.size(width, height)
        view.minimumSize = JBUI.size(0, height)
        view.maximumSize = JBDimension(Int.MAX_VALUE, height)
        val inset = scroll.viewportBorder?.getBorderInsets(scroll) ?: JBUI.emptyInsets()
        val pane = height + scroll.insets.top + scroll.insets.bottom + inset.top + inset.bottom +
            scroll.horizontalScrollBar.preferredSize.height
        scroll.preferredSize = JBUI.size(0, pane)
        scroll.minimumSize = JBUI.size(0, pane)
        scroll.maximumSize = JBDimension(Int.MAX_VALUE, pane)
    }

    private fun width(view: JComponent): Int {
        val metrics = view.getFontMetrics(font)
        return (text.lineSequence().maxOfOrNull { metrics.stringWidth(it) } ?: 0) +
            JBUI.scale(SessionUiStyle.View.Code.WIDTH_PADDING)
    }

    private fun height(view: JComponent): Int {
        ed?.ensureWillComputePreferredSize()
        val rows = text.lineSequence().count().coerceAtLeast(SessionUiStyle.View.Code.MIN_ROWS)
        return maxOf(view.preferredSize.height, lineHeight() * rows)
    }

    companion object {
        @RequiresEdt
        fun editor(tool: Tool): ToolBody {
            val disposable = Disposer.newDisposable("Tool body")
            val body = runCatching {
                val field = ToolField(preview(tool), SessionEditorStyle.current()).also { ed ->
                    Disposer.register(disposable) {
                        ed.getEditor(false)?.let(EditorFactory.getInstance()::releaseEditor)
                    }
                    ed.setDisposedWith(disposable)
                }
                ToolBody(null, field, pane(field, true), disposable)
            }.getOrElse { err ->
                LOG.warn("kind=tool codeEditor=true failed message=${err.message}", err)
                val area = area(tool, false)
                ToolBody(area, null, pane(area, true), disposable)
            }
            body.size()
            return body
        }

        @RequiresEdt
        fun text(tool: Tool): ToolBody {
            val area = area(tool, true)
            val body = ToolBody(area, null, pane(area, false), null)
            body.size()
            return body
        }

        private fun area(tool: Tool, wrap: Boolean) = ToolArea().apply {
            isEditable = false
            caret.isVisible = false
            caret.isSelectionVisible = true
            lineWrap = wrap
            wrapStyleWord = wrap
            foreground = if (tool.state == ToolExecState.ERROR) UiStyle.Colors.errorLabelForeground() else UiStyle.Colors.fg()
            background = SessionUiStyle.View.Surface.bgColor()
            border = JBUI.Borders.empty(
                JBUI.scale(SessionUiStyle.View.Layout.VERTICAL_PADDING),
                JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING),
            )
        }

        private fun pane(view: JComponent, scrolls: Boolean) = JBScrollPane(view).apply {
            border = JBUI.Borders.customLine(
                SessionUiStyle.View.Outline.color(),
                SessionUiStyle.View.Outline.width(),
                0,
                0,
                0,
            )
            viewportBorder = JBUI.Borders.empty(
                JBUI.scale(SessionUiStyle.View.Layout.VERTICAL_PADDING),
                JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING),
            ).takeIf { scrolls }
            isOpaque = true
            background = SessionUiStyle.View.Surface.bgColor()
            viewport.background = SessionUiStyle.View.Surface.bgColor()
            horizontalScrollBarPolicy = if (scrolls) {
                ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED
            } else {
                ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            }
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        }
    }
}

private class ToolArea : JBTextArea(), UiDataProvider, SessionCopyTarget {
    var selection: SessionSelection? = null
    override val copyAnchor: JComponent get() = this

    override fun copyText() = text

    override fun uiDataSnapshot(sink: DataSink) {
        selection?.provideCopy(sink) { copyText() }
    }
}

private class ToolField(value: String, private var style: SessionEditorStyle) : EditorTextField(
    EditorFactory.getInstance().createDocument(value.trimEnd('\n')),
    ProjectManager.getInstance().defaultProject,
    PlainTextFileType.INSTANCE,
    true,
    false,
), SessionCopyTarget {
    var selection: SessionSelection? = null
    override val copyAnchor: JComponent get() = this

    override fun copyText() = text

    init {
        setFontInheritedFromLAF(false)
        font = style.editorFont
        addSettingsProvider { ed ->
            style.applyToEditor(ed)
            ed.setBorder(JBUI.Borders.empty())
            ed.scrollPane.border = JBUI.Borders.empty()
            ed.scrollPane.viewportBorder = JBUI.Borders.empty()
            ed.backgroundColor = SessionUiStyle.View.Surface.bgColor()
            ed.scrollPane.background = SessionUiStyle.View.Surface.bgColor()
            ed.scrollPane.viewport.background = SessionUiStyle.View.Surface.bgColor()
            ed.settings.isUseSoftWraps = false
            ed.settings.isAdditionalPageAtBottom = false
            ed.scrollPane.horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            ed.scrollPane.verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER
        }
    }

    override fun uiDataSnapshot(sink: DataSink) {
        super.uiDataSnapshot(sink)
        selection?.provideCopy(sink) { copyText() }
    }
}

private const val SUB_CARD = "sub"
private const val LINK_CARD = "link"

@RequiresEdt
internal fun toolParts(
    tool: Tool,
    openFile: ((String) -> Unit)? = null,
    mode: ToolBodyMode = ToolBodyMode.TEXT,
): ToolParts {
    lateinit var parts: ToolParts
    val glyph = JBLabel()
    val title = JBLabel()
    val sub = JBLabel().apply { foreground = UiStyle.Colors.weak() }
    val link = JBLabel().apply {
        isVisible = false
        isFocusable = false
        foreground = UiStyle.Colors.fg()
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        setRequestFocusEnabled(false)
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                parts.openLink()
            }
        })
    }
    val slot = JPanel(CardLayout()).apply {
        isOpaque = false
        add(sub, SUB_CARD)
        add(link, LINK_CARD)
    }
    val state = JBLabel().apply { foreground = UiStyle.Colors.weak() }
    val center = JPanel(BorderLayout(UiStyle.Gap.md(), 0)).apply { isOpaque = false }
    val controls = Stack.horizontal()
    val header = JPanel(BorderLayout(JBUI.scale(SessionUiStyle.View.Layout.GAP), 0)).apply {
        isOpaque = false
        center.add(title, BorderLayout.WEST)
        center.add(slot, BorderLayout.CENTER)
        add(glyph, BorderLayout.WEST)
        add(center, BorderLayout.CENTER)
        add(controls, BorderLayout.EAST)
    }
    parts = ToolParts(header, glyph, title, sub, link, slot, state, center, controls, openFile, mode = mode)
    return parts.also {
        controls.add(it.state)
    }
}

@RequiresEdt
internal fun searchParts(count: Int): ToolParts {
    val glyph = JBLabel()
    val title = JBLabel()
    val sub = JBLabel().apply { foreground = UiStyle.Colors.weak() }
    val targets = List(count) {
        JBLabel().apply {
            foreground = UiStyle.Colors.fg()
            minimumSize = JBUI.size(0, minimumSize.height)
        }
    }
    val link = JBLabel().apply { isVisible = false }
    val slot = JPanel(CardLayout()).apply {
        isOpaque = false
        add(sub, SUB_CARD)
        add(link, LINK_CARD)
    }
    val state = JBLabel().apply { foreground = UiStyle.Colors.weak() }
    val stack = Stack.fitHorizontal(UiStyle.Gap.md()).apply { targets.forEach { next(it) } }
    val target = stack.align(HAlign.TRACK, VAlign.CENTER)
    val center = JPanel(BorderLayout(UiStyle.Gap.md(), 0)).apply {
        isOpaque = false
        minimumSize = JBUI.size(0, minimumSize.height)
        add(title, BorderLayout.WEST)
        add(target, BorderLayout.CENTER)
    }
    val controls = Stack.horizontal()
    val header = JPanel(BorderLayout(JBUI.scale(SessionUiStyle.View.Layout.GAP), 0)).apply {
        isOpaque = false
        add(glyph, BorderLayout.WEST)
        add(center, BorderLayout.CENTER)
        add(controls, BorderLayout.EAST)
    }
    return ToolParts(header, glyph, title, sub, link, slot, state, center, controls, targets = targets, mode = ToolBodyMode.EDITOR).also {
        controls.add(it.state)
    }
}

internal fun icon(tool: Tool) = when (tool.name) {
    "read" -> SessionViewIcons.glasses
    "list" -> SessionViewIcons.bulletList
    "glob", "grep" -> SessionViewIcons.search
    "webfetch", "websearch" -> SessionViewIcons.windowCursor
    "codesearch" -> SessionViewIcons.code
    "task" -> SessionViewIcons.task
    "bash" -> SessionViewIcons.console
    "edit", "write", "apply_patch" -> SessionViewIcons.codeLines
    "todowrite", "todoread" -> SessionViewIcons.checklist
    "question" -> SessionViewIcons.bubble
    "skill" -> SessionViewIcons.brain
    else -> SessionViewIcons.mcp
}

internal fun title(tool: Tool) = when (tool.name) {
    "read" -> KiloBundle.message("session.part.tool.read")
    "bash" -> KiloBundle.message("session.part.tool.shell")
    else -> toolTitle(tool)
}

internal fun subtitle(tool: Tool) = when (tool.name) {
    "read" -> readPath(tool)
    "bash" -> shellTitle(tool)
    else -> toolSubtitle(tool)
}

@RequiresEdt
internal fun setText(label: JBLabel, text: String): Boolean {
    val value = if (text.isBlank()) "" else XmlStringUtil.wrapInHtml(XmlStringUtil.escapeString(text))
    if (label.text == value) return false
    label.text = value
    return true
}

@RequiresEdt
internal fun setTargetText(label: JBLabel, text: String): Boolean {
    if (label.text == text) return false
    label.text = text
    return true
}

@RequiresEdt
internal fun setLinkText(parts: ToolParts, text: String): Boolean {
    val value = if (text.isBlank()) "" else XmlStringUtil.wrapInHtml("<u>${XmlStringUtil.escapeString(text)}</u>")
    if (parts.label == text && parts.link.text == value) return false
    parts.label = text
    parts.link.text = value
    return true
}

@RequiresEdt
internal fun show(parts: ToolParts, link: Boolean): Boolean {
    if (parts.link.isVisible == link && parts.sub.isVisible != link) return false
    (parts.slot.layout as CardLayout).show(parts.slot, if (link) LINK_CARD else SUB_CARD)
    return true
}

internal fun subtitleText(parts: ToolParts): String = if (parts.link.isVisible) parts.label else parts.sub.text

@RequiresEdt
internal fun setIcon(label: JBLabel, icon: Icon): Boolean {
    if (label.icon === icon) return false
    label.icon = icon
    return true
}

@RequiresEdt
internal fun setVisible(component: JComponent, visible: Boolean): Boolean {
    if (component.isVisible == visible) return false
    component.isVisible = visible
    return true
}

@RequiresEdt
internal fun setForeground(component: JComponent, color: Color): Boolean {
    if (same(component.foreground, color)) return false
    component.foreground = color
    return true
}

@RequiresEdt
internal fun setFont(component: JComponent, font: Font): Boolean {
    if (component.font == font) return false
    component.font = font
    return true
}

private fun same(a: Color?, b: Color): Boolean = a?.rgb == b.rgb

internal fun color(tool: Tool) = when (tool.state) {
    ToolExecState.PENDING -> SessionUiStyle.View.Tool.pending()
    ToolExecState.RUNNING -> SessionUiStyle.View.Tool.running()
    ToolExecState.COMPLETED -> SessionUiStyle.View.Tool.completed()
    ToolExecState.ERROR -> SessionUiStyle.View.Tool.error()
}

internal fun titleColor(tool: Tool) = if (tool.state == ToolExecState.ERROR) {
    UiStyle.Colors.errorLabelForeground()
} else {
    UiStyle.Colors.fg()
}

internal fun stateText(tool: Tool) = when (tool.state) {
    ToolExecState.PENDING -> KiloBundle.message("session.part.tool.pending")
    ToolExecState.RUNNING -> KiloBundle.message("session.part.tool.running")
    ToolExecState.COMPLETED -> ""
    ToolExecState.ERROR -> KiloBundle.message("session.part.tool.error")
}

private fun readPath(tool: Tool): String {
    val target = target(tool)
    if (target != null) {
        if (target.type == "file") return tail(target.path).ifBlank { target.path }
        return target.path
    }
    val path = tool.input["filePath"] ?: tool.input["path"] ?: tool.title ?: return tool.name
    return tail(path).ifBlank { path }
}

internal fun searchPath(path: String, repo: String?): String {
    val text = path.takeIf { it.isNotBlank() } ?: return ""
    val root = repo?.takeIf { it.isNotBlank() }?.let(::norm)
    if (root == null) return text.takeUnless { it == "." } ?: ""
    val full = if (OSAgnosticPathUtil.isAbsolute(text)) norm(text) else norm(FileUtil.join(root, text))
    if (full == root) return ""
    if (!OSAgnosticPathUtil.startsWith(full, root)) return full
    return FileUtil.getRelativePath(root, full, '/') ?: full
}

private fun norm(path: String): String = FileUtil.toCanonicalPath(FileUtil.toSystemIndependentName(path), '/', true)

internal fun globDirectory(tool: Tool, repo: String?): String =
    searchPath(
        tool.input["path"]?.takeIf { it.isNotBlank() }
            ?: tool.title?.takeIf { it.isNotBlank() }
            ?: "",
        repo,
    )

internal fun globPattern(tool: Tool): String =
    tool.input["pattern"]?.takeIf { it.isNotBlank() }?.let { "pattern=$it" } ?: ""

internal fun searchTargets(tool: Tool, repo: String?): List<String> = listOfNotNull(
    tool.input["path"]?.takeIf { it.isNotBlank() }?.let { searchPath(it, repo) }?.takeIf { it.isNotBlank() },
    tool.input["pattern"]?.takeIf { it.isNotBlank() }?.let { "pattern=$it" },
    tool.input["include"]?.takeIf { it.isNotBlank() }?.let { "include=$it" },
)

internal data class Target(
    val path: String,
    val type: String,
)

internal fun target(tool: Tool): Target? {
    val out = output(tool)
    if (out.isBlank()) return null
    val path = KiloCliParser.tag(out, "path") ?: return null
    val type = KiloCliParser.tag(out, "type") ?: return null
    return Target(path, type.lowercase())
}

private fun shellTitle(tool: Tool): String =
    tool.input["description"]?.takeIf { it.isNotBlank() }
        ?: tool.metadata["description"]?.takeIf { it.isNotBlank() }
        ?: tool.title?.takeIf { it.isNotBlank() }
        ?: command(tool).lineSequence().firstOrNull { it.isNotBlank() }
        ?: ""

internal fun command(tool: Tool): String =
    tool.input["command"]?.takeIf { it.isNotBlank() }
        ?: tool.metadata["command"]?.takeIf { it.isNotBlank() }
        ?: ""

internal fun output(tool: Tool): String =
    tool.output?.takeIf { it.isNotBlank() }
        ?: tool.metadata["output"]?.takeIf { it.isNotBlank() }
        ?: ""

internal fun preview(tool: Tool): String = if (tool.name == "bash") shellPreview(tool) else plainPreview(tool)

internal fun body(tool: Tool): String = if (tool.name == "bash") shellBody(tool) else plainBody(tool)

private fun shellPreview(tool: Tool): String {
    val cmd = command(tool)
    val out = output(tool)
    val err = tool.error?.takeIf { it.isNotBlank() }
    return Preview().apply {
        if (cmd.isNotBlank()) append("$ ").append(cmd)
        if (out.isNotBlank()) {
            sep()
            append(out)
        }
        if (err != null) {
            sep()
            append(err)
        }
    }.build()
}

private fun shellBody(tool: Tool): String {
    val cmd = command(tool)
    val out = output(tool)
    val err = tool.error?.takeIf { it.isNotBlank() }
    return buildString {
        if (cmd.isNotBlank()) append("$ ").append(cmd)
        if (out.isNotBlank()) {
            if (isNotEmpty()) append("\n\n")
            append(out)
        }
        if (err != null) {
            if (isNotEmpty()) append("\n\n")
            append(err)
        }
    }
}

private fun plainPreview(tool: Tool): String {
    val out = output(tool)
    val err = tool.error?.takeIf { it.isNotBlank() }
    return Preview().apply {
        if (out.isNotBlank()) append(out)
        if (err != null) {
            sep()
            append(err)
        }
    }.build()
}

internal fun plainBody(tool: Tool): String {
    val out = output(tool)
    val err = tool.error?.takeIf { it.isNotBlank() }
    return listOf(out, err).filter { !it.isNullOrBlank() }.joinToString("\n\n")
}

internal fun canExpand(tool: Tool): Boolean {
    if (tool.name == "bash") return command(tool).isNotBlank() || output(tool).isNotBlank() || !tool.error.isNullOrBlank()
    return output(tool).isNotBlank() || !tool.error.isNullOrBlank()
}

private fun toolTitle(tool: Tool): String =
    tool.title?.takeIf { it.isNotBlank() }
        ?: tool.name.replace('_', ' ').replaceFirstChar { it.titlecase() }

private fun toolSubtitle(tool: Tool): String {
    val base = listOf("description", "query", "url", "filePath", "path", "name")
        .mapNotNull { tool.input[it]?.takeIf { value -> value.isNotBlank() } }
        .firstOrNull()
    val args = listOf("pattern", "include", "offset", "limit")
        .mapNotNull { key -> tool.input[key]?.takeIf { it.isNotBlank() }?.let { "$key=$it" } }
    return listOfNotNull(base).plus(args).joinToString(" ")
}

internal fun tail(path: String): String {
    val value = path.trimEnd('/', '\\')
    val index = maxOf(value.lastIndexOf('/'), value.lastIndexOf('\\'))
    if (index < 0) return value
    return value.substring(index + 1)
}

private class Preview {
    private val text = StringBuilder()
    private var cut = false

    fun append(value: String): Preview {
        if (cut) return this
        val rem = SessionUiStyle.View.Tool.PREVIEW_LIMIT - text.length
        if (value.length <= rem) {
            text.append(value)
            return this
        }
        if (rem > 0) text.append(value, 0, rem)
        cut = true
        return this
    }

    fun sep(): Preview {
        if (text.isNotEmpty()) append("\n\n")
        return this
    }

    fun build(): String {
        if (!cut) return text.toString()
        if (text.isNotEmpty()) text.append("\n\n")
        text.append(KiloBundle.message("session.part.tool.truncated"))
        return text.toString()
    }
}
