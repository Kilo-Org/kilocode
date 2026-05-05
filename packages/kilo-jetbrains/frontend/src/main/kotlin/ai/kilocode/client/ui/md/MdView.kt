package ai.kilocode.client.ui.md

import ai.kilocode.log.KiloLog
import com.intellij.ui.components.JBHtmlPane
import com.intellij.ui.components.JBHtmlPaneConfiguration
import com.intellij.ui.components.JBHtmlPaneStyleConfiguration
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import org.commonmark.ext.autolink.AutolinkExtension
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.parser.Parser
import org.commonmark.renderer.html.HtmlRenderer
import java.awt.Color
import java.awt.Font
import java.awt.Point
import javax.swing.JComponent
import javax.swing.event.HyperlinkEvent
import javax.swing.text.html.StyleSheet

/**
 * Markdown rendering component backed by [JBHtmlPane] with editor-aware styling.
 *
 * By default, font and colors are derived from the global editor colour scheme.
 * All style properties are optional overrides on top of those defaults.
 * Call [resetStyles] to revert to editor defaults after overriding.
 *
 * Create instances via [MdView.html]. All public methods must be called on the EDT.
 */
@Suppress("UnstableApiUsage")
abstract class MdView private constructor() {

    abstract val component: JComponent
    abstract fun set(text: String)
    abstract fun append(delta: String)
    abstract fun clear()
    /** Revert all style overrides to editor-derived defaults. */
    abstract fun resetStyles()
    abstract fun addLinkListener(listener: LinkListener)
    abstract fun removeLinkListener(listener: LinkListener)

    abstract var font: Font
    abstract var foreground: Color
    abstract var background: Color
    abstract var linkColor: Color
    abstract var codeBg: Color
    abstract var preBg: Color
    abstract var preFg: Color
    abstract var codeFont: String
    abstract var quoteBorder: Color
    abstract var quoteFg: Color
    abstract var tableBorder: Color

    /**
     * When `false`, the component is transparent — the parent's background shows through
     * and no background is forced in the CSS body rule.
     */
    abstract var opaque: Boolean

    data class LinkEvent(
        val href: String,
        val point: Point? = null,
    )

    fun interface LinkListener {
        fun onLink(event: LinkEvent)
    }

    internal abstract fun markdown(): String
    internal abstract fun html(): String
    /** Returns the current CSS override rules applied on top of JBHtmlPane's default stylesheet. */
    internal abstract fun overrideSheet(): String
    internal abstract fun simulateLink(href: String)

    companion object {
        fun html(): MdView = HtmlImpl()
    }

    @Suppress("UnstableApiUsage")
    private class HtmlImpl : MdView() {
        companion object {
            private val LOG = KiloLog.create(HtmlImpl::class.java)
            private val TAGS = listOf(
                "body", "p", "div", "span", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td",
                "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "a", "tt", "code", "samp", "pre",
            )

            private fun hex(c: Color): String = String.format("#%02x%02x%02x", c.red, c.green, c.blue)

            private fun css(text: String): String = text
                .replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\n", " ")
                .replace("\r", " ")
        }

        private val listeners = mutableListOf<LinkListener>()
        private val source = StringBuilder()
        private var rendered = ""

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

