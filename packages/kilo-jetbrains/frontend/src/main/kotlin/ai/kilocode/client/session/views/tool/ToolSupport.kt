@file:Suppress("TooManyFunctions")

package ai.kilocode.client.session.views.tool

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.ToolKind
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.selection.SessionCopyTarget
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.editor.BashCommandHighlighter
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
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.xml.util.XmlStringUtil
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Font
import java.awt.Point
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
    private val open: SessionFileOpener? = null,
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
    fun openLink(anchor: RelativePoint? = null) {
        val value = href ?: return
        open?.invoke(value, anchor)
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
            (ed as? ToolField)?.syncHighlight()
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
        (ed as? ToolField)?.syncHighlight()
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
        // height/width are already scaled px (from editor lineHeight and font metrics),
        // so assign with plain Dimension. Wrapping in JBUI.size/JBDimension would scale
        // again by the user scale factor and double-scale under IDE zoom.
        val height = height(view)
        val width = width(view)
        view.preferredSize = Dimension(width, height)
        view.minimumSize = Dimension(0, height)
        view.maximumSize = Dimension(Int.MAX_VALUE, height)
        val inset = scroll.viewportBorder?.getBorderInsets(scroll) ?: JBUI.emptyInsets()
        val pane = height + scroll.insets.top + scroll.insets.bottom + inset.top + inset.bottom +
            scroll.horizontalScrollBar.preferredSize.height
        scroll.preferredSize = Dimension(0, pane)
        scroll.minimumSize = Dimension(0, pane)
        scroll.maximumSize = Dimension(Int.MAX_VALUE, pane)
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
                val field = ToolField(preview(tool), SessionEditorStyle.current(), tool.name == "bash").also { ed ->
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

private class ToolField(value: String, private var style: SessionEditorStyle, private val bash: Boolean) : EditorTextField(
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
            syncHighlight(ed)
        }
    }

    fun syncHighlight() {
        getEditor(false)?.let(::syncHighlight)
    }

    private fun syncHighlight(ed: com.intellij.openapi.editor.ex.EditorEx) {
        if (!bash) return
        BashCommandHighlighter.apply(ed, text)
    }

    override fun uiDataSnapshot(sink: DataSink) {
        super.uiDataSnapshot(sink)
        selection?.provideCopy(sink) { copyText() }
    }
}

