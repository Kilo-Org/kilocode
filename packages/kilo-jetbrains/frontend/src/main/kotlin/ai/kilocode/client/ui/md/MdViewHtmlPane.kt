package ai.kilocode.client.ui.md

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.log.KiloLog
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBHtmlPane
import com.intellij.ui.components.JBHtmlPaneConfiguration
import com.intellij.ui.components.JBHtmlPaneStyleConfiguration
import org.commonmark.ext.autolink.AutolinkExtension
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.parser.Parser
import org.commonmark.renderer.html.HtmlRenderer
import java.awt.Color
import java.awt.Font
import javax.swing.JComponent
import javax.swing.event.HyperlinkEvent
import javax.swing.text.html.StyleSheet

@Suppress("UnstableApiUsage")
internal class MdViewHtmlPane(
    style: SessionEditorStyle = SessionEditorStyle.current(),
    private var selection: SessionSelection? = null,
) : MdView {
    companion object {
        private val LOG = KiloLog.create(MdViewHtmlPane::class.java)
    }

    private val listeners = mutableListOf<MdView.LinkListener>()
    private val source = StringBuilder()
    private var rendered = ""
    private var style = style
    private var reg: Disposable? = null
    private var disposed = false

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

    private val pane: JBHtmlPane = JBHtmlPane(
        JBHtmlPaneStyleConfiguration {
            enableInlineCodeBackground = true
            enableCodeBlocksBackground = true
        },
        JBHtmlPaneConfiguration {
            customStyleSheetProvider { buildOverrideStyleSheet() }
        },
    ).apply {
        isEditable = false
        isOpaque = true
        background = opts().background

        addHyperlinkListener { e ->
            if (e.eventType != HyperlinkEvent.EventType.ACTIVATED) return@addHyperlinkListener
            val href = e.description ?: return@addHyperlinkListener
            val pt = (e.inputEvent as? java.awt.event.MouseEvent)?.point
            dispatch(MdView.LinkEvent(href, pt))
        }
    }

    init {
        syncSelection()
    }

    override val component: JComponent get() = pane

    override var font: Font
        get() = fontOverride ?: opts().font
        set(value) {
            if (disposed) return
            if (fontOverride == value) return
            fontOverride = value
            markDirty()
        }

    override var foreground: Color
        get() = foregroundOverride ?: opts().foreground
        set(value) {
            if (disposed) return
            if (foregroundOverride == value) return
            foregroundOverride = value
            markDirty()
        }

    override var background: Color
        get() = backgroundOverride ?: opts().background
        set(value) {
            if (disposed) return
            if (backgroundOverride == value) return
            backgroundOverride = value
            if (opaqueState) pane.background = value
            markDirty()
        }

    override var linkColor: Color
        get() = linkColorOverride ?: opts().linkColor
        set(value) {
            if (disposed) return
            if (linkColorOverride == value) return
            linkColorOverride = value
            markDirty()
        }

    override var codeBg: Color
        get() = codeBgOverride ?: opts().codeBg
        set(value) {
            if (disposed) return
            if (codeBgOverride == value) return
            codeBgOverride = value
            markDirty()
        }

    override var preBg: Color
        get() = preBgOverride ?: opts().preBg
        set(value) {
            if (disposed) return
            if (preBgOverride == value) return
            preBgOverride = value
            markDirty()
        }

    override var preFg: Color
        get() = preFgOverride ?: opts().preFg
        set(value) {
            if (disposed) return
            if (preFgOverride == value) return
            preFgOverride = value
            markDirty()
        }

    override var codeFont: String
        get() = codeFontOverride ?: opts().codeFont
        set(value) {
            if (disposed) return
            if (codeFontOverride == value) return
            codeFontOverride = value
            markDirty()
        }

    override var quoteBorder: Color
        get() = quoteBorderOverride ?: opts().quoteBorder
        set(value) {
            if (disposed) return
            if (quoteBorderOverride == value) return
            quoteBorderOverride = value
            markDirty()
        }

    override var quoteFg: Color
        get() = quoteFgOverride ?: opts().quoteFg
        set(value) {
            if (disposed) return
            if (quoteFgOverride == value) return
            quoteFgOverride = value
            markDirty()
        }

    override var tableBorder: Color
        get() = tableBorderOverride ?: opts().tableBorder
        set(value) {
            if (disposed) return
            if (tableBorderOverride == value) return
            tableBorderOverride = value
            markDirty()
        }

    override var opaque: Boolean
        get() = opaqueState
        set(value) {
            if (disposed) return
            if (opaqueState == value) return
            opaqueState = value
            pane.isOpaque = value
            if (value) pane.background = background
            markDirty()
        }

    override fun applyStyle(style: SessionEditorStyle) {
        if (disposed) return
        this.style = style
        selection?.applyStyle(style)
        if (opaqueState) pane.background = background
        markDirty()
    }

    override fun setSelection(selection: SessionSelection?) {
        if (disposed) return
        if (this.selection === selection) return
        reg?.let(Disposer::dispose)
        reg = null
        this.selection = selection
        syncSelection()
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
        pane.isOpaque = true
        pane.background = background
        markDirty()
    }

    override fun set(text: String) {
        if (disposed) return
        if (source.toString() == text) return
        source.clear()
        source.append(text)
        syncHtml()
    }

    override fun append(delta: String) {
        if (disposed) return
        if (delta.isEmpty()) return
        source.append(delta)
        syncHtml()
    }

    override fun clear() {
        if (disposed) return
        if (source.isEmpty() && rendered.isEmpty() && pane.text.isEmpty()) return
        source.clear()
        rendered = ""
        pane.text = ""
    }

    override fun addLinkListener(listener: MdView.LinkListener) {
        if (disposed) return
        listeners.add(listener)
    }

    override fun removeLinkListener(listener: MdView.LinkListener) {
        listeners.remove(listener)
    }

    override fun markdown(): String = source.toString()

    override fun html(): String = rendered

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
        reg?.let(Disposer::dispose)
        reg = null
        pane.text = ""
    }

    private fun syncSelection() {
        reg = selection?.register(pane)
    }

    private fun dispatch(event: MdView.LinkEvent) {
        for (l in listeners) l.onLink(event)
    }

    private fun markDirty() {
        if (disposed) return
        pane.reloadCssStylesheets()
        if (source.isNotEmpty()) syncHtml()
    }

    private fun syncHtml() {
        if (disposed) return
        val body = renderer.render(parser.parse(source.toString()))
        if (rendered == body && pane.text == "<html><body>$body</body></html>") return
        rendered = body
        pane.text = "<html><body>$body</body></html>"
        pane.caretPosition = 0
    }

    private fun buildOverrideStyleSheet(): StyleSheet {
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
}
