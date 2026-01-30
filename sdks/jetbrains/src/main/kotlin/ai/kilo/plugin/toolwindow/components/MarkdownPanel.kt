package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloSpacing
import ai.kilo.plugin.toolwindow.KiloTypography
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.colors.EditorFontType
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.vladsch.flexmark.ext.autolink.AutolinkExtension
import com.vladsch.flexmark.ext.gfm.strikethrough.StrikethroughExtension
import com.vladsch.flexmark.ext.tables.TablesExtension
import com.vladsch.flexmark.html.HtmlRenderer
import com.vladsch.flexmark.parser.Parser
import com.vladsch.flexmark.util.data.MutableDataSet
import java.awt.*
import java.awt.datatransfer.StringSelection
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.*
import javax.swing.event.HyperlinkEvent
import javax.swing.text.html.HTMLEditorKit
import javax.swing.text.html.StyleSheet

/**
 * Panel that renders markdown content with proper formatting and syntax highlighting.
 * Uses flexmark for markdown parsing and custom rendering for code blocks.
 */
class MarkdownPanel(
    private val project: Project? = null
) : JPanel() {

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

        /**
         * Parse markdown to HTML.
         */
        fun parseMarkdown(markdown: String): String {
            val document = parser.parse(markdown)
            return renderer.render(document)
        }
    }

    private val contentPanel = JPanel().apply {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        isOpaque = false
    }

    init {
        layout = BorderLayout()
        isOpaque = false
        add(contentPanel, BorderLayout.CENTER)
    }

    /**
     * Set the markdown content to render.
     */
    fun setMarkdown(markdown: String) {
        contentPanel.removeAll()

        // Split content into code blocks and regular text
        val parts = splitIntoCodeBlocksAndText(markdown)

        for (part in parts) {
            val component = when (part) {
                is ContentPart.CodeBlock -> createCodeBlockPanel(part.language, part.code)
                is ContentPart.Text -> createTextPanel(part.text)
            }
            component.alignmentX = Component.LEFT_ALIGNMENT
            contentPanel.add(component)
            contentPanel.add(Box.createVerticalStrut(KiloSpacing.xs))
        }

        contentPanel.revalidate()
        contentPanel.repaint()
    }

    /**
     * Split markdown into code blocks and regular text parts.
     */
    private fun splitIntoCodeBlocksAndText(markdown: String): List<ContentPart> {
        val parts = mutableListOf<ContentPart>()
        val codeBlockPattern = Regex("```(\\w*)\\n([\\s\\S]*?)```", RegexOption.MULTILINE)

        var lastEnd = 0
        for (match in codeBlockPattern.findAll(markdown)) {
            // Add text before code block
            if (match.range.first > lastEnd) {
                val text = markdown.substring(lastEnd, match.range.first).trim()
                if (text.isNotEmpty()) {
                    parts.add(ContentPart.Text(text))
                }
            }

            // Add code block
            val language = match.groupValues[1].ifEmpty { "text" }
            val code = match.groupValues[2].trimEnd()
            parts.add(ContentPart.CodeBlock(language, code))

            lastEnd = match.range.last + 1
        }

        // Add remaining text
        if (lastEnd < markdown.length) {
            val text = markdown.substring(lastEnd).trim()
            if (text.isNotEmpty()) {
                parts.add(ContentPart.Text(text))
            }
        }

        // If no parts found, treat entire content as text
        if (parts.isEmpty() && markdown.isNotBlank()) {
            parts.add(ContentPart.Text(markdown))
        }

        return parts
    }

    /**
     * Create a panel for rendering regular markdown text.
     */
    private fun createTextPanel(text: String): JComponent {
        val html = parseMarkdown(text)
        val styledHtml = wrapWithStyles(html)

        val editorPane = JEditorPane().apply {
            contentType = "text/html"
            isEditable = false
            isOpaque = false
            border = JBUI.Borders.empty()

            // Custom editor kit with styled CSS
            editorKit = createStyledEditorKit()

            // Set content
            this.text = styledHtml

            // Handle hyperlinks
            addHyperlinkListener { e ->
                if (e.eventType == HyperlinkEvent.EventType.ACTIVATED) {
                    BrowserUtil.browse(e.url)
                }
            }
        }

        return editorPane
    }

    /**
     * Create a panel for code blocks with syntax highlighting.
     */
    private fun createCodeBlockPanel(language: String, code: String): JComponent {
        val panel = JPanel(BorderLayout()).apply {
            isOpaque = true
            background = KiloTheme.surfaceInsetBase
            border = JBUI.Borders.compound(
                JBUI.Borders.customLine(KiloTheme.borderWeak),
                JBUI.Borders.empty(0)
            )
        }

        // Header with language and copy button
        val header = JPanel(BorderLayout()).apply {
            isOpaque = true
            background = KiloTheme.surfaceRaisedBase
            border = JBUI.Borders.empty(KiloSpacing.xs, KiloSpacing.md)

            val langLabel = JBLabel(language.ifEmpty { "code" }).apply {
                foreground = KiloTheme.textWeak
                font = font.deriveFont(KiloTypography.fontSizeXSmall - 1)
            }
            add(langLabel, BorderLayout.WEST)

            val copyButton = JButton("Copy").apply {
                font = font.deriveFont(KiloTypography.fontSizeXSmall - 1)
                isFocusable = false
                cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
                isContentAreaFilled = false
                isBorderPainted = false
                foreground = KiloTheme.textWeak

                addMouseListener(object : MouseAdapter() {
                    override fun mouseEntered(e: MouseEvent) {
                        foreground = KiloTheme.textStrong
                    }
                    override fun mouseExited(e: MouseEvent) {
                        foreground = KiloTheme.textWeak
                    }
                })

                addActionListener {
                    CopyPasteManager.getInstance().setContents(StringSelection(code))
                    text = "Copied!"
                    Timer(1500) { text = "Copy" }.apply {
                        isRepeats = false
                        start()
                    }
                }
            }
            add(copyButton, BorderLayout.EAST)
        }
        panel.add(header, BorderLayout.NORTH)

        // Code content with syntax highlighting
        val codeArea = createHighlightedCodeArea(language, code)
        val scrollPane = JScrollPane(codeArea).apply {
            border = JBUI.Borders.empty()
            isOpaque = false
            viewport.isOpaque = false
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER
        }
        panel.add(scrollPane, BorderLayout.CENTER)

        return panel
    }

    /**
     * Create a code area with syntax highlighting.
     */
    private fun createHighlightedCodeArea(language: String, code: String): JTextArea {
        val scheme = EditorColorsManager.getInstance().globalScheme
        val editorFont = scheme.getFont(EditorFontType.PLAIN)

        return JTextArea(code).apply {
            isEditable = false
            isOpaque = true
            background = KiloTheme.surfaceInsetBase
            foreground = KiloTheme.textBase
            font = Font(editorFont.family, Font.PLAIN, KiloTypography.fontSizeSmall.toInt())
            border = JBUI.Borders.empty(KiloSpacing.md)
            tabSize = 2

            // Apply basic syntax highlighting via foreground colors
            // For full highlighting, we'd need to integrate with IntelliJ's lexer system
            // This is a simplified version that handles common patterns
            highlightSyntax(this, language)
        }
    }

    /**
     * Apply basic syntax highlighting to the text area.
     * Note: For full IDE-level highlighting, we'd need to use EditorTextField with a language.
     */
    private fun highlightSyntax(textArea: JTextArea, language: String) {
        // For now, we use a monochrome approach with the editor font
        // Full syntax highlighting would require using IntelliJ's syntax highlighter
        // which is complex to integrate with a plain JTextArea
    }

    /**
     * Create a styled HTML editor kit.
     * Note: Java Swing's CSS parser only supports a subset of CSS2.
     * Properties like border-radius, overflow-x are not supported.
     */
    private fun createStyledEditorKit(): HTMLEditorKit {
        val kit = HTMLEditorKit()
        val styleSheet = StyleSheet()

        val textColor = colorToHex(KiloTheme.textBase)
        val textStrong = colorToHex(KiloTheme.textStrong)
        val linkColor = colorToHex(KiloTheme.textInteractive)
        val codeBackground = colorToHex(KiloTheme.surfaceInsetBase)
        val borderColor = colorToHex(KiloTheme.borderWeak)
        val blockquoteColor = colorToHex(KiloTheme.textWeak)

        // Note: Using only CSS2 properties supported by Swing's StyleSheet
        styleSheet.addRule("body { font-family: ${UIUtil.getLabelFont().family}; font-size: ${KiloTypography.fontSizeBase.toInt()}pt; color: $textColor; margin: 0; padding: 0; }")
        styleSheet.addRule("p { margin-top: ${KiloSpacing.xs}px; margin-bottom: ${KiloSpacing.xs}px; }")
        styleSheet.addRule("a { color: $linkColor; }")
        styleSheet.addRule("code { font-family: monospace; background-color: $codeBackground; padding: 2px; }")
        styleSheet.addRule("pre { font-family: monospace; background-color: $codeBackground; padding: ${KiloSpacing.md}px; }")
        styleSheet.addRule("blockquote { border-left-width: 3px; border-left-style: solid; border-left-color: $borderColor; margin-top: ${KiloSpacing.md}px; margin-bottom: ${KiloSpacing.md}px; padding-left: ${KiloSpacing.lg}px; color: $blockquoteColor; }")
        styleSheet.addRule("ul { margin-top: ${KiloSpacing.xs}px; margin-bottom: ${KiloSpacing.xs}px; margin-left: 20px; }")
        styleSheet.addRule("ol { margin-top: ${KiloSpacing.xs}px; margin-bottom: ${KiloSpacing.xs}px; margin-left: 20px; }")
        styleSheet.addRule("li { margin-top: 2px; margin-bottom: 2px; }")
        styleSheet.addRule("h1 { font-size: ${KiloTypography.fontSizeXLarge.toInt()}pt; color: $textStrong; margin-top: ${KiloSpacing.lg}px; margin-bottom: ${KiloSpacing.md}px; }")
        styleSheet.addRule("h2 { font-size: ${KiloTypography.fontSizeLarge.toInt()}pt; color: $textStrong; margin-top: ${KiloSpacing.lg}px; margin-bottom: ${KiloSpacing.sm}px; }")
        styleSheet.addRule("h3 { font-size: ${KiloTypography.fontSizeMedium.toInt()}pt; color: $textStrong; margin-top: ${KiloSpacing.md}px; margin-bottom: ${KiloSpacing.xs}px; }")
        styleSheet.addRule("table { margin-top: ${KiloSpacing.md}px; margin-bottom: ${KiloSpacing.md}px; }")
        styleSheet.addRule("th { border-width: 1px; border-style: solid; border-color: $borderColor; padding: ${KiloSpacing.sm}px; background-color: $codeBackground; color: $textStrong; }")
        styleSheet.addRule("td { border-width: 1px; border-style: solid; border-color: $borderColor; padding: ${KiloSpacing.sm}px; }")

        kit.styleSheet = styleSheet
        return kit
    }

    /**
     * Wrap HTML content with styled body.
     */
    private fun wrapWithStyles(html: String): String {
        return "<html><body>$html</body></html>"
    }

    /**
     * Convert a Color to hex string.
     */
    private fun colorToHex(color: Color): String {
        return String.format("#%02x%02x%02x", color.red, color.green, color.blue)
    }

    /**
     * Sealed class for content parts.
     */
    private sealed class ContentPart {
        data class Text(val text: String) : ContentPart()
        data class CodeBlock(val language: String, val code: String) : ContentPart()
    }
}