@RequiresEdt
internal fun toolParts(
    tool: Tool,
    openFile: SessionFileOpener? = null,
    mode: ToolBodyMode = ToolBodyMode.TEXT,
): ToolParts {
    lateinit var parts: ToolParts
    val glyph = JBLabel()
    val title = clip(JBLabel())
    val sub = clip(JBLabel()).apply { foreground = UiStyle.Colors.weak() }
    val link = clip(JBLabel()).apply {
        isVisible = false
        isFocusable = false
        foreground = UiStyle.Colors.fg()
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        setRequestFocusEnabled(false)
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                parts.openLink(RelativePoint(this@apply, Point(width / 2, 0)))
            }
        })
    }
    val slot = Stack.fitHorizontal().apply {
        minimumSize = Dimension(0, minimumSize.height)
        next(sub)
        next(link)
    }
    val state = clip(JBLabel()).apply { foreground = UiStyle.Colors.weak() }
    val center = JPanel(BorderLayout(UiStyle.Gap.md(), 0)).apply {
        isOpaque = false
        minimumSize = Dimension(0, minimumSize.height)
    }
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
    val title = clip(JBLabel())
    val sub = clip(JBLabel()).apply { foreground = UiStyle.Colors.weak() }
    val targets = List(count) {
        clip(JBLabel()).apply {
            foreground = UiStyle.Colors.fg()
        }
    }
    val link = clip(JBLabel()).apply { isVisible = false }
    val slot = Stack.fitHorizontal().apply {
        minimumSize = Dimension(0, minimumSize.height)
        next(sub)
        next(link)
    }
    val state = clip(JBLabel()).apply { foreground = UiStyle.Colors.weak() }
    val stack = Stack.fitHorizontal(UiStyle.Gap.md()).apply { targets.forEach { next(it) } }
    val target = stack.align(HAlign.TRACK, VAlign.CENTER)
    val center = JPanel(BorderLayout(UiStyle.Gap.md(), 0)).apply {
        isOpaque = false
        minimumSize = Dimension(0, minimumSize.height)
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

internal fun title(tool: Tool) = when {
    tool.name == "read" -> KiloBundle.message("session.part.tool.read")
    tool.name == "bash" -> KiloBundle.message("session.part.tool.shell")
    tool.kind == ToolKind.WRITE -> KiloBundle.message("session.part.tool.edit")
    else -> toolTitle(tool)
}

internal fun subtitle(tool: Tool) = when (tool.name) {
    "read" -> readPath(tool)
    "bash" -> shellTitle(tool)
    else -> toolSubtitle(tool)
}

@RequiresEdt
internal fun setText(label: JBLabel, text: String): Boolean {
    val value = html(text)
    if (label.text == value) return false
    label.text = value
    return true
}

@RequiresEdt
internal fun setTargetText(label: JBLabel, text: String): Boolean {
    val value = single(text)
    if (label.text == value) return false
    label.text = value
    return true
}

@RequiresEdt
internal fun setLinkText(parts: ToolParts, text: String): Boolean {
    val label = single(text)
    val value = if (label.isBlank()) "" else XmlStringUtil.wrapInHtml("<nobr><u>${XmlStringUtil.escapeString(label)}</u></nobr>")
    if (parts.label == label && parts.link.text == value) return false
    parts.label = label
    parts.link.text = value
    return true
}

/**
 * Shows [path] as a clickable file link in the header slot, or clears the link when [path] is null.
 * Shared by [ai.kilocode.client.session.views.tool.ReadToolView] and
 * [ai.kilocode.client.session.views.tool.EditToolView] so both render file targets identically.
 */
@RequiresEdt
internal fun setFileTarget(parts: ToolParts, path: String?, label: String): Boolean {
    if (path == null) {
        var changed = false
        if (parts.href != null) {
            parts.href = null
            changed = true
        }
        return show(parts, false) || changed
    }
    var changed = false
    if (parts.href != path) {
        parts.href = path
        changed = true
    }
    changed = setLinkText(parts, label.ifBlank { path }) || changed
    return show(parts, true) || changed
}

private fun clip(label: JBLabel): JBLabel = label.apply {
    minimumSize = Dimension(0, minimumSize.height)
}

private fun html(text: String): String {
    val value = single(text)
    if (value.isBlank()) return ""
    return XmlStringUtil.wrapInHtml("<nobr>${XmlStringUtil.escapeString(value)}</nobr>")
}

private fun single(text: String): String = text.lineSequence()
    .map { it.trim() }
    .filter { it.isNotEmpty() }
    .joinToString(" ")

@RequiresEdt
internal fun show(parts: ToolParts, link: Boolean): Boolean {
    var changed = false
    changed = setVisible(parts.link, link) || changed
    changed = setVisible(parts.sub, !link) || changed
    return changed
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

/** File path targeted by a write tool, preferring the most specific resolvable path. */
internal fun editPath(tool: Tool): String = editPaths(tool).maxWithOrNull(
    compareBy<String>({ OSAgnosticPathUtil.isAbsolute(it) }, { depth(it) }),
) ?: tool.name

private fun editPaths(tool: Tool): List<String> {
    val direct = listOf(tool.input["filePath"], tool.input["path"])
    val diff = listOfNotNull(editFile(parseJsonObject(tool.metadata["filediff"])))
    val files = parseJsonArray(tool.metadata["files"])?.mapNotNull { editFile(it.jsonObject) } ?: emptyList()
    return (direct + diff + files + listOf(tool.title, tool.name))
        .mapNotNull { it?.takeIf { value -> value.isNotBlank() } }
}

private fun editFile(obj: JsonObject?): String? = listOf("filePath", "path", "file", "relativePath")
    .firstNotNullOfOrNull { key -> obj?.get(key)?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } }

private fun depth(path: String): Int = path.count { it == '/' || it == '\\' }

private val DIFF_JSON = Json { ignoreUnknownKeys = true; isLenient = true }

private fun parseJsonObject(raw: String?): JsonObject? =
    raw?.takeIf { it.isNotBlank() }?.let { runCatching { DIFF_JSON.parseToJsonElement(it).jsonObject }.getOrNull() }

private fun parseJsonArray(raw: String?): JsonArray? =
    raw?.takeIf { it.isNotBlank() }?.let { runCatching { DIFF_JSON.parseToJsonElement(it) as? JsonArray }.getOrNull() }

private fun patchOf(obj: JsonObject?): String? =
    obj?.get("patch")?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }

/**
 * Unified diff patch produced by a write tool, or empty when none is available. Kilo strips the raw
 * `diff` field from stored parts (see stripPartMetadata) but keeps `filediff.patch` (edit/write) and
 * per-file `files[].patch` (apply_patch) when under the size cap, so read those first.
 */
