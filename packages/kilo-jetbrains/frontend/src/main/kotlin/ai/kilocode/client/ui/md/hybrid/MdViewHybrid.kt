package ai.kilocode.client.ui.md.hybrid

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.selection.SessionCopyTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.md.MdCodeBlockBorder
import ai.kilocode.client.ui.md.MdCodeBlockFactory
import ai.kilocode.client.ui.md.MdCommon
import ai.kilocode.client.ui.md.MdStyle
import ai.kilocode.client.ui.md.MdView
import ai.kilocode.log.KiloLog
import com.intellij.execution.ui.ConsoleViewContentType
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.editor.markup.HighlighterLayer
import com.intellij.openapi.editor.markup.HighlighterTargetArea
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.components.JBHtmlPane
import com.intellij.ui.components.JBHtmlPaneConfiguration
import com.intellij.ui.components.JBHtmlPaneStyleConfiguration
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Component
import java.awt.Dimension
import java.awt.Font
import java.awt.Point
import java.awt.event.HierarchyEvent
import java.awt.event.MouseEvent
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.JViewport
import javax.swing.ScrollPaneConstants
import javax.swing.SwingUtilities
import javax.swing.event.ChangeListener
import javax.swing.event.HyperlinkEvent
import javax.swing.text.html.StyleSheet
import kotlin.reflect.KProperty

