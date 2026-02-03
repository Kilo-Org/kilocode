package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.services.KiloStateService
import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloSpacing
import ai.kilo.plugin.toolwindow.KiloSizes
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import java.awt.*
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
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


// ========== Mode Data ==========

private data class Mode(val id: String, val label: String, val description: String, val icon: Icon)

private val modes = listOf(
    Mode("architect", "Architect", "Plan and design before implementation", AllIcons.Actions.ProjectDirectory),
    Mode("code", "Code", "Write, modify, and refactor code", AllIcons.Actions.EditSource),
    Mode("ask", "Ask", "Get answers and explanations", AllIcons.Actions.Help),
    Mode("debug", "Debug", "Diagnose and fix software issues", AllIcons.Actions.StartDebugger),
    Mode("orchestrator", "Orchestrator", "Coordinate tasks across multiple modes", AllIcons.Actions.Execute)
)

// ========== Mode Selector Component ==========

private class ModeSelector : JPanel(FlowLayout(FlowLayout.LEFT, 4, 0)) {

    private var selectedMode = modes[1] // Default to Code
    private val modeIcon = JBLabel(selectedMode.icon)
    private val modeLabel = JBLabel(selectedMode.label)
    private val chevron = JBLabel("\u25BE") // Down triangle

    init {
        isOpaque = false
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)

        modeLabel.foreground = Color(0x6C707E)
        modeLabel.font = modeLabel.font.deriveFont(13f)

        chevron.foreground = Color(0x6C707E)
        chevron.font = chevron.font.deriveFont(10f)

        add(modeIcon)
        add(modeLabel)
        add(chevron)

        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                showModePopup()
            }
            override fun mouseEntered(e: MouseEvent) {
                modeLabel.foreground = Color(0x3574F0)
                chevron.foreground = Color(0x3574F0)
            }
            override fun mouseExited(e: MouseEvent) {
                modeLabel.foreground = Color(0x6C707E)
                chevron.foreground = Color(0x6C707E)
            }
        })
    }

    private fun showModePopup() {
        val panel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            background = JBColor.background()
            border = JBUI.Borders.empty()
        }

        // Header with keyboard shortcut hint
        val header = JBLabel("Ctrl + . for next mode, Ctrl + Shift + . for previous mode").apply {
            foreground = Color(0x9CA3AF)
            font = font.deriveFont(11f)
            border = JBUI.Borders.empty(6, 12, 4, 12)
            alignmentX = Component.LEFT_ALIGNMENT
        }
        panel.add(header)

        // Mode items
        for (mode in modes) {
            val item = createModeItem(mode, mode.id == selectedMode.id)
            item.alignmentX = Component.LEFT_ALIGNMENT
            panel.add(item)
        }

        val popup = JBPopupFactory.getInstance()
            .createComponentPopupBuilder(panel, null)
            .setFocusable(true)
            .setRequestFocus(true)
            .createPopup()

        // Add click listeners to mode items (skip header at index 0)
        for (i in 1 until panel.componentCount) {
            val item = panel.getComponent(i)
            val modeIndex = i - 1
            item.addMouseListener(object : MouseAdapter() {
                override fun mouseClicked(e: MouseEvent) {
                    val clickedMode = modes[modeIndex]
                    selectedMode = clickedMode
                    modeIcon.icon = clickedMode.icon
                    modeLabel.text = clickedMode.label
                    popup.cancel()
                }
            })
        }

        popup.showUnderneathOf(this)
    }

    private fun createModeItem(mode: Mode, isSelected: Boolean): JPanel {
        return JPanel(BorderLayout(8, 0)).apply {
            isOpaque = true
            background = if (isSelected) Color(0xF3F4F6) else JBColor.background()
            border = JBUI.Borders.empty(6, 12)
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            maximumSize = Dimension(Int.MAX_VALUE, 44)

            // Icon on the left, vertically centered
            val iconLabel = JBLabel(mode.icon).apply {
                foreground = Color(0x6B7280)
                verticalAlignment = SwingConstants.CENTER
                preferredSize = Dimension(20, 32)
            }
            add(iconLabel, BorderLayout.WEST)

            // Text content (title + description) on the right
            val textPanel = JPanel().apply {
                layout = BoxLayout(this, BoxLayout.Y_AXIS)
                isOpaque = false
            }

            val titleLabel = JBLabel(mode.label).apply {
                foreground = Color(0x1F2937)
                font = font.deriveFont(Font.BOLD, 13f)
                alignmentX = Component.LEFT_ALIGNMENT
            }
            textPanel.add(titleLabel)

            val descLabel = JBLabel(mode.description).apply {
                foreground = Color(0x9CA3AF)
                font = font.deriveFont(11f)
                alignmentX = Component.LEFT_ALIGNMENT
            }
            textPanel.add(descLabel)

            add(textPanel, BorderLayout.CENTER)

            addMouseListener(object : MouseAdapter() {
                override fun mouseEntered(e: MouseEvent) {
                    background = Color(0xF3F4F6)
                }
                override fun mouseExited(e: MouseEvent) {
                    background = if (isSelected) Color(0xF3F4F6) else JBColor.background()
                }
            })
        }
    }

    fun getSelectedMode(): Mode = selectedMode
}

