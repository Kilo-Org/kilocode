package ai.kilocode.client.ui.md

import ai.kilocode.client.session.ui.style.SessionEditorStyle
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
        rules.append("ul, ol { color: ${hex(opts.listMarkerFg)} } ")
        rules.append("li { color: ${hex(opts.foreground)} } ")
        rules.append("tt, code, samp, pre { font-family: '${css(opts.codeFont)}', monospace } ")
        rules.append("code { background: ${hex(opts.codeBg)}; color: ${hex(opts.inlineCodeFg)} } ")
        rules.append("pre { background: ${hex(opts.preBg)}; color: ${hex(opts.preFg)}; border-color: ${hex(opts.codeBorder)} } ")
        rules.append("pre code { background: ${hex(opts.preBg)}; color: ${hex(opts.preFg)} } ")
        rules.append("blockquote { border-left-color: ${hex(opts.quoteBorder)}; color: ${hex(opts.quoteFg)} } ")
        rules.append("blockquote p { color: ${hex(opts.quoteFg)} } ")
        rules.append("th, td { border-color: ${hex(opts.tableBorder)} } ")
        rules.append("th { color: ${hex(opts.tableHeaderFg)} } ")
        rules.append("hr { border-color: ${hex(opts.hrColor)} } ")

        return rules.toString().trim()
    }

    fun defaults(style: SessionEditorStyle): MdStyle {
        val weak = fg(style, DefaultLanguageHighlighterColors.DOC_COMMENT)
            ?: fg(style, DefaultLanguageHighlighterColors.LINE_COMMENT)
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
            tableBorder = border,
            headingFg = fg(style, CodeInsightColors.HYPERLINK_ATTRIBUTES) ?: style.editorForeground,
            strongFg = fg(style, HighlighterColors.TEXT) ?: style.editorForeground,
            emphasisFg = weak,
            inlineCodeFg = fg(style, DefaultLanguageHighlighterColors.DOC_CODE_INLINE)
                ?: fg(style, DefaultLanguageHighlighterColors.STRING)
                ?: style.editorForeground,
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