        // nullable overrides — null means "use JBHtmlPane / editor default"
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
                // colorSchemeProvider defaults to EditorColorsManager.getInstance().globalScheme
                enableInlineCodeBackground = true
                enableCodeBlocksBackground = true
            },
            JBHtmlPaneConfiguration {
                // fontResolver defaults to EditorCssFontResolver.getGlobalInstance() via JBHtmlPane's ImplService
                customStyleSheetProvider { buildOverrideStyleSheet() }
            }
        ).apply {
            isEditable = false
            isOpaque = true
            background = UIUtil.getPanelBackground()

            addHyperlinkListener { e ->
                if (e.eventType == HyperlinkEvent.EventType.ACTIVATED) {
                    val href = e.description ?: return@addHyperlinkListener
                    val pt = (e.inputEvent as? java.awt.event.MouseEvent)?.point
                    val event = LinkEvent(href, pt)
                    for (l in listeners) l.onLink(event)
                }
            }
        }

        override val component: JComponent get() = pane

        // -- style properties (non-null API backed by nullable overrides) ----

        override var font: Font
            get() = fontOverride ?: JBUI.Fonts.label()
            set(value) {
                if (fontOverride == value) return
                fontOverride = value
                markDirty()
            }

        override var foreground: Color
            get() = foregroundOverride ?: UIUtil.getLabelForeground()
            set(value) {
                if (foregroundOverride == value) return
                foregroundOverride = value
                markDirty()
            }

        override var background: Color
            get() = backgroundOverride ?: pane.background
            set(value) {
                if (backgroundOverride == value) return
                backgroundOverride = value
                if (opaqueState) pane.background = value
                markDirty()
            }

        override var linkColor: Color
            get() = linkColorOverride ?: Color(0x58, 0x9D, 0xF6)
            set(value) {
                if (linkColorOverride == value) return
                linkColorOverride = value
                markDirty()
            }

        override var codeBg: Color
            get() = codeBgOverride ?: Color(0x3C, 0x3F, 0x41)
            set(value) {
                if (codeBgOverride == value) return
                codeBgOverride = value
                markDirty()
            }

        override var preBg: Color
            get() = preBgOverride ?: Color(0x2B, 0x2B, 0x2B)
            set(value) {
                if (preBgOverride == value) return
                preBgOverride = value
                markDirty()
            }

        override var preFg: Color
            get() = preFgOverride ?: Color(0xA9, 0xB7, 0xC6)
            set(value) {
                if (preFgOverride == value) return
                preFgOverride = value
                markDirty()
            }

        override var codeFont: String
            // _EditorFontNoLigatures_ is resolved by EditorCssFontResolver to the global editor font
            get() = codeFontOverride ?: "_EditorFontNoLigatures_"
            set(value) {
                if (codeFontOverride == value) return
                codeFontOverride = value
                markDirty()
            }

        override var quoteBorder: Color
            get() = quoteBorderOverride ?: Color(0x55, 0x55, 0x55)
            set(value) {
                if (quoteBorderOverride == value) return
                quoteBorderOverride = value
                markDirty()
            }

        override var quoteFg: Color
            get() = quoteFgOverride ?: Color(0x99, 0x99, 0x99)
            set(value) {
                if (quoteFgOverride == value) return
                quoteFgOverride = value
                markDirty()
            }

        override var tableBorder: Color
            get() = tableBorderOverride ?: Color(0x55, 0x55, 0x55)
            set(value) {
                if (tableBorderOverride == value) return
                tableBorderOverride = value
                markDirty()
            }

        override var opaque: Boolean
            get() = opaqueState
            set(value) {
                if (opaqueState == value) return
                opaqueState = value
                pane.isOpaque = value
                if (value) pane.background = backgroundOverride ?: UIUtil.getPanelBackground()
                markDirty()
            }

        override fun resetStyles() {
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
            pane.background = UIUtil.getPanelBackground()
            markDirty()
        }

        // -- content API ---------------------------------------------------

        override fun set(text: String) {
            if (source.toString() == text) return
            source.clear()
            source.append(text)
            syncHtml()
        }

        override fun append(delta: String) {
            if (delta.isEmpty()) return
            source.append(delta)
            syncHtml()
        }

        override fun clear() {
            if (source.isEmpty() && rendered.isEmpty() && pane.text.isEmpty()) return
            source.clear()
            rendered = ""
            pane.text = ""
        }

        override fun addLinkListener(listener: LinkListener) { listeners.add(listener) }
        override fun removeLinkListener(listener: LinkListener) { listeners.remove(listener) }

        override fun markdown(): String = source.toString()
        override fun html(): String = rendered
        override fun overrideSheet(): String = buildOverrideRulesString()

        override fun simulateLink(href: String) {
            val event = LinkEvent(href)
            for (l in listeners) l.onLink(event)
        }

        private fun markDirty() {
            pane.reloadCssStylesheets()
            if (source.isNotEmpty()) syncHtml()
        }

        private fun syncHtml() {
            val body = renderer.render(parser.parse(source.toString()))
            if (rendered == body && pane.text == "<html><body>$body</body></html>") return
            rendered = body
            pane.text = "<html><body>$body</body></html>"
            pane.caretPosition = 0
        }

        private fun buildOverrideStyleSheet(): StyleSheet {
            val sheet = StyleSheet()
            val rules = buildOverrideRulesString()
            if (rules.isNotEmpty()) {
                try {
                    sheet.addRule(rules)
                } catch (err: Exception) {
                    LOG.warn("kind=markdown css=true failed message=${err.message} rules=$rules", err)
                }
            }
            return sheet
        }

        private fun buildOverrideRulesString(): String {
            val rules = StringBuilder()

            val text = mutableListOf<String>()
            foregroundOverride?.let { text.add("color: ${hex(it)}") }
            fontOverride?.let {
                text.add("font-family: '${css(it.name)}', sans-serif")
                text.add("font-size: ${it.size}pt")
                if (it.isItalic) text.add("font-style: italic")
                if (it.isBold) text.add("font-weight: bold")
            }
            if (text.isNotEmpty()) {
                val rule = text.joinToString("; ")
                for (tag in TAGS) rules.append("$tag { $rule } ")
            }

            val body = mutableListOf<String>()
            if (!opaqueState) body.add("background: transparent")
            if (body.isNotEmpty()) rules.append("body { ${body.joinToString("; ")} } ")

            linkColorOverride?.let { rules.append("a { color: ${hex(it)} } ") }
            codeFontOverride?.let { rules.append("tt, code, samp, pre { font-family: '${css(it)}', monospace } ") }
            preBgOverride?.let { rules.append("pre { background: ${hex(it)} } ") }
            preFgOverride?.let { rules.append("pre { color: ${hex(it)} } ") }
            codeBgOverride?.let { rules.append("code { background: ${hex(it)} } ") }
            quoteBorderOverride?.let { rules.append("blockquote { border-left-color: ${hex(it)} } ") }
            quoteFgOverride?.let { rules.append("blockquote { color: ${hex(it)} } ") }
            tableBorderOverride?.let { rules.append("th, td { border-color: ${hex(it)} } ") }

            return rules.toString().trim()
        }
    }
}