/**
 * Simple input with mode selector.
 */
private class SimpleInput : JPanel() {

    private val focusedColor = Color(0x3574F0)
    private val unfocusedColor = Color(0xC9CCD6)
    private var borderColor = unfocusedColor
    private var isFocused = false
    private var isExpanded = false
    private val collapsedHeight = 120
    private val expandedHeight = 300

    private val textArea = JBTextArea().apply {
        lineWrap = true
        wrapStyleWord = true
        rows = 2
        border = JBUI.Borders.empty()
        isOpaque = false
    }

    // Expand button (will be positioned absolutely)
    private val expandButton = JButton(AllIcons.General.ExpandComponent).apply {
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        toolTipText = "Expand"
        isContentAreaFilled = false
        isBorderPainted = false
        isFocusPainted = false
        isOpaque = false
        margin = Insets(0, 0, 0, 0)
        border = null
        val iconSize = AllIcons.General.ExpandComponent.iconWidth
        preferredSize = Dimension(iconSize, iconSize)
        minimumSize = Dimension(iconSize, iconSize)
        maximumSize = Dimension(iconSize, iconSize)
        addActionListener { toggleExpand() }
    }

    // TOP PANEL: text editor area
    private val topPanel = JPanel(BorderLayout()).apply {
        isOpaque = false
        border = JBUI.Borders.empty(8, 10, 4, 10)

        textArea.addFocusListener(object : java.awt.event.FocusAdapter() {
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

        val scrollPane = JBScrollPane(textArea).apply {
            border = JBUI.Borders.empty()
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
            isOpaque = false
            viewport.isOpaque = false
        }

        add(scrollPane, BorderLayout.CENTER)
    }

    private fun toggleExpand() {
        isExpanded = !isExpanded
        val newHeight = if (isExpanded) expandedHeight else collapsedHeight
        preferredSize = Dimension(preferredSize.width, newHeight)
        textArea.rows = if (isExpanded) 10 else 2
        revalidate()
        repaint()
        parent?.revalidate()
        parent?.repaint()
    }

    private fun showAttachmentPopup(component: Component) {
        val panel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            border = JBUI.Borders.empty(8)
            background = JBColor.background()
        }

        // Search field
        val searchField = com.intellij.ui.components.JBTextField().apply {
            emptyText.text = "Search"
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(Color(0xD1D5DB), 1),
                JBUI.Borders.empty(4, 8)
            )
            columns = 20
        }
        val searchWrapper = JPanel(BorderLayout()).apply {
            isOpaque = false
            add(searchField, BorderLayout.CENTER)
            maximumSize = Dimension(Int.MAX_VALUE, 32)
            alignmentX = Component.LEFT_ALIGNMENT
        }
        panel.add(searchWrapper)
        panel.add(Box.createVerticalStrut(4))

        // Menu items
        val menuItems = listOf(
            Triple("Current File", AllIcons.FileTypes.Any_type, false),
            Triple("Files and Folders", AllIcons.Nodes.Folder, true),
            Triple("Symbols", AllIcons.Nodes.Class, true),
            Triple("Commits", AllIcons.Vcs.CommitNode, true),
            Triple("Image...", AllIcons.FileTypes.Image, false),
            Triple("Project Structure", AllIcons.Nodes.Module, false)
        )

        for ((label, icon, hasSubmenu) in menuItems) {
            val item = createMenuItem(label, icon, hasSubmenu)
            item.alignmentX = Component.LEFT_ALIGNMENT
            panel.add(item)
        }

        // Recent files section
        panel.add(Box.createVerticalStrut(4))
        val recentLabel = JBLabel("Recent files").apply {
            foreground = Color(0x6B7280)
            font = font.deriveFont(Font.BOLD, 11f)
            border = JBUI.Borders.empty(4, 8)
            alignmentX = Component.LEFT_ALIGNMENT
        }
        panel.add(recentLabel)

        val recentFiles = listOf("ChatPanel.kt", "SidebarPanel.kt", "plugin.kts")
        for (file in recentFiles) {
            val item = createMenuItem(file, AllIcons.FileTypes.Any_type, false)
            item.alignmentX = Component.LEFT_ALIGNMENT
            panel.add(item)
        }

        val popup = JBPopupFactory.getInstance()
            .createComponentPopupBuilder(panel, searchField)
            .setFocusable(true)
            .setRequestFocus(true)
            .createPopup()

        popup.showUnderneathOf(component)
    }