@Suppress("UnstableApiUsage")
internal open class MdViewHybrid(
    style: SessionEditorStyle = SessionEditorStyle.current(),
    private var selection: SessionSelection? = null,
    private val code: MdCodeBlockFactory = MdCodeBlockFactory.default(),
) : MdView {
    companion object {
        private val LOG = KiloLog.create(MdViewHybrid::class.java)
    }

    private val listeners = mutableListOf<MdView.LinkListener>()
    private val source = StringBuilder()
    private var style = style
    private var rendered = ""
    private var htmlCache: HtmlCache? = null
    private var disposed = false
    private val blocks = mutableListOf<View>()
    private var openFence: Fence? = null
    private var stale = false
    private val projector = MdProjector()

    private val fontOverride = Override { opts().font }
    private val foregroundOverride = Override { opts().foreground }
    private val backgroundOverride = Override { opts().background }
    private val linkColorOverride = Override { opts().linkColor }
    private val codeBgOverride = Override { opts().codeBg }
    private val preBgOverride = Override { opts().preBg }
    private val preFgOverride = Override { opts().preFg }
    private val codeFontOverride = Override { opts().codeFont }
    private val quoteBorderOverride = Override { opts().quoteBorder }
    private val quoteFgOverride = Override { opts().quoteFg }
    private val tableBorderOverride = Override { opts().tableBorder }
    private var opaqueState = true

    private val root = RootPanel().apply {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        isOpaque = true
        background = opts().background
    }

    override val component: JComponent get() = root

    override var font: Font by fontOverride

    override var foreground: Color by foregroundOverride

    override var background: Color by backgroundOverride

    override var linkColor: Color by linkColorOverride

    override var codeBg: Color by codeBgOverride

    override var preBg: Color by preBgOverride

    override var preFg: Color by preFgOverride

    override var codeFont: String by codeFontOverride

    override var quoteBorder: Color by quoteBorderOverride

    override var quoteFg: Color by quoteFgOverride

    override var tableBorder: Color by tableBorderOverride

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
        fontOverride.clear()
        foregroundOverride.clear()
        backgroundOverride.clear()
        linkColorOverride.clear()
        codeBgOverride.clear()
        preBgOverride.clear()
        preFgOverride.clear()
        codeFontOverride.clear()
        quoteBorderOverride.clear()
        quoteFgOverride.clear()
        tableBorderOverride.clear()
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
        val view = blocks.lastOrNull()
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
        htmlCache = null
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
        if (stale) {
            val out = projector.project(source.toString())
            rendered = out.html
            openFence = out.open
            stale = false
        }
        return process(rendered, opts())
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
        htmlCache = null
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
        val out = projector.project(text)
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
            is Desc.Table -> TableView(desc, tableBlock(desc.body, disposable), disposable)
            is Desc.Code -> when (val kind = desc.kind) {
                is Kind.Source -> CodeView(desc, codeBlock(desc.text, kind.file, disposable), disposable)
                is Kind.Terminal -> TermView(desc, terminalBlock(desc.text, kind, disposable), disposable)
            }
        }
    }

    private fun htmlBlock(body: String, disposable: Disposable): JBHtmlPane {
        val opts = opts()
        return object : JBHtmlPane(
            JBHtmlPaneStyleConfiguration {
                enableInlineCodeBackground = false
                enableCodeBlocksBackground = true
            },
            JBHtmlPaneConfiguration {
                customStyleSheetProvider { sheet() }
            },
        ), UiDataProvider {
            private var viewport: JViewport? = null
            private val scroll = ChangeListener { hover() }
            private val hierarchy = java.awt.event.HierarchyListener { event ->
                if (event.changeFlags and HierarchyEvent.PARENT_CHANGED.toLong() != 0L) attach()
            }

            init {
                addHierarchyListener(hierarchy)
                Disposer.register(disposable) {
                    viewport?.removeChangeListener(scroll)
                    removeHierarchyListener(hierarchy)
                }
            }

            override fun addNotify() {
                super.addNotify()
                attach()
            }

            override fun removeNotify() {
                viewport?.removeChangeListener(scroll)
                viewport = null
                super.removeNotify()
            }

            override fun uiDataSnapshot(sink: DataSink) {
                selection?.provideCopy(sink) { document.getText(0, document.length).trim() }
            }

            private fun attach() {
                val next = SwingUtilities.getAncestorOfClass(JViewport::class.java, this) as? JViewport
                if (viewport === next) return
                viewport?.removeChangeListener(scroll)
                viewport = next
                next?.addChangeListener(scroll)
            }

            private fun hover() {
                val pt = runCatching { mousePosition }.getOrNull()
                val event = if (pt == null) {
                    MouseEvent(this, MouseEvent.MOUSE_EXITED, System.currentTimeMillis(), 0, -1, -1, 0, false, MouseEvent.NOBUTTON)
                } else {
                    MouseEvent(this, MouseEvent.MOUSE_MOVED, System.currentTimeMillis(), 0, pt.x, pt.y, 0, false, MouseEvent.NOBUTTON)
                }
                dispatchEvent(event)
            }
        }.apply {
            isEditable = false
            isOpaque = opts.opaque
            background = opts.background
            text = html(body, opts)
            selection?.register(this, disposable)
            addHyperlinkListener { e ->
                if (e.eventType != HyperlinkEvent.EventType.ACTIVATED) return@addHyperlinkListener
                val href = e.description ?: return@addHyperlinkListener
                val pt = linkPoint(e) ?: (e.inputEvent as? java.awt.event.MouseEvent)?.point
                dispatch(MdView.LinkEvent(href, pt, this))
            }
        }
    }

    private fun JBHtmlPane.linkPoint(event: HyperlinkEvent): Point? {
        val elem = event.sourceElement ?: return null
        return runCatching {
            val start = modelToView2D(elem.startOffset)?.bounds ?: return@runCatching null
            val end = modelToView2D((elem.endOffset - 1).coerceAtLeast(elem.startOffset))?.bounds ?: start
            val bounds = start.union(end)
            Point(bounds.x + bounds.width / 2, bounds.y)
        }.getOrNull()
    }

    private fun tableBlock(body: String, disposable: Disposable): JBScrollPane {
        val opts = opts()
        val inner = htmlBlock(body, disposable)
        val pane = object : JBScrollPane(inner), SessionCopyTarget {
            override val copyAnchor: JComponent get() = this

            override fun copyText() = inner.document.getText(0, inner.document.length).trim()

            // Width is pinned to 0 so BoxLayout shrinks the pane to the container while the wide
            // table scrolls horizontally inside it. Height is derived from the inner pane's current
            // preferred height on every pass so it is correct once the html view is realized
            // (a static measurement taken before layout is too small and crops the table).
            override fun getPreferredSize() = Dimension(0, tableHeight(this, inner))

            override fun getMinimumSize() = Dimension(0, tableHeight(this, inner))

            override fun getMaximumSize() = Dimension(Int.MAX_VALUE, tableHeight(this, inner))
        }
        styleTablePane(pane, opts)
        return pane
    }

    private fun codeBlock(text: String, file: FileType, disposable: Disposable): JBScrollPane {
        val opts = opts()
        val value = text.trimEnd('\n')
        val field = runCatching {
            codeField(file, opts, text, false, disposable)
        }.getOrElse { err ->
            LOG.warn("kind=markdown codeEditor=true failed message=${err.message}", err)
            if (code.opts.editorOnly) runCatching {
                codeField(PlainTextFileType.INSTANCE, opts, text, false, disposable)
            }.getOrElse { fallback ->
                LOG.warn("kind=markdown codeEditor=true fallback=plain failed message=${fallback.message}", fallback)
                throw fallback
            } else {
                textArea(text, opts, disposable)
            }
        }
        sizeCodeField(field, value)
        val pane = object : CodePane(field), SessionCopyTarget {
            override val copyAnchor: JComponent get() = this

            override fun copyText() = fieldText(field)
        }
        styleCodePane(pane, opts)
        sizeCodePane(pane, field)
        return pane
    }

    private fun terminalBlock(text: String, kind: Kind.Terminal, disposable: Disposable): JBScrollPane {
        val opts = opts()
        val term = MdTerminal.decode(text, kind.stream)
        val value = shellDisplay(term, kind.mode)
        val field = codeField(PlainTextFileType.INSTANCE, opts, value.text, false, disposable)
        sizeCodeField(field, value.text)
        val pane = object : CodePane(field), SessionCopyTarget {
            override val copyAnchor: JComponent get() = this

            override fun copyText() = field.text
        }
        styleCodePane(pane, opts)
        sizeCodePane(pane, field)
        applyTerm(field, term, kind.mode, value)
        return pane
    }

    private fun styleCodePane(pane: JBScrollPane, opts: MdStyle) {
        pane.apply {
            val width = SessionUiStyle.View.Code.BORDER_WIDTH
            border = when (code.opts.border) {
                MdCodeBlockBorder.All -> JBUI.Borders.customLine(opts.codeBorder, width)
                MdCodeBlockBorder.Horizontal -> JBUI.Borders.customLine(opts.codeBorder, width, 0, width, 0)
                MdCodeBlockBorder.Bottom -> JBUI.Borders.customLine(opts.codeBorder, 0, 0, width, 0)
                MdCodeBlockBorder.None -> JBUI.Borders.empty()
            }
            viewportBorder = JBUI.Borders.empty(
                SessionUiStyle.View.Code.topPadding(),
                SessionUiStyle.View.Code.VIEWPORT_HORIZONTAL_PADDING,
                SessionUiStyle.View.Code.VIEWPORT_BOTTOM_PADDING,
                SessionUiStyle.View.Code.VIEWPORT_HORIZONTAL_PADDING,
            )
            isOpaque = true
            background = opts.preBg
            viewport.isOpaque = true
            viewport.background = opts.preBg
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED
            verticalScrollBarPolicy = code.opts.verticalPolicy
            isWheelScrollingEnabled = true
            setOverlappingScrollBar(false)
            horizontalScrollBar.preferredSize = Dimension(0, JBUI.scale(SessionUiStyle.View.Code.SCROLLBAR_HEIGHT))
            horizontalScrollBar.isOpaque = true
            if (code.opts.verticalPolicy == ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER) {
                verticalScrollBar.preferredSize = JBUI.emptySize()
            }
        }
    }

    private fun codeField(file: FileType, opts: MdStyle, text: String, soft: Boolean, disposable: Disposable) =
        CodeField(file, opts, text, soft).also { ed ->
            Disposer.register(disposable) {
                ed.getEditor(false)?.let(EditorFactory.getInstance()::releaseEditor)
            }
            ed.setDisposedWith(disposable)
            selection?.register(ed, disposable)
        }

    private fun applyEditorChrome(ed: EditorEx, opts: MdStyle, soft: Boolean) {
        style.applyToEditor(ed)
        ed.setBorder(JBUI.Borders.empty())
        ed.scrollPane.border = JBUI.Borders.empty()
        ed.scrollPane.viewportBorder = JBUI.Borders.empty()
        ed.backgroundColor = opts.preBg
        ed.scrollPane.background = opts.preBg
        ed.scrollPane.isOpaque = true
        ed.scrollPane.viewport.isOpaque = true
        ed.scrollPane.viewport.background = opts.preBg
        ed.settings.isUseSoftWraps = soft
        ed.settings.isAdditionalPageAtBottom = false
        ed.scrollPane.horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        ed.scrollPane.verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER
    }

    private fun fieldText(component: Component): String = when (component) {
        is CodeField -> component.text
        is JBTextArea -> component.text
        else -> ""
    }

    private fun sizeCodeField(component: JComponent, text: String) {
        val height = codeHeight(component, text, null)
        val width = codeWidth(component, text)
        component.preferredSize = Dimension(width, height)
        component.minimumSize = Dimension(0, height)
        component.maximumSize = Dimension(Int.MAX_VALUE, height)
    }

    private fun sizeCodePane(pane: JBScrollPane, component: JComponent) {
        val pad = pane.viewportBorder.getBorderInsets(pane)
        val text = fieldText(component)
        val content = codeHeight(component, text, code.opts.maxLines)
        val height = content + pane.insets.top + pane.insets.bottom +
            pad.top + pad.bottom + pane.horizontalScrollBar.preferredSize.height
        pane.preferredSize = Dimension(0, height)
        pane.minimumSize = Dimension(0, height)
        pane.maximumSize = Dimension(Int.MAX_VALUE, height)
    }

    private fun styleTablePane(pane: JBScrollPane, opts: MdStyle) {
        pane.apply {
            border = JBUI.Borders.empty()
            viewportBorder = JBUI.Borders.empty()
            isOpaque = opts.opaque
            background = opts.background
            viewport.isOpaque = opts.opaque
            viewport.background = opts.background
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER
            isWheelScrollingEnabled = true
            setOverlappingScrollBar(false)
            horizontalScrollBar.preferredSize = Dimension(0, JBUI.scale(SessionUiStyle.View.Code.SCROLLBAR_HEIGHT))
            horizontalScrollBar.isOpaque = opts.opaque
            verticalScrollBar.preferredSize = JBUI.emptySize()
        }
    }

    private fun tableHeight(pane: JBScrollPane, inner: JComponent): Int {
        val pad = pane.viewportBorder?.getBorderInsets(pane) ?: JBUI.emptyInsets()
        return inner.preferredSize.height + pane.insets.top + pane.insets.bottom +
            pad.top + pad.bottom + pane.horizontalScrollBar.preferredSize.height
    }

    private fun codeWidth(component: JComponent, text: String): Int {
        val metrics = component.getFontMetrics(component.font)
        val width = text.lineSequence().maxOfOrNull { metrics.stringWidth(it) } ?: 0
        return width + JBUI.scale(SessionUiStyle.View.Code.WIDTH_PADDING)
    }

    private fun codeHeight(component: JComponent, text: String, max: Int?): Int {
        val count = text.lineSequence().count()
        val base = count.coerceAtLeast(SessionUiStyle.View.Code.MIN_ROWS)
        val rows = max?.let { base.coerceAtMost(it) } ?: base
        val field = component as? CodeField
        if (field != null) {
            field.ensureWillComputePreferredSize()
            val ed = field.getEditor(false)
            val line = ed?.lineHeight ?: component.getFontMetrics(component.font).height
            if (max != null) return line * rows
            return maxOf(field.preferredSize.height, line * rows)
        }
        val line = component.getFontMetrics(component.font).height
        return line * rows
    }

    private fun textArea(text: String, opts: MdStyle, disposable: Disposable) = object : JBTextArea(text.trimEnd('\n')), SessionCopyTarget {
        override val copyAnchor: JComponent get() = this

        override fun copyText() = this.text
    }.apply {
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
        area.isOpaque = true
        area.background = opts.preBg
        area.foreground = opts.preFg
        area.font = style.editorFont
    }

    private inner class CodeField(file: FileType, opts: MdStyle, value: String, val soft: Boolean) :
        com.intellij.ui.EditorTextField(
            EditorFactory.getInstance().createDocument(value.trimEnd('\n')),
            ProjectManager.getInstance().defaultProject,
            file,
            true,
            false,
        ), SessionCopyTarget {
        override val copyAnchor: JComponent get() = this

        override fun copyText() = text

        init {
            setFontInheritedFromLAF(false)
            font = style.editorFont
            addSettingsProvider { ed -> applyEditorChrome(ed, opts, soft) }
        }

        override fun uiDataSnapshot(sink: DataSink) {
            super.uiDataSnapshot(sink)
            selection?.provideCopy(sink) { text }
        }
    }

    private inner class RootPanel : JPanel(), UiDataProvider {
        override fun uiDataSnapshot(sink: DataSink) {
            selection?.provideCopy(sink) { markdown() }
        }
    }

    private open inner class CodePane(component: JComponent) : JBScrollPane(component) {
        override fun doLayout() {
            super.doLayout()
            if (code.opts.verticalPolicy != ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER) return
            val view = viewport.view ?: return
            val size = viewport.extentSize
            if (size.height <= 0 || view.height == size.height) return
            view.setSize(view.width.coerceAtLeast(size.width), size.height)
        }
    }

    private inner class Override<T>(private val base: () -> T) {
        var value: T? = null
            private set

        operator fun getValue(ref: Any?, property: KProperty<*>): T = value ?: base()

        operator fun setValue(ref: Any?, property: KProperty<*>, next: T) {
            if (disposed) return
            if (value == next) return
            value = next
            syncStyle()
        }

        fun clear() {
            value = null
        }
    }

    private fun shellDisplay(term: Term, mode: Mode): ShellDisplay {
        if (mode == Mode.Shell) return MdShellHighlight.project(term.text)
        if (mode == Mode.Command) return MdShellHighlight.command(term.text)
        return ShellDisplay(term.text, emptyList())
    }

    private fun applyTerm(field: CodeField, term: Term, mode: Mode, display: ShellDisplay = shellDisplay(term, mode)) {
        val editor = field.getEditor(true) ?: return
        editor.markupModel.removeAllHighlighters()
        if (mode == Mode.Shell || mode == Mode.Command) {
            applyShell(field, display)
            return
        }
        val size = editor.document.textLength
        for (range in term.ranges) {
            val start = range.start.coerceAtMost(size)
            val end = range.end.coerceAtMost(size)
            if (start >= end) continue
            val type = ConsoleViewContentType.getConsoleViewType(range.key)
            val key = type.attributesKey
            if (key != null) {
                editor.markupModel.addRangeHighlighter(
                    key,
                    start,
                    end,
                    HighlighterLayer.SYNTAX + 1,
                    HighlighterTargetArea.EXACT_RANGE,
                )
            } else {
                editor.markupModel.addRangeHighlighter(
                    start,
                    end,
                    HighlighterLayer.SYNTAX + 1,
                    type.attributes,
                    HighlighterTargetArea.EXACT_RANGE,
                )
            }
        }
    }

    private fun applyShell(field: CodeField, display: ShellDisplay) {
        val editor = field.getEditor(false) ?: return
        MdShellHighlight.apply(editor, display)
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
            font = fontOverride.value ?: base.font,
            foreground = foregroundOverride.value ?: base.foreground,
            background = backgroundOverride.value ?: base.background,
            linkColor = linkColorOverride.value ?: base.linkColor,
            codeBg = codeBgOverride.value ?: base.codeBg,
            preBg = preBgOverride.value ?: base.preBg,
            preFg = preFgOverride.value ?: base.preFg,
            codeFont = codeFontOverride.value ?: base.codeFont,
            quoteBorder = quoteBorderOverride.value ?: base.quoteBorder,
            quoteFg = quoteFgOverride.value ?: base.quoteFg,
            tableBorder = tableBorderOverride.value ?: base.tableBorder,
            opaque = opaqueState,
        )
    }

    private fun html(body: String, opts: MdStyle): String = "<html><body>${process(body, opts)}</body></html>"

    private fun process(body: String, opts: MdStyle): String {
        val color = opts.inlineCodeFg.rgb
        val cached = htmlCache
        if (cached != null && cached.body == body && cached.color == color) return cached.html
        val html = MdCommon.inlineCode(body, opts)
        htmlCache = HtmlCache(body, color, html)
        return html
    }

    private data class HtmlCache(val body: String, val color: Int, val html: String)

    private abstract inner class View(
        var desc: Desc,
        val component: JComponent,
        val disposable: Disposable,
    ) {
        abstract fun compatible(desc: Desc): Boolean
        abstract fun update(desc: Desc)
        abstract fun style(opts: MdStyle)
        open fun grow(delta: String) = Unit
    }

    private inner class HtmlView(desc: Desc.Html, private val pane: JBHtmlPane, disposable: Disposable) :
        View(desc, pane, disposable) {
        override fun compatible(desc: Desc) = desc is Desc.Html

        override fun update(desc: Desc) {
            if (this.desc == desc) return
            this.desc = desc
            pane.text = html((desc as Desc.Html).body, opts())
        }

        override fun style(opts: MdStyle) {
            pane.isOpaque = opts.opaque
            pane.background = opts.background
            pane.reloadCssStylesheets()
            val item = desc as Desc.Html
            pane.text = html(item.body, opts)
        }
    }

    private inner class TableView(desc: Desc.Table, private val pane: JBScrollPane, disposable: Disposable) :
        View(desc, pane, disposable) {
        override fun compatible(desc: Desc) = desc is Desc.Table

        override fun update(desc: Desc) {
            if (this.desc == desc) return
            this.desc = desc
            val inner = pane.viewport.view as? JBHtmlPane ?: return
            inner.text = html((desc as Desc.Table).body, opts())
            pane.revalidate()
        }

        override fun style(opts: MdStyle) {
            styleTablePane(pane, opts)
            val inner = pane.viewport.view as? JBHtmlPane ?: return
            inner.isOpaque = opts.opaque
            inner.background = opts.background
            inner.reloadCssStylesheets()
            inner.text = html((desc as Desc.Table).body, opts)
            pane.revalidate()
        }
    }

    private inner class CodeView(desc: Desc.Code, private val pane: JBScrollPane, disposable: Disposable) :
        View(desc, pane, disposable) {
        override fun compatible(desc: Desc) = desc is Desc.Code && (this.desc as Desc.Code).kind == desc.kind

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

        override fun grow(delta: String) {
            val item = desc as Desc.Code
            update(item.copy(text = item.text + delta))
        }

        override fun style(opts: MdStyle) {
            styleCodePane(pane, opts)
            val view = pane.viewport.view
            when (view) {
                is CodeField -> {
                    view.font = style.editorFont
                    view.background = opts.preBg
                    view.getEditor(false)?.let { ed -> applyEditorChrome(ed, opts, view.soft) }
                }
                is JBTextArea -> styleTextArea(view, opts)
            }
            if (view is JComponent) {
                val text = fieldText(view)
                sizeCodeField(view, text)
                sizeCodePane(pane, view)
            }
        }
    }

    private inner class TermView(desc: Desc.Code, private val pane: JBScrollPane, disposable: Disposable) :
        View(desc, pane, disposable) {
        override fun compatible(desc: Desc) = desc is Desc.Code && (this.desc as Desc.Code).kind == desc.kind

        override fun update(desc: Desc) {
            if (this.desc == desc) return
            this.desc = desc
            val item = desc as Desc.Code
            val kind = item.kind as Kind.Terminal
            val term = MdTerminal.decode(item.text, kind.stream)
            val value = shellDisplay(term, kind.mode)
            val view = pane.viewport.view as? CodeField ?: return
            view.text = value.text
            sizeCodeField(view, value.text)
            sizeCodePane(pane, view)
            applyTerm(view, term, kind.mode, value)
        }

        override fun style(opts: MdStyle) {
            styleCodePane(pane, opts)
            val view = pane.viewport.view as? CodeField ?: return
            val item = desc as Desc.Code
            val kind = item.kind as Kind.Terminal
            view.font = style.editorFont
            view.background = opts.preBg
            view.getEditor(false)?.let { ed -> applyEditorChrome(ed, opts, view.soft) }
            val term = MdTerminal.decode(item.text, kind.stream)
            val value = shellDisplay(term, kind.mode)
            if (view.text != value.text) view.text = value.text
            sizeCodeField(view, value.text)
            sizeCodePane(pane, view)
            applyTerm(view, term, kind.mode, value)
        }

        override fun grow(delta: String) {
            val item = desc as Desc.Code
            update(item.copy(text = item.text + delta))
        }
    }
}
