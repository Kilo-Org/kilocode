package ai.kilocode.client.ui.md

import ai.kilocode.client.session.ui.style.SessionEditorStyle
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

        rules.append("a { color: ${hex(opts.linkColor)} } ")
        rules.append("tt, code, samp, pre { font-family: '${css(opts.codeFont)}', monospace } ")
        rules.append("pre { background: ${hex(opts.preBg)} } ")
        rules.append("pre { color: ${hex(opts.preFg)} } ")
        rules.append("code { background: ${hex(opts.codeBg)} } ")
        rules.append("blockquote { border-left-color: ${hex(opts.quoteBorder)} } ")
        rules.append("blockquote { color: ${hex(opts.quoteFg)} } ")
        rules.append("th, td { border-color: ${hex(opts.tableBorder)} } ")

        return rules.toString().trim()
    }

    fun defaults(style: SessionEditorStyle) = MdStyle(
        font = style.transcriptFont,
        foreground = com.intellij.util.ui.UIUtil.getLabelForeground(),
        background = style.editorScheme.defaultBackground,
        linkColor = com.intellij.util.ui.JBUI.CurrentTheme.Link.Foreground.ENABLED,
        codeBg = style.editorScheme.defaultBackground,
        preBg = style.editorScheme.defaultBackground,
        preFg = style.editorScheme.defaultForeground,
        codeFont = style.editorFamily,
        quoteBorder = com.intellij.ui.JBColor.border(),
        quoteFg = com.intellij.util.ui.UIUtil.getContextHelpForeground(),
        tableBorder = com.intellij.ui.JBColor.border(),
        opaque = true,
    )
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
    val opaque: Boolean,
)