internal fun editDiff(tool: Tool): String {
    tool.metadata["diff"]?.takeIf { it.isNotBlank() }?.let { return it }
    patchOf(parseJsonObject(tool.metadata["filediff"]))?.let { return it }
    parseJsonArray(tool.metadata["files"])?.let { files ->
        val joined = files.mapNotNull { patchOf(it.jsonObject) }.joinToString("\n")
        if (joined.isNotBlank()) return joined
    }
    return ""
}

/** One file touched by an apply_patch call, parsed from the tool's `files[]` metadata. */
internal data class EditFileChange(
    val path: String,
    val type: String,
    val additions: Int,
    val deletions: Int,
    val patch: String,
)

/** Per-file changes from an apply_patch tool; empty for single-file edit/write tools (`filediff`). */
internal fun editFiles(tool: Tool): List<EditFileChange> =
    parseJsonArray(tool.metadata["files"])?.mapNotNull { element ->
        val obj = element.jsonObject
        val path = editFile(obj) ?: return@mapNotNull null
        EditFileChange(
            path = path,
            type = obj["type"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            additions = obj["additions"]?.jsonPrimitive?.intOrNull ?: 0,
            deletions = obj["deletions"]?.jsonPrimitive?.intOrNull ?: 0,
            patch = patchOf(obj).orEmpty(),
        )
    } ?: emptyList()

/**
 * Sectioned markdown for a multi-file patch: each file gets a labeled header line (path plus its own
 * add/remove counts) followed by its own fenced diff, so the joined apply_patch diff no longer runs
 * together into one indistinguishable block. The path is wrapped in inline code so characters like
 * underscores are not parsed as markdown emphasis.
 */
internal fun multiFileDiffMarkdown(files: List<EditFileChange>): String =
    files.filter { it.patch.isNotBlank() }.joinToString("\n\n") { file ->
        buildString {
            append('`').append(tail(file.path)).append('`')
            append(" +").append(file.additions).append(" -").append(file.deletions)
            append("\n\n")
            append(patchMarkdown(file.patch))
        }
    }

/** Added/removed line counts, preferring the counts computed by the CLI, else counting patch lines. */
internal fun diffStat(tool: Tool): Pair<Int, Int> {
    parseJsonObject(tool.metadata["filediff"])?.let { fd ->
        val add = fd["additions"]?.jsonPrimitive?.intOrNull
        val del = fd["deletions"]?.jsonPrimitive?.intOrNull
        if (add != null || del != null) return (add ?: 0) to (del ?: 0)
    }
    parseJsonArray(tool.metadata["files"])?.let { files ->
        var add = 0
        var del = 0
        var found = false
        files.forEach {
            it.jsonObject["additions"]?.jsonPrimitive?.intOrNull?.let { v -> add += v; found = true }
            it.jsonObject["deletions"]?.jsonPrimitive?.intOrNull?.let { v -> del += v; found = true }
        }
        if (found) return add to del
    }
    val patch = editDiff(tool)
    if (patch.isBlank()) return 0 to 0
    var added = 0
    var removed = 0
    for (line in patch.lineSequence()) {
        when {
            line.startsWith("+++") || line.startsWith("---") -> Unit
            line.startsWith("+") -> added++
            line.startsWith("-") -> removed++
        }
    }
    return added to removed
}

/** Display-only diff body without VCS/file metadata headers (Index, diff --git, ---, +++, etc.). */
internal fun pureDiff(diff: String): String = diff.lineSequence()
    .filterNot(::diffMeta)
    .joinToString("\n")
    .trim('\n')

private fun diffMeta(line: String): Boolean = line.startsWith("Index:") ||
    line.startsWith("====") ||
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("old mode ") ||
    line.startsWith("new mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("dissimilarity index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("copy from ") ||
    line.startsWith("copy to ")

/** Wraps a unified patch in a fenced `patch` block so the markdown code editor highlights it. */
internal fun patchMarkdown(diff: String): String = buildString {
    val body = pureDiff(diff).ifBlank { diff.trim('\n') }
    val fence = fence(body)
    append(fence).append("patch-pure\n")
    append(body)
    if (!body.endsWith('\n')) append('\n')
    append(fence)
}

internal fun fence(text: String): String {
    val size = Regex("`+").findAll(text).maxOfOrNull { it.value.length } ?: 0
    return "`".repeat(maxOf(3, size + 1))
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
