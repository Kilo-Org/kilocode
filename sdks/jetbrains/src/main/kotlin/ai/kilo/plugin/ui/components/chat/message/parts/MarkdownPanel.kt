package ai.kilo.plugin.ui.components.chat.message.parts

import com.intellij.ide.BrowserUtil
import com.intellij.openapi.Disposable
import com.intellij.util.ui.JBUI
import com.vladsch.flexmark.ext.autolink.AutolinkExtension
import com.vladsch.flexmark.ext.gfm.strikethrough.StrikethroughExtension
import com.vladsch.flexmark.ext.tables.TablesExtension
import com.vladsch.flexmark.html.HtmlRenderer
import com.vladsch.flexmark.parser.Parser
import com.vladsch.flexmark.util.data.MutableDataSet
import java.awt.*
import javax.swing.*
import javax.swing.event.HyperlinkEvent
import javax.swing.text.html.HTMLEditorKit

/**
 * Panel that renders markdown content.
 * Uses flexmark for markdown parsing, JTextArea for code blocks.
 */
class MarkdownPanel(
    private val parentDisposable: Disposable? = null
) : JPanel(), Disposable {

    companion object {
        private val options = MutableDataSet().apply {
            set(Parser.EXTENSIONS, listOf(
                TablesExtension.create(),
                StrikethroughExtension.create(),
                AutolinkExtension.create()
            ))
            set(HtmlRenderer.SOFT_BREAK, "<br />\n")
            set(HtmlRenderer.HARD_BREAK, "<br />\n")
        }

        private val parser: Parser = Parser.builder(options).build()
        private val renderer: HtmlRenderer = HtmlRenderer.builder(options).build()

        fun parseMarkdown(markdown: String): String {
            val document = parser.parse(markdown)
            return renderer.render(document)
        }
    }

    private val contentPanel = JPanel().apply {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        isOpaque = false
    }

    private var currentMarkdown: String = ""

    init {
        layout = BorderLayout()
        isOpaque = false
        add(contentPanel, BorderLayout.CENTER)
    }

    override fun dispose() {}

    fun setMarkdown(markdown: String) {
        currentMarkdown = markdown
        contentPanel.removeAll()

        val parts = splitIntoCodeBlocksAndText(markdown)

        for (part in parts) {
            val component = when (part) {
                is ContentPart.CodeBlock -> createCodeBlockPanel(part.language, part.code)
                is ContentPart.Text -> createTextPanel(part.text)
            }
            component.alignmentX = Component.LEFT_ALIGNMENT
            contentPanel.add(component)
            contentPanel.add(Box.createVerticalStrut(4))
        }

        contentPanel.revalidate()
        contentPanel.repaint()
    }

    fun appendText(delta: String) {
        val oldMarkdown = currentMarkdown
        currentMarkdown += delta

        val oldCodeBlockCount = "```".toRegex().findAll(oldMarkdown).count()
        val newCodeBlockCount = "```".toRegex().findAll(currentMarkdown).count()

        if (oldCodeBlockCount == newCodeBlockCount && contentPanel.componentCount > 0) {
            val lastIndex = contentPanel.componentCount - 1
            val componentIndex = if (lastIndex > 0 && contentPanel.getComponent(lastIndex) is Box.Filler) lastIndex - 1 else lastIndex
            val lastComponent = contentPanel.getComponent(componentIndex)

            if (lastComponent is JEditorPane) {
                val parts = splitIntoCodeBlocksAndText(currentMarkdown)
                val lastPart = parts.lastOrNull()
                if (lastPart is ContentPart.Text) {
                    val html = parseMarkdown(lastPart.text)
                    lastComponent.text = "<html><body>$html</body></html>"
                    lastComponent.caretPosition = 0
                    return
                }
            }
        }

        setMarkdown(currentMarkdown)
    }

    fun getMarkdown(): String = currentMarkdown

    private fun splitIntoCodeBlocksAndText(markdown: String): List<ContentPart> {
        val parts = mutableListOf<ContentPart>()
        val codeBlockPattern = Regex("```(\\w*)\\n([\\s\\S]*?)```", RegexOption.MULTILINE)

        var lastEnd = 0
        for (match in codeBlockPattern.findAll(markdown)) {
            if (match.range.first > lastEnd) {
                val text = markdown.substring(lastEnd, match.range.first).trim()
                if (text.isNotEmpty()) {
                    parts.add(ContentPart.Text(text))
                }
            }

            val language = match.groupValues[1].ifEmpty { "code" }
            val code = match.groupValues[2].trimEnd()
            parts.add(ContentPart.CodeBlock(language, code))

            lastEnd = match.range.last + 1
        }

        if (lastEnd < markdown.length) {
            val text = markdown.substring(lastEnd).trim()
            if (text.isNotEmpty()) {
                parts.add(ContentPart.Text(text))
            }
        }

        if (parts.isEmpty() && markdown.isNotBlank()) {
            parts.add(ContentPart.Text(markdown))
        }

        return parts
    }

    private fun createTextPanel(text: String): JComponent {
        val html = parseMarkdown(text)

        return JEditorPane().apply {
            contentType = "text/html"
            isEditable = false
            isOpaque = false
            border = JBUI.Borders.empty()
            editorKit = createStyledEditorKit()
            this.text = "<html><body>$html</body></html>"

            addHyperlinkListener { e ->
                if (e.eventType == HyperlinkEvent.EventType.ACTIVATED) {
                    BrowserUtil.browse(e.url)
                }
            }
        }
    }

    private fun createCodeBlockPanel(language: String, code: String): JComponent {
        val panel = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = BorderFactory.createEmptyBorder(4, 0, 4, 0)
        }

        // Language label
        if (language.isNotEmpty() && language != "code") {
            panel.add(JLabel(language).apply {
                foreground = UIManager.getColor("Label.disabledForeground") ?: Color.GRAY
                font = font.deriveFont(10f)
                border = JBUI.Borders.empty(0, 0, 2, 0)
            }, BorderLayout.NORTH)
        }

        // Code content
        val textArea = JTextArea(code).apply {
            isEditable = false
            font = Font(Font.MONOSPACED, Font.PLAIN, 12)
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(Color.LIGHT_GRAY),
                BorderFactory.createEmptyBorder(4, 4, 4, 4)
            )
            tabSize = 4
        }
        panel.add(textArea, BorderLayout.CENTER)

        return panel
    }

    private fun createStyledEditorKit(): HTMLEditorKit {
        val kit = HTMLEditorKit()
        val styleSheet = javax.swing.text.html.StyleSheet()

        val fontFamily = javax.swing.UIManager.getFont("Label.font")?.family ?: "Dialog"

        styleSheet.addRule("body { font-family: $fontFamily; font-size: 14pt; margin: 0; padding: 0; }")
        styleSheet.addRule("p { margin: 4px 0; }")
        styleSheet.addRule("h1 { font-size: 14pt; font-weight: bold; margin: 8px 0 4px 0; }")
        styleSheet.addRule("h2 { font-size: 13pt; font-weight: bold; margin: 6px 0 4px 0; }")
        styleSheet.addRule("h3 { font-size: 12pt; font-weight: bold; margin: 4px 0 2px 0; }")
        styleSheet.addRule("ul, ol { margin: 4px 0 4px 20px; }")
        styleSheet.addRule("li { margin: 2px 0; }")
        styleSheet.addRule("code { font-family: monospace; }")
        styleSheet.addRule("pre { font-family: monospace; }")

        kit.styleSheet = styleSheet
        return kit
    }

    private sealed class ContentPart {
        data class Text(val text: String) : ContentPart()
        data class CodeBlock(val language: String, val code: String) : ContentPart()
    }
}
