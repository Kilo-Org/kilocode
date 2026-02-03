package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.services.KiloStateService
import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloSpacing
import ai.kilo.plugin.toolwindow.KiloSizes
import com.intellij.openapi.Disposable
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import java.awt.*
import java.awt.geom.RoundRectangle2D
import javax.swing.*

/**
 * Right sidebar panel containing:
 * - VCS info panel (shows current git branch)
 * - Todo panel (only visible when incomplete todos exist)
 * - Future: MCP servers section, session stats
 * 
 * Responsive behavior (matching web client):
 * - Wide screens (>600px): Shows as inline panel (fixed 240px width)
 * - Narrow screens: Hidden by default, shows as overlay when toggled
 */
class SidebarPanel(
    private val stateService: KiloStateService
) : JPanel(BorderLayout()), Disposable {

    private val vcsInfoPanel = VcsInfoPanel(stateService)
    private val todoPanel = TodoPanel(stateService)

    init {
        // No fixed width - let JBSplitter control sizing
        minimumSize = Dimension(200, 0)

        isOpaque = true
        background = KiloTheme.backgroundStronger
        border = BorderFactory.createCompoundBorder(
            JBUI.Borders.customLine(KiloTheme.borderWeak, 0, 1, 0, 0),
            JBUI.Borders.empty(KiloSpacing.md)
        )

        // Content panel with vertical layout
        val contentPanel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
        }

        // Add VCS info panel (shows git branch)
        vcsInfoPanel.alignmentX = LEFT_ALIGNMENT
        contentPanel.add(vcsInfoPanel)

        // Add todo panel
        todoPanel.alignmentX = LEFT_ALIGNMENT
        contentPanel.add(todoPanel)

        // Future: Add MCP servers section here
        // Future: Add session stats section here

        add(contentPanel, BorderLayout.NORTH)

        // Bottom section: SimpleInput + feedback label
        val bottomPanel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false

            // SimpleInput for testing
            val testInput = SimpleInput()
            testInput.alignmentX = CENTER_ALIGNMENT
            add(testInput)

            add(Box.createVerticalStrut(KiloSpacing.md))

            // Feedback label
            val feedbackLabel = JLabel("Share feedback ↗").apply {
                foreground = KiloTheme.textWeak
                font = font.deriveFont(Font.PLAIN, 12f)
                alignmentX = CENTER_ALIGNMENT
                cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            }
            add(feedbackLabel)
        }
        add(bottomPanel, BorderLayout.SOUTH)
    }

    override fun dispose() {
        vcsInfoPanel.dispose()
        todoPanel.dispose()
    }
}

/**
 * Simple input - exact copy from live plugin for testing.
 */
private class SimpleInput : JPanel(BorderLayout()) {

    private val focusedColor = Color(0x3574F0)
    private val unfocusedColor = Color(0xC9CCD6)
    private var borderColor = unfocusedColor
    private var isFocused = false

    // TOP PANEL: text editor area
    private val topPanel = JPanel(BorderLayout()).apply {
        isOpaque = false
        border = JBUI.Borders.empty(8, 10, 4, 10)

        val textArea = JBTextArea().apply {
            lineWrap = true
            wrapStyleWord = true
            rows = 2
            border = JBUI.Borders.empty()
            isOpaque = false

            addFocusListener(object : java.awt.event.FocusAdapter() {
                override fun focusGained(e: java.awt.event.FocusEvent?) {
                    borderColor = focusedColor
                    isFocused = true
                    this@SimpleInput.repaint()
                }
                override fun focusLost(e: java.awt.event.FocusEvent?) {
                    borderColor = unfocusedColor
                    isFocused = false
                    this@SimpleInput.repaint()
                }
            })
        }

        val scrollPane = JBScrollPane(textArea).apply {
            border = JBUI.Borders.empty()
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            isOpaque = false
            viewport.isOpaque = false
        }

        add(scrollPane, BorderLayout.CENTER)
    }

