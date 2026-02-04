package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloSpacing
import ai.kilo.plugin.toolwindow.KiloTypography
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.EditorSettings
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.colors.EditorFontType
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.editor.highlighter.EditorHighlighterFactory
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.testFramework.LightVirtualFile
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
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
 * Uses flexmark for markdown parsing and IntelliJ's Editor for code blocks with syntax highlighting.
 */
class MarkdownPanel(
    private val project: Project? = null,
    private val parentDisposable: Disposable? = null
) : JPanel(), Disposable {

    private val editors = mutableListOf<Editor>()

    companion object {
        /**
         * Map language identifiers to file extensions for syntax highlighting.
         */
        private val languageToExtension = mapOf(
            "kotlin" to "kt",
            "kt" to "kt",
            "java" to "java",
            "javascript" to "js",
            "js" to "js",
            "typescript" to "ts",
            "ts" to "ts",
            "python" to "py",
            "py" to "py",
            "rust" to "rs",
            "rs" to "rs",
            "go" to "go",
            "c" to "c",
            "cpp" to "cpp",
            "c++" to "cpp",
            "csharp" to "cs",
            "cs" to "cs",
            "ruby" to "rb",
            "rb" to "rb",
            "php" to "php",
            "swift" to "swift",
            "scala" to "scala",
            "html" to "html",
            "css" to "css",
            "scss" to "scss",
            "sass" to "sass",
            "less" to "less",
            "json" to "json",
            "xml" to "xml",
            "yaml" to "yaml",
            "yml" to "yml",
            "toml" to "toml",
            "markdown" to "md",
            "md" to "md",
            "sql" to "sql",
            "shell" to "sh",
            "bash" to "sh",
            "sh" to "sh",
            "zsh" to "sh",
            "powershell" to "ps1",
            "ps1" to "ps1",
            "dockerfile" to "dockerfile",
            "docker" to "dockerfile",
            "groovy" to "groovy",
            "gradle" to "gradle",
            "lua" to "lua",
            "perl" to "pl",
            "r" to "r",
            "dart" to "dart",
            "vue" to "vue",
            "svelte" to "svelte",
            "jsx" to "jsx",
            "tsx" to "tsx"
        )

        fun getFileTypeForLanguage(language: String): FileType {
            val extension = languageToExtension[language.lowercase()] ?: language.lowercase()
            val fileType = FileTypeManager.getInstance().getFileTypeByExtension(extension)
            return if (fileType.name == "UNKNOWN") PlainTextFileType.INSTANCE else fileType
        }
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

    // Track current markdown content for incremental updates
    private var currentMarkdown: String = ""

    init {
        layout = BorderLayout()
        isOpaque = false
        add(contentPanel, BorderLayout.CENTER)

        // Register for disposal
        parentDisposable?.let { Disposer.register(it, this) }
    }

    override fun dispose() {
        releaseAllEditors()
    }

    private fun releaseAllEditors() {
        val editorFactory = EditorFactory.getInstance()
        editors.forEach { editor ->
            try {
                editorFactory.releaseEditor(editor)
            } catch (e: Exception) {
                // Editor may already be disposed
            }
        }
        editors.clear()
    }

    /**
     * Set the markdown content to render.
     */
    fun setMarkdown(markdown: String) {
        currentMarkdown = markdown

        // Release any existing editors before clearing content
        releaseAllEditors()
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
     * Append text delta to the current markdown content.
     * Optimized for streaming - only updates the last text component if no new code blocks.
     */
    fun appendText(delta: String) {
        val oldMarkdown = currentMarkdown
        currentMarkdown += delta

        // Check if delta introduces new code blocks
        val oldCodeBlockCount = "```".toRegex().findAll(oldMarkdown).count()
        val newCodeBlockCount = "```".toRegex().findAll(currentMarkdown).count()

        if (oldCodeBlockCount == newCodeBlockCount && contentPanel.componentCount > 0) {
            // No new code blocks - try to update last text component in place
            val lastIndex = contentPanel.componentCount - 1
            // Skip the spacer (Box.Filler) if present
            val componentIndex = if (lastIndex > 0 && contentPanel.getComponent(lastIndex) is Box.Filler) lastIndex - 1 else lastIndex
            val lastComponent = contentPanel.getComponent(componentIndex)

            if (lastComponent is JEditorPane) {
                // Update the last text panel in place
                val parts = splitIntoCodeBlocksAndText(currentMarkdown)
                val lastPart = parts.lastOrNull()
                if (lastPart is ContentPart.Text) {
                    val html = parseMarkdown(lastPart.text)
                    val styledHtml = wrapWithStyles(html)
                    lastComponent.text = styledHtml
                    lastComponent.caretPosition = 0
                    return
                }
            }
        }

        // Fall back to full re-render if code blocks changed or can't update in place
        setMarkdown(currentMarkdown)
    }

    /**
     * Get the current markdown content.
     */
    fun getMarkdown(): String = currentMarkdown

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
     * Create a panel for code blocks with syntax highlighting using IntelliJ's Editor.
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

        // Code content with syntax highlighting using IntelliJ's Editor
        val editorComponent = createEditorComponent(language, code)
        panel.add(editorComponent, BorderLayout.CENTER)

        return panel
    }

    /**
     * Create an IntelliJ Editor component with proper syntax highlighting.
     */
    private fun createEditorComponent(language: String, code: String): JComponent {
        val editorFactory = EditorFactory.getInstance()

        // Create a LightVirtualFile with the correct file type for syntax highlighting
        val fileType = getFileTypeForLanguage(language)
        val extension = languageToExtension[language.lowercase()] ?: language.lowercase().ifEmpty { "txt" }
        val virtualFile = LightVirtualFile("snippet.$extension", fileType, code)

        val document = editorFactory.createDocument(code)

        // Create a read-only viewer
        val editor = editorFactory.createViewer(document, project)
        editors.add(editor)

        // Configure the editor
        val editorEx = editor as? EditorEx
        if (editorEx != null) {
            // Set up syntax highlighting using the virtual file
            val scheme = EditorColorsManager.getInstance().globalScheme
            val highlighter = EditorHighlighterFactory.getInstance()
                .createEditorHighlighter(project, virtualFile)
            editorEx.highlighter = highlighter

            // Configure editor appearance
            editorEx.setCaretVisible(false)
            editorEx.setCaretEnabled(false)
            editorEx.backgroundColor = KiloTheme.surfaceInsetBase

            // Configure gutter (line numbers area)
            editorEx.gutterComponentEx.apply {
                setPaintBackground(false)
            }
        }

        // Configure editor settings
        editor.settings.apply {
            isLineNumbersShown = false
            isLineMarkerAreaShown = false
            isFoldingOutlineShown = false
            isRightMarginShown = false
            additionalLinesCount = 0
            additionalColumnsCount = 0
            isAdditionalPageAtBottom = false
            isVirtualSpace = false
            isUseSoftWraps = false
            isCaretRowShown = false
            isShowIntentionBulb = false
            isIndentGuidesShown = false
            isAnimatedScrolling = false
            isAutoCodeFoldingEnabled = false
        }

        // Wrap in a panel with padding
        val editorPanel = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.empty(KiloSpacing.sm, KiloSpacing.md)
            add(editor.component, BorderLayout.CENTER)
        }

        // Calculate and set preferred height based on line count
        val lineCount = code.lines().size
        val lineHeight = editor.lineHeight
        val preferredHeight = (lineCount * lineHeight) + (KiloSpacing.sm * 2)
        editorPanel.preferredSize = Dimension(editorPanel.preferredSize.width, preferredHeight)

        return editorPanel
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