    private fun createMenuItem(label: String, icon: Icon, hasSubmenu: Boolean): JPanel {
        return JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.empty(3, 8)
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            maximumSize = Dimension(Int.MAX_VALUE, 24)

            val left = JPanel(FlowLayout(FlowLayout.LEFT, 6, 0)).apply {
                isOpaque = false
                add(JBLabel(icon))
                add(JBLabel(label))
            }
            add(left, BorderLayout.CENTER)

            if (hasSubmenu) {
                add(JBLabel(AllIcons.General.ArrowRight), BorderLayout.EAST)
            }

            addMouseListener(object : MouseAdapter() {
                override fun mouseEntered(e: MouseEvent) {
                    background = Color(0xF3F4F6)
                    isOpaque = true
                    repaint()
                }
                override fun mouseExited(e: MouseEvent) {
                    isOpaque = false
                    repaint()
                }
            })
        }
    }

    override fun doLayout() {
        val insets = insets
        val w = width - insets.left - insets.right
        val h = height - insets.top - insets.bottom

        // Bottom panel at bottom
        val bottomPref = bottomPanel.preferredSize
        bottomPanel.setBounds(insets.left, height - insets.bottom - bottomPref.height, w, bottomPref.height)

        // Top panel fills remaining space
        topPanel.setBounds(insets.left, insets.top, w, h - bottomPref.height)

        // Expand button in top-right corner
        val btnSize = expandButton.preferredSize
        expandButton.setBounds(width - btnSize.width - 6, 6, btnSize.width, btnSize.height)
    }

    // Mode selector
    private val modeSelector = ModeSelector()

    private var selectedModel = "Claude 4.5 Opus"
    private val modelLabel = JBLabel("$selectedModel ▾").apply {
        foreground = Color(0x6C707E)
        font = font.deriveFont(12f)
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    // BOTTOM PANEL: toolbar
    private val bottomPanel = JPanel(BorderLayout()).apply {
        isOpaque = false
        border = JBUI.Borders.empty(4, 10, 8, 10)

        val leftPanel = JPanel(FlowLayout(FlowLayout.LEFT, 8, 0)).apply {
            isOpaque = false

            // Add file button
            val addButton = JBLabel(AllIcons.General.Add).apply {
                cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
                toolTipText = "Add attachment"
                addMouseListener(object : MouseAdapter() {
                    override fun mouseClicked(e: MouseEvent) {
                        showAttachmentPopup(this@apply)
                    }
                })
            }
            add(addButton)
            add(modeSelector)
        }

        val rightPanel = JPanel(FlowLayout(FlowLayout.RIGHT, 8, 0)).apply {
            isOpaque = false
            add(modelLabel)
            add(JBLabel(AllIcons.Actions.Execute).apply {
                cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
                toolTipText = "Send"
            })
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
        layout = null // Use absolute positioning
        isOpaque = false
        isDoubleBuffered = true
        background = JBColor.WHITE
        border = JBUI.Borders.empty(2)
        preferredSize = Dimension(220, 120)

        // Add components - expand button first for z-order
        add(expandButton)
        add(topPanel)
        add(bottomPanel)

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