    private var selectedModel = "Claude 4.5 Opus"
    private val modelLabel = JLabel("$selectedModel ▾").apply {
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    // BOTTOM PANEL: toolbar
    private val bottomPanel = JPanel(BorderLayout()).apply {
        isOpaque = false
        border = JBUI.Borders.empty(4, 10, 8, 10)

        val leftPanel = JPanel(FlowLayout(FlowLayout.LEFT, 8, 0)).apply {
            isOpaque = false
            add(JLabel("+"))
            add(JLabel("Chat"))
        }

        val rightPanel = JPanel(FlowLayout(FlowLayout.RIGHT, 8, 0)).apply {
            isOpaque = false
            add(modelLabel)
            add(JLabel("▷"))
        }

        add(leftPanel, BorderLayout.WEST)
        add(rightPanel, BorderLayout.EAST)
    }

    private fun createModelPopup(): JPopupMenu {
        return JPopupMenu().apply {
            // Title
            add(JLabel("  Model").apply {
                font = font.deriveFont(Font.BOLD)
                border = JBUI.Borders.empty(8, 8, 4, 8)
            })
            addSeparator()

            // Auto option
            add(createModelMenuItem("Auto", "GPT-5.2", selectedModel == "Auto"))

            addSeparator()

            // Claude models
            add(createModelMenuItem("Claude 4.5 Haiku", null, selectedModel == "Claude 4.5 Haiku"))
            add(createModelMenuItem("Claude 4.5 Opus", null, selectedModel == "Claude 4.5 Opus"))
            add(createModelMenuItem("Claude 4.5 Sonnet", null, selectedModel == "Claude 4.5 Sonnet"))
            add(createModelMenuItem("Claude 4 Sonnet", null, selectedModel == "Claude 4 Sonnet"))

            addSeparator()

            // Other models
            add(createModelMenuItem("Gemini 3 Flash", null, selectedModel == "Gemini 3 Flash"))
            add(createModelMenuItem("Gemini 3 Pro", null, selectedModel == "Gemini 3 Pro"))
            add(createModelMenuItem("GPT-4o", null, selectedModel == "GPT-4o"))
            add(createModelMenuItem("GPT-5.1", null, selectedModel == "GPT-5.1"))
            add(createModelMenuItem("GPT-5.2", null, selectedModel == "GPT-5.2"))

            addSeparator()

            // More options
            add(JMenuItem("More Models..."))

            addSeparator()

            add(JLabel("  Third-Party Providers").apply {
                font = font.deriveFont(Font.BOLD, 11f)
                foreground = Color.GRAY
                border = JBUI.Borders.empty(4, 8)
            })
            add(JMenuItem("Manage Models..."))
        }
    }

    private fun createModelMenuItem(name: String, subtitle: String?, isSelected: Boolean): JMenuItem {
        val text = if (subtitle != null) "$name  $subtitle" else name
        return JMenuItem(text).apply {
            if (isSelected) {
                icon = UIManager.getIcon("CheckBoxMenuItem.checkIcon")
            }
            addActionListener {
                selectedModel = name
                modelLabel.text = "$name ▾"
            }
        }
    }

    init {
        isOpaque = false
        isDoubleBuffered = true
        background = JBColor.WHITE
        border = JBUI.Borders.empty(2)
        preferredSize = Dimension(220, 120)

        // Two panels stacked
        add(topPanel, BorderLayout.CENTER)
        add(bottomPanel, BorderLayout.SOUTH)

        // Model selector click handler
        modelLabel.addMouseListener(object : java.awt.event.MouseAdapter() {
            override fun mouseClicked(e: java.awt.event.MouseEvent) {
                val popup = createModelPopup()
                popup.show(modelLabel, 0, -popup.preferredSize.height)
            }
        })
    }

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)

        val radius = 12f
        val strokeWidth = if (isFocused) 2f else 1.5f
        val offset = strokeWidth / 2f

        // Fill background
        g2.color = background
        g2.fill(RoundRectangle2D.Float(
            strokeWidth, strokeWidth,
            width - strokeWidth * 2, height - strokeWidth * 2,
            radius, radius
        ))

        // Draw border
        g2.color = borderColor
        g2.stroke = BasicStroke(strokeWidth)
        g2.draw(RoundRectangle2D.Float(
            offset, offset,
            width - strokeWidth, height - strokeWidth,
            radius, radius
        ))

        g2.dispose()
    }
}
