package ai.kilocode.client.ui.md

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.HighlighterColors
import com.intellij.openapi.editor.colors.CodeInsightColors
import com.intellij.openapi.editor.colors.ColorKey
import com.intellij.openapi.editor.colors.EditorColors
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Color

internal object MdCommon {
    private val pre = Regex("<pre\\b[^>]*>.*?</pre>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
    private val protect = Regex("<pre\\b[^>]*>.*?</pre>|<a\\b[^>]*>.*?</a>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
    private val code = Regex("<code(\\s[^>]*)?>(.*?)</code>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
    private val tag = Regex("<[^>]+>")
    private val ref = Regex("(?<![\\w@:/.-])((?:\\.?[A-Za-z0-9_-]{1,80}/){1,20}[A-Za-z0-9_.-]{1,120}\\.[A-Za-z0-9_-]{1,20}(?::\\d{1,7}(?:-\\d{1,7})?)?|[A-Za-z0-9_.-]{1,120}\\.(?:ts|tsx|js|jsx|mjs|cjs|kt|kts|java|md|mdx|txt|json|jsonc|yaml|yml|toml|xml|html|css|scss|rs|go|py|rb|php|swift|c|h|cpp|hpp|cs|sh|zsh|bash|sql|gradle)(?::\\d{1,7}(?:-\\d{1,7})?)?)")
    private val single = setOf("readme.md", "package.json", "tsconfig.json", "jsconfig.json", "kilo.json", "kilo.jsonc")
    private const val REF_SEGMENT_LIMIT = 16_384

    val tags = listOf(
        "body", "p", "div", "span", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td",
        "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "a", "tt", "code", "samp", "pre",
    )

    fun hex(c: Color): String = String.format("#%02x%02x%02x", c.red, c.green, c.blue)

    fun css(text: String): String = text
        .replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("\n", " ")
        .replace("\r", " ")

    fun inlineCode(html: String, opts: MdStyle): String {
        if (!html.contains('<') && !html.contains('.')) return html
        val color = hex(opts.inlineCodeFg)
        val styled = if (html.contains("<code", ignoreCase = true)) {
            val out = StringBuilder()
            var at = 0
            for (match in pre.findAll(html)) {
                out.append(style(html.substring(at, match.range.first), color))
                out.append(match.value)
                at = match.range.last + 1
            }
            out.append(style(html.substring(at), color))
            out.toString()
        } else {
            html
        }
        return refs(styled)
    }

    fun rules(opts: MdStyle): String {
        val rules = StringBuilder()

        val text = mutableListOf<String>()
        text.add("color: ${hex(opts.foreground)}")
        text.add("font-family: '${css(opts.font.name)}', sans-serif")
        text.add("font-size: ${opts.font.size}pt")
        if (opts.font.isItalic) text.add("font-style: italic")
        if (opts.font.isBold) text.add("font-weight: bold")
        val rule = text.joinToString("; ")
        for (tag in tags) rules.append("$tag { $rule } ")

        val body = mutableListOf<String>()
        if (!opts.opaque) body.add("background: transparent")
        if (body.isNotEmpty()) rules.append("body { ${body.joinToString("; ")} } ")

        rules.append("h1, h2, h3, h4, h5, h6 { color: ${hex(opts.headingFg)} } ")
        rules.append("strong, b { color: ${hex(opts.strongFg)} } ")
        rules.append("em, i { color: ${hex(opts.emphasisFg)} } ")
        rules.append("a { color: ${hex(opts.linkColor)} } ")
        rules.append("a.kilo-file-ref, code a.kilo-file-ref { color: ${hex(SessionUiStyle.View.Markdown.string())}; font-family: '${css(opts.codeFont)}', monospace; text-decoration: underline } ")
        rules.append("ul, ol { color: ${hex(opts.listMarkerFg)} } ")
        rules.append("li { color: ${hex(opts.foreground)} } ")
        rules.append("tt, code, samp, pre, pre code { font-family: '${css(opts.codeFont)}', monospace } ")
        rules.append("pre { background: ${hex(opts.preBg)}; color: ${hex(opts.preFg)}; border-color: ${hex(opts.codeBorder)} } ")
        rules.append("pre code { background: ${hex(opts.preBg)}; color: ${hex(opts.preFg)} } ")
        rules.append("blockquote { background: ${hex(opts.quoteBg)}; border-left-color: ${hex(opts.quoteBorder)}; color: ${hex(opts.quoteFg)} } ")
        rules.append("blockquote p { color: ${hex(opts.quoteFg)} } ")
        rules.append("th, td { border-color: ${hex(opts.tableBorder)} } ")
        rules.append("th { color: ${hex(opts.tableHeaderFg)} } ")
        rules.append("hr { border-color: ${hex(opts.hrColor)} } ")

        return rules.toString().trim()
    }

    fun defaults(style: SessionEditorStyle): MdStyle {
        val weak = fg(style, DefaultLanguageHighlighterColors.LINE_COMMENT)
            ?: fg(style, DefaultLanguageHighlighterColors.DOC_COMMENT)
            ?: UIUtil.getContextHelpForeground()
        val border = color(style, EditorColors.PREVIEW_BORDER_COLOR) ?: UiStyle.Colors.contentBorder()
        val blockBg = bg(style, DefaultLanguageHighlighterColors.DOC_CODE_BLOCK) ?: style.editorBackground
        return MdStyle(
            font = style.transcriptFont,
            foreground = style.editorForeground,
            background = style.editorBackground,
            linkColor = fg(style, CodeInsightColors.HYPERLINK_ATTRIBUTES) ?: JBUI.CurrentTheme.Link.Foreground.ENABLED,
            codeBg = bg(style, DefaultLanguageHighlighterColors.DOC_CODE_INLINE)
                ?: bg(style, DefaultLanguageHighlighterColors.STRING)
                ?: style.editorBackground,
            preBg = blockBg,
            preFg = fg(style, DefaultLanguageHighlighterColors.DOC_CODE_BLOCK) ?: style.editorForeground,
            codeFont = style.editorFamily,
            quoteBorder = border,
            quoteFg = weak,
            quoteBg = blend(style.editorBackground, weak, 0.08),
            tableBorder = border,
            headingFg = fg(style, CodeInsightColors.HYPERLINK_ATTRIBUTES) ?: style.editorForeground,
            strongFg = fg(style, HighlighterColors.TEXT) ?: style.editorForeground,
            emphasisFg = weak,
            inlineCodeFg = SessionUiStyle.View.Markdown.string(),
            listMarkerFg = weak,
            hrColor = border,
            tableHeaderFg = fg(style, HighlighterColors.TEXT) ?: style.editorForeground,
            codeBorder = border,
            opaque = true,
        )
    }

    private fun fg(style: SessionEditorStyle, key: TextAttributesKey): Color? =
        style.editorScheme.getAttributes(key)?.foregroundColor

    private fun bg(style: SessionEditorStyle, key: TextAttributesKey): Color? =
        style.editorScheme.getAttributes(key)?.backgroundColor

    private fun color(style: SessionEditorStyle, key: ColorKey): Color? = style.editorScheme.getColor(key)

    private fun style(html: String, color: String): String = code.replace(html) { match ->
        val attrs = match.groups[1]?.value ?: ""
        val body = match.groups[2]?.value ?: ""
        "<code$attrs style=\"color: $color\">$body</code>"
    }

    private fun refs(html: String): String {
        if (!html.contains('.')) return html
        val out = StringBuilder()
        var at = 0
        for (match in protect.findAll(html)) {
            out.append(tags(html.substring(at, match.range.first)))
            out.append(match.value)
            at = match.range.last + 1
        }
        out.append(tags(html.substring(at)))
        return out.toString()
    }

    private fun tags(html: String): String {
        if (!html.contains('.')) return html
        val out = StringBuilder()
        var at = 0
        for (match in tag.findAll(html)) {
            out.append(paths(html.substring(at, match.range.first)))
            out.append(match.value)
            at = match.range.last + 1
        }
        out.append(paths(html.substring(at)))
        return out.toString()
    }

    private fun paths(text: String): String {
        if (text.length > REF_SEGMENT_LIMIT || !text.contains('.')) return text
        return ref.replace(text) { match ->
            val path = match.value
            if (!pathish(path)) return@replace path
            val href = path.replace(" ", "%20")
                .replace("(", "%28")
                .replace(")", "%29")
            "<a class=\"kilo-file-ref\" href=\"${attr(href)}\">$path</a>"
        }
    }

    private fun pathish(path: String): Boolean {
        if (path.contains('/')) return true
        val name = path.substringBefore(':')
        if (name.lowercase() in single) return true
        val stem = name.substringBeforeLast('.', missingDelimiterValue = name)
        return stem.startsWith('.') || stem.contains('-') || stem.contains('_')
    }

    private fun attr(value: String): String = value
        .replace("&", "&amp;")
        .replace("\"", "&quot;")

    private fun blend(bg: Color, fg: Color, alpha: Double): Color {
        val beta = 1.0 - alpha
        return Color(
            (bg.red * beta + fg.red * alpha).toInt(),
            (bg.green * beta + fg.green * alpha).toInt(),
            (bg.blue * beta + fg.blue * alpha).toInt(),
        )
    }
}

internal data class MdStyle(
    val font: java.awt.Font,
    val foreground: Color,
    val background: Color,
    val linkColor: Color,
    val codeBg: Color,
    val preBg: Color,
    val preFg: Color,
    val codeFont: String,
    val quoteBorder: Color,
    val quoteFg: Color,
    val quoteBg: Color,
    val tableBorder: Color,
    val headingFg: Color,
    val strongFg: Color,
    val emphasisFg: Color,
    val inlineCodeFg: Color,
    val listMarkerFg: Color,
    val hrColor: Color,
    val tableHeaderFg: Color,
    val codeBorder: Color,
    val opaque: Boolean,
)
