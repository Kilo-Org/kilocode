package ai.kilocode.client.ui.md

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.log.KiloLog
import com.intellij.openapi.Disposable
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.fileTypes.FileTypeRegistry
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.fileTypes.UnknownFileType
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.components.JBHtmlPane
import com.intellij.ui.components.JBHtmlPaneConfiguration
import com.intellij.ui.components.JBHtmlPaneStyleConfiguration
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import org.commonmark.ext.autolink.AutolinkExtension
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.node.AbstractVisitor
import org.commonmark.node.Block
import org.commonmark.node.Document
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Node
import org.commonmark.node.ThematicBreak
import org.commonmark.parser.Parser
import org.commonmark.renderer.html.HtmlRenderer
import java.awt.Color
import java.awt.Dimension
import java.awt.Font
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.event.HyperlinkEvent
import javax.swing.text.html.StyleSheet

@Suppress("UnstableApiUsage")
internal class MdViewHybrid(
    style: SessionEditorStyle = SessionEditorStyle.current(),
    private var selection: SessionSelection? = null,
) : MdView {
    companion object {
        private val LOG = KiloLog.create(MdViewHybrid::class.java)

        private val FILES = mapOf(
            "kt" to "kt",
            "kotlin" to "kt",
            "js" to "js",
            "javascript" to "js",
            "jsx" to "jsx",
            "ts" to "ts",
            "typescript" to "ts",
            "tsx" to "tsx",
            "java" to "java",
            "py" to "py",
            "python" to "py",
            "sh" to "sh",
            "bash" to "sh",
            "shell" to "sh",
            "json" to "json",
            "xml" to "xml",
            "html" to "html",
            "css" to "css",
            "md" to "md",
            "markdown" to "md",
            "yaml" to "yaml",
            "yml" to "yaml",
            "toml" to "toml",
            "go" to "go",
            "golang" to "go",
            "rs" to "rs",
            "rust" to "rs",
            "rb" to "rb",
            "ruby" to "rb",
            "php" to "php",
            "swift" to "swift",
            "scala" to "scala",
            "sql" to "sql",
            "dockerfile" to "dockerfile",
            "docker" to "dockerfile",
            "gradle" to "gradle",
            "kts" to "kts",
            "c" to "c",
            "h" to "h",
            "cpp" to "cpp",
            "c++" to "cpp",
            "cc" to "cc",
            "cxx" to "cxx",
            "hpp" to "hpp",
            "h++" to "hpp",
            "cs" to "cs",
            "csharp" to "cs",
            "c#" to "cs",
            "fs" to "fs",
            "fsharp" to "fs",
            "f#" to "fs",
            "ps1" to "ps1",
            "powershell" to "ps1",
            "pwsh" to "ps1",
            "bat" to "bat",
            "batch" to "bat",
            "cmd" to "bat",
            "makefile" to "makefile",
            "make" to "makefile",
            "terraform" to "tf",
            "tf" to "tf",
            "hcl" to "hcl",
            "vue" to "vue",
            "svelte" to "svelte",
            "graphql" to "graphql",
            "proto" to "proto",
            "ini" to "ini",
            "properties" to "properties",
            "diff" to "diff",
            "patch" to "patch",
        )
    }

    private val listeners = mutableListOf<MdView.LinkListener>()
    private val source = StringBuilder()
    private var style = style
    private var rendered = ""
    private var disposed = false
    private val blocks = mutableListOf<View>()
    private var openFence: Fence? = null
    private var stale = false

    private val extensions = listOf(
        AutolinkExtension.create(),
        TablesExtension.create(),
        StrikethroughExtension.create(),
    )

    private val parser: Parser = Parser.builder().extensions(extensions).build()

    private val renderer: HtmlRenderer = HtmlRenderer.builder()
        .extensions(extensions)
        .escapeHtml(true)
        .sanitizeUrls(true)
        .build()

    private var fontOverride: Font? = null
    private var foregroundOverride: Color? = null
    private var backgroundOverride: Color? = null
    private var linkColorOverride: Color? = null
    private var codeBgOverride: Color? = null
    private var preBgOverride: Color? = null
    private var preFgOverride: Color? = null
    private var codeFontOverride: String? = null
    private var quoteBorderOverride: Color? = null
    private var quoteFgOverride: Color? = null
    private var tableBorderOverride: Color? = null
    private var opaqueState = true

    private val root = JPanel().apply {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        isOpaque = true
        background = opts().background
    }

    override val component: JComponent get() = root

    override var font: Font
        get() = fontOverride ?: opts().font
        set(value) {
            if (disposed) return
            if (fontOverride == value) return
            fontOverride = value
            syncStyle()
        }

    override var foreground: Color
        get() = foregroundOverride ?: opts().foreground
        set(value) {
            if (disposed) return
            if (foregroundOverride == value) return
            foregroundOverride = value
            syncStyle()
        }

    override var background: Color
        get() = backgroundOverride ?: opts().background
        set(value) {
            if (disposed) return
            if (backgroundOverride == value) return
            backgroundOverride = value
            syncStyle()
        }

    override var linkColor: Color
        get() = linkColorOverride ?: opts().linkColor
        set(value) {
            if (disposed) return
            if (linkColorOverride == value) return
            linkColorOverride = value
            syncStyle()
        }

    override var codeBg: Color
        get() = codeBgOverride ?: opts().codeBg
        set(value) {
            if (disposed) return
            if (codeBgOverride == value) return
            codeBgOverride = value
            syncStyle()
        }

    override var preBg: Color
        get() = preBgOverride ?: opts().preBg
        set(value) {
            if (disposed) return
            if (preBgOverride == value) return
            preBgOverride = value
            syncStyle()
        }

    override var preFg: Color
        get() = preFgOverride ?: opts().preFg
        set(value) {
            if (disposed) return
            if (preFgOverride == value) return
            preFgOverride = value
            syncStyle()
        }

    override var codeFont: String
        get() = codeFontOverride ?: opts().codeFont
        set(value) {
            if (disposed) return
            if (codeFontOverride == value) return
            codeFontOverride = value
            syncStyle()
        }

    override var quoteBorder: Color
        get() = quoteBorderOverride ?: opts().quoteBorder
        set(value) {
            if (disposed) return
            if (quoteBorderOverride == value) return
            quoteBorderOverride = value
            syncStyle()
        }

    override var quoteFg: Color
        get() = quoteFgOverride ?: opts().quoteFg
        set(value) {
            if (disposed) return
            if (quoteFgOverride == value) return
            quoteFgOverride = value
            syncStyle()
        }

    override var tableBorder: Color
        get() = tableBorderOverride ?: opts().tableBorder
        set(value) {
            if (disposed) return
            if (tableBorderOverride == value) return
            tableBorderOverride = value
            syncStyle()
        }

    override var opaque: Boolean
        get() = opaqueState
        set(value) {
            if (disposed) return
            if (opaqueState == value) return
            opaqueState = value
            syncStyle()
        }

    override fun applyStyle(style: SessionEditorStyle) {
        if (disposed) return
        this.style = style
        selection?.applyStyle(style)
        syncStyle()
    }

    override fun setSelection(selection: SessionSelection?) {
        if (disposed) return
        if (this.selection === selection) return
        this.selection = selection
        clearBlocks()
        syncBlocks()
    }

    override fun resetStyles() {
        if (disposed) return
        fontOverride = null
        foregroundOverride = null
        backgroundOverride = null
        linkColorOverride = null
        codeBgOverride = null
        preBgOverride = null
        preFgOverride = null
        codeFontOverride = null
        quoteBorderOverride = null
        quoteFgOverride = null
        tableBorderOverride = null
        opaqueState = true
        syncStyle()
    }

    override fun set(text: String) {
        if (disposed) return
        if (source.toString() == text) return
        source.clear()
        source.append(text)
        syncBlocks()
    }

    override fun append(delta: String) {
        if (disposed) return
        if (delta.isEmpty()) return
        val fence = openFence
        val view = blocks.lastOrNull() as? CodeView
        if (fence != null && view != null && clean(fence.char, delta)) {
            source.append(delta)
            view.grow(delta)
            stale = true
            root.revalidate()
            root.repaint()
            return
        }
        source.append(delta)
        syncBlocks()
    }

    override fun clear() {
        if (disposed) return
        if (source.isEmpty() && rendered.isEmpty() && root.componentCount == 0) return
        source.clear()
        rendered = ""
        openFence = null
        stale = false
        clearBlocks()
        root.revalidate()
        root.repaint()
    }

    override fun addLinkListener(listener: MdView.LinkListener) {
        if (disposed) return
        listeners.add(listener)
    }

    override fun removeLinkListener(listener: MdView.LinkListener) {
        listeners.remove(listener)
    }

    override fun markdown(): String = source.toString()

    override fun html(): String {
        if (!stale) return rendered
        val out = project(source.toString())
        rendered = out.html
        openFence = out.open
        stale = false
        return rendered
    }

    override fun overrideSheet(): String = MdCommon.rules(opts())

    override fun simulateLink(href: String) {
        if (disposed) return
        dispatch(MdView.LinkEvent(href))
    }

    override fun dispose() {
        disposed = true
        listeners.clear()
        source.clear()
        rendered = ""
        openFence = null
        stale = false
        clearBlocks()
    }

    private fun syncStyle() {
        if (disposed) return
        val opts = opts()
        root.isOpaque = opts.opaque
        if (opts.opaque) root.background = opts.background
        for (view in blocks) view.style(opts)
        root.revalidate()
        root.repaint()
    }

    private fun syncBlocks() {
        if (disposed) return
        val text = source.toString()
        val out = project(text)
        rendered = out.html
        openFence = out.open
        stale = false
        val next = out.blocks
        if (text.isEmpty()) {
            openFence = null
            clearBlocks()
            root.revalidate()
            root.repaint()
            return
        }
        sync(next)
        root.revalidate()
        root.repaint()
    }

    private fun clearBlocks() {
        blocks.forEach { Disposer.dispose(it.disposable) }
        blocks.clear()
        root.removeAll()
    }

    private fun sync(next: List<Desc>) {
        var at = 0
        while (at < blocks.size && at < next.size) {
            val view = blocks[at]
            val desc = next[at]
            if (!view.compatible(desc)) break
            view.update(desc)
            at++
        }
        removeBlocks(at)
        for (desc in next.drop(at)) addBlock(view(desc))
    }

    private fun clean(char: Char, delta: String): Boolean {
        if (delta.contains(char)) return false
        val start = source.lastIndexOf("\n") + 1
        for (idx in start until source.length) {
            if (source[idx] == char) return false
        }
        return true
    }

    private fun removeBlocks(start: Int) {
        if (start >= blocks.size) return
        val idx = if (start == 0) 0 else start * 2 - 1
        while (root.componentCount > idx) root.remove(root.componentCount - 1)
        val stale = blocks.drop(start)
        repeat(blocks.size - start) { blocks.removeAt(blocks.lastIndex) }
        stale.forEach { Disposer.dispose(it.disposable) }
    }

    private fun addGap() {
        if (root.componentCount == 0) return
        root.add(Box.createVerticalStrut(JBUI.scale(SessionUiStyle.View.Code.BLOCK_GAP)))
    }

    private fun addBlock(view: View) {
        addGap()
        view.component.alignmentX = JComponent.LEFT_ALIGNMENT
        blocks.add(view)
        root.add(view.component)
    }

    private fun view(desc: Desc): View {
        val disposable = Disposer.newDisposable("Markdown block")
        return when (desc) {
            is Desc.Html -> HtmlView(desc, htmlBlock(desc.body, disposable), disposable)
            is Desc.Code -> CodeView(desc, codeBlock(desc.text, desc.file, disposable), disposable)
        }
    }

    private fun htmlBlock(body: String, disposable: Disposable): JBHtmlPane {
        val opts = opts()
        return JBHtmlPane(
            JBHtmlPaneStyleConfiguration {
                enableInlineCodeBackground = true
                enableCodeBlocksBackground = true
            },
            JBHtmlPaneConfiguration {
                customStyleSheetProvider { sheet() }
            },
        ).apply {
            isEditable = false
            isOpaque = opts.opaque
            background = opts.background
            text = "<html><body>$body</body></html>"
            selection?.register(this, disposable)
            addHyperlinkListener { e ->
                if (e.eventType != HyperlinkEvent.EventType.ACTIVATED) return@addHyperlinkListener
                val href = e.description ?: return@addHyperlinkListener
                val pt = (e.inputEvent as? java.awt.event.MouseEvent)?.point
                dispatch(MdView.LinkEvent(href, pt))
            }
        }
    }

    private fun codeBlock(text: String, file: FileType, disposable: Disposable): JBScrollPane {
        val opts = opts()
        val value = text.trimEnd('\n')
        val field = runCatching {
            CodeField(file, opts, text).also { ed ->
                ed.setDisposedWith(disposable)
                Disposer.register(disposable) {
                    ed.getEditor(false)?.let(EditorFactory.getInstance()::releaseEditor)
                }
                selection?.register(ed, disposable)
            }
        }.getOrElse { err ->
            LOG.warn("kind=markdown codeEditor=true failed message=${err.message}", err)
            textArea(text, opts, disposable)
        }
        sizeCodeField(field, value)
        val pane = object : JBScrollPane(field) {
            override fun doLayout() {
                super.doLayout()
                val view = viewport.view ?: return
                val size = viewport.extentSize
                if (size.height <= 0 || view.height == size.height) return
                view.setSize(view.width.coerceAtLeast(size.width), size.height)
            }
        }
        styleCodePane(pane, opts)
        sizeCodePane(pane, field)
        return pane
    }

    private fun styleCodePane(pane: JBScrollPane, opts: MdStyle) {
        pane.apply {
            border = JBUI.Borders.customLine(opts.tableBorder, SessionUiStyle.View.Code.BORDER_WIDTH)
            viewportBorder = JBUI.Borders.empty(
                SessionUiStyle.View.Code.topPadding(),
                SessionUiStyle.View.Code.VIEWPORT_HORIZONTAL_PADDING,
                SessionUiStyle.View.Code.VIEWPORT_BOTTOM_PADDING,
                SessionUiStyle.View.Code.VIEWPORT_HORIZONTAL_PADDING,
            )
            isOpaque = opts.opaque
            background = opts.preBg
            viewport.background = opts.preBg
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER
            isWheelScrollingEnabled = true
            setOverlappingScrollBar(false)
            horizontalScrollBar.preferredSize = Dimension(0, JBUI.scale(SessionUiStyle.View.Code.SCROLLBAR_HEIGHT))
            horizontalScrollBar.isOpaque = true
            verticalScrollBar.preferredSize = JBUI.emptySize()
        }
    }

    private fun sizeCodeField(component: JComponent, text: String) {
        val height = codeHeight(component, text)
        val width = codeWidth(component, text)
        component.preferredSize = Dimension(width, height)
        component.minimumSize = Dimension(0, height)
        component.maximumSize = Dimension(Int.MAX_VALUE, height)
    }

    private fun sizeCodePane(pane: JBScrollPane, component: JComponent) {
        val pad = pane.viewportBorder.getBorderInsets(pane)
        val height = component.preferredSize.height + pane.insets.top + pane.insets.bottom +
            pad.top + pad.bottom + pane.horizontalScrollBar.preferredSize.height
        pane.preferredSize = Dimension(0, height)
        pane.minimumSize = Dimension(0, height)
        pane.maximumSize = Dimension(Int.MAX_VALUE, height)
    }

    private fun codeWidth(component: JComponent, text: String): Int {
        val metrics = component.getFontMetrics(component.font)
        val width = text.lineSequence().maxOfOrNull { metrics.stringWidth(it) } ?: 0
        return width + JBUI.scale(SessionUiStyle.View.Code.WIDTH_PADDING)
    }

    private fun codeHeight(component: JComponent, text: String): Int {
        val count = text.lineSequence().count()
        val rows = count.coerceAtLeast(SessionUiStyle.View.Code.MIN_ROWS)
        val field = component as? CodeField
        if (field != null) {
            field.ensureWillComputePreferredSize()
            val ed = field.getEditor(false)
            val line = ed?.lineHeight ?: component.getFontMetrics(component.font).height
            return maxOf(field.preferredSize.height, line * rows)
        }
        val line = component.getFontMetrics(component.font).height
        return line * rows
    }

    private fun textArea(text: String, opts: MdStyle, disposable: Disposable) = JBTextArea(text.trimEnd('\n')).apply {
        isEditable = false
        lineWrap = false
        styleTextArea(this, opts)
        border = JBUI.Borders.empty(
            SessionUiStyle.View.Code.VIEWPORT_TOP_PADDING,
            SessionUiStyle.View.Code.VIEWPORT_HORIZONTAL_PADDING,
        )
        selection?.register(this, disposable)
    }

    private fun styleTextArea(area: JBTextArea, opts: MdStyle) {
        area.isOpaque = opts.opaque
        area.background = opts.preBg
        area.foreground = opts.preFg
        area.font = style.editorFont
    }

    private inner class CodeField(file: FileType, opts: MdStyle, value: String) :
        com.intellij.ui.EditorTextField(
            EditorFactory.getInstance().createDocument(value.trimEnd('\n')),
            ProjectManager.getInstance().defaultProject,
            file,
            true,
            false,
        ) {
        init {
            setFontInheritedFromLAF(false)
            font = style.editorFont
            addSettingsProvider { ed ->
                style.applyToEditor(ed)
                ed.setBorder(JBUI.Borders.empty())
                ed.scrollPane.border = JBUI.Borders.empty()
                ed.scrollPane.viewportBorder = JBUI.Borders.empty()
                ed.backgroundColor = opts.preBg
                ed.scrollPane.background = opts.preBg
                ed.scrollPane.viewport.background = opts.preBg
                ed.settings.isUseSoftWraps = false
                ed.settings.isAdditionalPageAtBottom = false
                ed.scrollPane.horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
                ed.scrollPane.verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER
            }
        }
    }

    private fun file(lang: String?): FileType {
        val key = lang?.trim()?.split(Regex("\\s+"))?.firstOrNull()?.lowercase().orEmpty()
        val ext = FILES[key] ?: return PlainTextFileType.INSTANCE
        val type = FileTypeRegistry.getInstance().getFileTypeByExtension(ext)
        if (type == UnknownFileType.INSTANCE) return PlainTextFileType.INSTANCE
        return type
    }

    private fun dispatch(event: MdView.LinkEvent) {
        for (l in listeners) l.onLink(event)
    }

    private fun sheet(): StyleSheet {
        val sheet = StyleSheet()
        val rules = overrideSheet()
        if (rules.isEmpty()) return sheet
        try {
            sheet.addRule(rules)
        } catch (err: Exception) {
            LOG.warn("kind=markdown css=true failed message=${err.message} rules=$rules", err)
        }
        return sheet
    }

    private fun opts(): MdStyle {
        val base = MdCommon.defaults(style)
        return base.copy(
            font = fontOverride ?: base.font,
            foreground = foregroundOverride ?: base.foreground,
            background = backgroundOverride ?: base.background,
            linkColor = linkColorOverride ?: base.linkColor,
            codeBg = codeBgOverride ?: base.codeBg,
            preBg = preBgOverride ?: base.preBg,
            preFg = preFgOverride ?: base.preFg,
            codeFont = codeFontOverride ?: base.codeFont,
            quoteBorder = quoteBorderOverride ?: base.quoteBorder,
            quoteFg = quoteFgOverride ?: base.quoteFg,
            tableBorder = tableBorderOverride ?: base.tableBorder,
            opaque = opaqueState,
        )
    }

    private fun collect(doc: Node): List<Desc> {
        val visitor = Visitor()
        doc.accept(visitor)
        return visitor.blocks
    }

    private fun project(text: String): Projection {
        val blocks = mutableListOf<Desc>()
        val html = StringBuilder()
        val md = StringBuilder()
        val lines = lines(text)
        var trailing: Fence? = null
        var idx = 0

        fun flush() {
            if (md.isEmpty()) return
            val doc = parser.parse(md.toString())
            val descs = collect(doc)
            blocks.addAll(descs)
            for (desc in descs) {
                when (desc) {
                    is Desc.Html -> html.append(desc.body)
                    is Desc.Code -> html.append(codeHtml(desc.text))
                }
            }
            md.clear()
        }

        while (idx < lines.size) {
            val line = lines[idx]
            val open = opener(line.text)
            if (open == null) {
                val pending = idx == lines.lastIndex && pendingOpener(line.text)
                if (pending) {
                    flush()
                    blocks.add(Desc.Code("", PlainTextFileType.INSTANCE))
                    html.append(codeHtml(""))
                } else {
                    md.append(line.text).append(line.end)
                }
                idx++
                continue
            }

            flush()
            idx++
            val code = StringBuilder()
            var closed = false
            var trimmed = false
            while (idx < lines.size) {
                val item = lines[idx]
                val close = closer(item.text, open)
                if (close) {
                    closed = true
                    idx++
                    break
                }
                val partial = idx == lines.lastIndex && partialCloser(item.text, open)
                if (partial) trimmed = true
                if (!partial) code.append(item.text).append(item.end)
                idx++
            }
            val desc = Desc.Code(code.toString(), file(open.info))
            blocks.add(desc)
            html.append(codeHtml(desc.text))
            trailing = if (!closed && !trimmed) open else null
        }

        flush()
        return Projection(html.toString(), blocks, trailing)
    }

    private fun lines(text: String): List<Line> {
        if (text.isEmpty()) return emptyList()
        val lines = mutableListOf<Line>()
        var start = 0
        while (start < text.length) {
            val end = text.indexOf('\n', start)
            if (end == -1) {
                lines.add(Line(text.substring(start), ""))
                break
            }
            lines.add(Line(text.substring(start, end), "\n"))
            start = end + 1
        }
        return lines
    }

    private fun opener(text: String): Fence? {
        val trimmed = text.dropWhile { it == ' ' }
        val indent = text.length - trimmed.length
        if (indent > 3) return null
        val char = trimmed.firstOrNull() ?: return null
        if (char != '`' && char != '~') return null
        val size = trimmed.takeWhile { it == char }.length
        if (size < 3) return null
        val info = trimmed.drop(size).trim()
        if (char == '`' && info.contains('`')) return null
        return Fence(char, size, info)
    }

    private fun closer(text: String, fence: Fence): Boolean {
        val trimmed = text.dropWhile { it == ' ' }
        val indent = text.length - trimmed.length
        if (indent > 3) return false
        val size = trimmed.takeWhile { it == fence.char }.length
        if (size < fence.size) return false
        return trimmed.drop(size).isBlank()
    }

    private fun pendingOpener(text: String): Boolean {
        val trimmed = text.dropWhile { it == ' ' }
        val indent = text.length - trimmed.length
        if (indent > 3) return false
        val char = trimmed.firstOrNull() ?: return false
        if (char != '`' && char != '~') return false
        val size = trimmed.takeWhile { it == char }.length
        if (size !in 1..2) return false
        return trimmed.drop(size).isBlank()
    }

    private fun partialCloser(text: String, fence: Fence): Boolean {
        val trimmed = text.dropWhile { it == ' ' }
        val indent = text.length - trimmed.length
        if (indent > 3) return false
        val size = trimmed.takeWhile { it == fence.char }.length
        if (size !in 1 until fence.size) return false
        return trimmed.drop(size).isBlank()
    }

    private fun codeHtml(text: String): String = "<pre><code>${escape(text)}</code></pre>\n"

    private fun escape(text: String): String = text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")

    private sealed class Desc {
        data class Html(val body: String) : Desc()
        data class Code(val text: String, val file: FileType) : Desc()
    }

    private data class Projection(val html: String, val blocks: List<Desc>, val open: Fence?)

    private data class Line(val text: String, val end: String)

    private data class Fence(val char: Char, val size: Int, val info: String)

    private abstract inner class View(
        var desc: Desc,
        val component: JComponent,
        val disposable: Disposable,
    ) {
        abstract fun compatible(desc: Desc): Boolean
        abstract fun update(desc: Desc)
        abstract fun style(opts: MdStyle)
    }

    private inner class HtmlView(desc: Desc.Html, private val pane: JBHtmlPane, disposable: Disposable) :
        View(desc, pane, disposable) {
        override fun compatible(desc: Desc) = desc is Desc.Html

        override fun update(desc: Desc) {
            if (this.desc == desc) return
            this.desc = desc
            pane.text = "<html><body>${(desc as Desc.Html).body}</body></html>"
        }

        override fun style(opts: MdStyle) {
            pane.isOpaque = opts.opaque
            pane.background = opts.background
            pane.reloadCssStylesheets()
            val item = desc as Desc.Html
            pane.text = "<html><body>${item.body}</body></html>"
        }
    }

    private inner class CodeView(desc: Desc.Code, private val pane: JBScrollPane, disposable: Disposable) :
        View(desc, pane, disposable) {
        override fun compatible(desc: Desc) = desc is Desc.Code && (this.desc as Desc.Code).file == desc.file

        override fun update(desc: Desc) {
            if (this.desc == desc) return
            this.desc = desc
            val value = (desc as Desc.Code).text.trimEnd('\n')
            val view = pane.viewport.view
            when (view) {
                is CodeField -> view.text = value
                is JBTextArea -> view.text = value
            }
            if (view is JComponent) {
                sizeCodeField(view, value)
                sizeCodePane(pane, view)
            }
        }

        fun grow(delta: String) {
            val item = desc as Desc.Code
            val next = item.copy(text = item.text + delta)
            desc = next
            val value = next.text.trimEnd('\n')
            val view = pane.viewport.view
            when (view) {
                is CodeField -> view.text = value
                is JBTextArea -> view.text = value
            }
            if (view is JComponent) {
                sizeCodeField(view, value)
                sizeCodePane(pane, view)
            }
        }

        override fun style(opts: MdStyle) {
            styleCodePane(pane, opts)
            val view = pane.viewport.view
            when (view) {
                is CodeField -> {
                    view.font = style.editorFont
                    view.background = opts.preBg
                }
                is JBTextArea -> styleTextArea(view, opts)
            }
            if (view is JComponent) {
                val text = when (view) {
                    is CodeField -> view.text
                    is JBTextArea -> view.text
                    else -> ""
                }
                sizeCodeField(view, text)
                sizeCodePane(pane, view)
            }
        }
    }

    private inner class Visitor : AbstractVisitor() {
        val blocks = mutableListOf<Desc>()
        private val run = StringBuilder()

        override fun visit(document: Document) {
            visitChildren(document)
            flush()
        }

        override fun visit(code: FencedCodeBlock) {
            flush()
            blocks.add(Desc.Code(code.literal, file(code.info)))
        }

        override fun visit(code: IndentedCodeBlock) {
            flush()
            blocks.add(Desc.Code(code.literal, file(null)))
        }

        private fun flush() {
            if (run.isEmpty()) return
            blocks.add(Desc.Html(run.toString()))
            run.clear()
        }

        public override fun visitChildren(parent: Node) {
            var child = parent.firstChild
            while (child != null) {
                val next = child.next
                if (child is ThematicBreak) {
                    child = next
                    continue
                }
                if (child is FencedCodeBlock || child is IndentedCodeBlock) child.accept(this)
                if (child is Block && child !is FencedCodeBlock && child !is IndentedCodeBlock) run.append(renderer.render(child))
                child = next
            }
        }
    }
}
