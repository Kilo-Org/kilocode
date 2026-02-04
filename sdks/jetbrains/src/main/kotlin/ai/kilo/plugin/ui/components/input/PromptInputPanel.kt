package ai.kilo.plugin.ui.components.input

import ai.kilo.plugin.model.SessionStatus
import ai.kilo.plugin.services.KiloAppState
import ai.kilo.plugin.services.ChatUiStateManager
import ai.kilo.plugin.ui.KiloSpacing
import ai.kilo.plugin.ui.KiloTheme
import ai.kilo.plugin.ui.components.FileAutocomplete
import com.intellij.icons.AllIcons
import com.intellij.openapi.project.Project
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import java.awt.*
import java.awt.event.FocusAdapter
import java.awt.event.FocusEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.geom.RoundRectangle2D
import javax.swing.*
import javax.swing.event.DocumentEvent
import javax.swing.event.DocumentListener

class PromptInputPanel(
    private val project: Project,
    private val store: ChatUiStateManager,
    private val appState: KiloAppState,
    private val onSend: (String) -> Unit,
    private val onStop: () -> Unit
) : JPanel() {

    private val focusedColor = JBColor(0x3574F0, 0x3574F0)
    private val unfocusedColor = KiloTheme.borderWeak
    private var borderColor = unfocusedColor
    private var isFocused = false
    private var isExpanded = false
    private var isBusy = false
    private val collapsedHeight = 120
    private val expandedHeight = 300

    private val textArea = JBTextArea().apply {
        lineWrap = true
        wrapStyleWord = true
        rows = 2
        border = JBUI.Borders.empty()
        isOpaque = false
        background = KiloTheme.surfaceRaisedStrong
        foreground = KiloTheme.textBase
        caretColor = KiloTheme.textBase
        font = JBUI.Fonts.label(14f)
    }

    private val placeholderLabel = JBLabel("Ask Kilo anything...").apply {
        foreground = KiloTheme.textWeaker
        font = JBUI.Fonts.label(14f)
        isOpaque = false
    }

    private var fileAutocomplete: FileAutocomplete? = null

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

    private val topPanel = BorderLayoutPanel().apply {
        isOpaque = false
        border = JBUI.Borders.empty(8, 10, 4, 10)

        textArea.addFocusListener(object : FocusAdapter() {
            override fun focusGained(e: FocusEvent?) {
                borderColor = focusedColor
                isFocused = true
                this@PromptInputPanel.repaint()
            }
            override fun focusLost(e: FocusEvent?) {
                borderColor = unfocusedColor
                isFocused = false
                this@PromptInputPanel.repaint()
            }
        })

        textArea.document.addDocumentListener(object : DocumentListener {
            override fun insertUpdate(e: DocumentEvent?) = updatePlaceholder()
            override fun removeUpdate(e: DocumentEvent?) = updatePlaceholder()
            override fun changedUpdate(e: DocumentEvent?) = updatePlaceholder()
            private fun updatePlaceholder() {
                placeholderLabel.isVisible = textArea.text.isEmpty()
            }
        })

        val scrollPane = JBScrollPane(textArea).apply {
            border = JBUI.Borders.empty()
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
            isOpaque = false
            viewport.isOpaque = false
        }

        val layeredPane = JLayeredPane().apply {
            layout = object : LayoutManager {
                override fun addLayoutComponent(name: String?, comp: Component?) {}
                override fun removeLayoutComponent(comp: Component?) {}
                override fun preferredLayoutSize(parent: Container?) = scrollPane.preferredSize
                override fun minimumLayoutSize(parent: Container?) = scrollPane.minimumSize
                override fun layoutContainer(parent: Container?) {
                    val bounds = parent?.bounds ?: return
                    scrollPane.setBounds(0, 0, bounds.width, bounds.height)
                    placeholderLabel.setBounds(4, 2, bounds.width - 8, 20)
                }
            }
            add(scrollPane, JLayeredPane.DEFAULT_LAYER)
            add(placeholderLabel, JLayeredPane.PALETTE_LAYER)
        }

        placeholderLabel.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                textArea.requestFocusInWindow()
            }
        })

        addToCenter(layeredPane)
    }

    private val modeSelector = ModeSelector()
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val modelSelector = ModelSelector(scope, appState)

    private val sendButton = JBLabel(AllIcons.Actions.Execute).apply {
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        toolTipText = "Send (Enter)"
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (!isBusy) send()
            }
        })
    }

    private val stopButton = JBLabel(AllIcons.Actions.Suspend).apply {
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        toolTipText = "Stop"
        isVisible = false
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                onStop()
            }
        })
    }

    private val bottomPanel = BorderLayoutPanel().apply {
        isOpaque = false
        border = JBUI.Borders.empty(4, 10, 8, 10)

        val leftPanel = JPanel(FlowLayout(FlowLayout.LEFT, 8, 0)).apply {
            isOpaque = false
            add(modeSelector)
        }

        val rightPanel = JPanel(FlowLayout(FlowLayout.RIGHT, 8, 0)).apply {
            isOpaque = false
            add(modelSelector.label)
            add(stopButton)
            add(sendButton)
        }

        addToLeft(leftPanel)
        addToRight(rightPanel)
    }

    init {
        layout = null
        isOpaque = false
        isDoubleBuffered = true
        background = KiloTheme.surfaceRaisedStrong
        border = JBUI.Borders.empty(KiloSpacing.md, KiloSpacing.lg)
        preferredSize = Dimension(0, collapsedHeight)

        add(expandButton)
        add(topPanel)
        add(bottomPanel)

        textArea.inputMap.put(KeyStroke.getKeyStroke("ENTER"), "send")
        textArea.actionMap.put("send", object : AbstractAction() {
            override fun actionPerformed(e: java.awt.event.ActionEvent?) {
                if (!isBusy) send()
            }
        })
        textArea.inputMap.put(KeyStroke.getKeyStroke("shift ENTER"), "insert-break")

        textArea.inputMap.put(KeyStroke.getKeyStroke("ESCAPE"), "unfocus")
        textArea.actionMap.put("unfocus", object : AbstractAction() {
            override fun actionPerformed(e: java.awt.event.ActionEvent?) {
                textArea.transferFocus()
            }
        })

        setupFileAutocomplete()
    }

    private fun setupFileAutocomplete() {
        fileAutocomplete = FileAutocomplete(
            project = project,
            textComponent = textArea,
            appState = appState,
            onFileSelected = { attachedFile, _ ->
                appState.addFileToContext(attachedFile)
                val text = textArea.text
                val atIndex = text.lastIndexOf('@')
                if (atIndex >= 0) {
                    val caret = textArea.caretPosition
                    val newText = text.substring(0, atIndex) + text.substring(caret.coerceAtMost(text.length))
                    textArea.text = newText.trimEnd()
                    if (newText.isNotEmpty() && !newText.endsWith(" ")) {
                        textArea.text = newText + " "
                    }
                    textArea.caretPosition = atIndex.coerceAtMost(textArea.text.length)
                }
            }
        )
    }

    override fun doLayout() {
        val insets = insets
        val w = width - insets.left - insets.right
        val h = height - insets.top - insets.bottom

        val bottomPref = bottomPanel.preferredSize
        bottomPanel.setBounds(insets.left, height - insets.bottom - bottomPref.height, w, bottomPref.height)

        topPanel.setBounds(insets.left, insets.top, w, h - bottomPref.height)

        val btnSize = expandButton.preferredSize
        expandButton.setBounds(width - btnSize.width - 14, 12, btnSize.width, btnSize.height)
    }

    private fun toggleExpand() {
        isExpanded = !isExpanded
        val newHeight = if (isExpanded) expandedHeight else collapsedHeight
        preferredSize = Dimension(preferredSize.width, newHeight)
        textArea.rows = if (isExpanded) 10 else 2
        expandButton.icon = if (isExpanded) AllIcons.General.CollapseComponent else AllIcons.General.ExpandComponent
        expandButton.toolTipText = if (isExpanded) "Collapse" else "Expand"
        revalidate()
        repaint()
        parent?.revalidate()
        parent?.repaint()
    }

    private fun send() {
        val text = textArea.text.trim()
        if (text.isNotEmpty()) {
            onSend(text)
            textArea.text = ""
        }
    }

    fun updateStatus(status: SessionStatus?) {
        isBusy = status?.type == "busy" || status?.type == "retry"
        sendButton.isVisible = !isBusy
        stopButton.isVisible = isBusy
    }

    override fun setEnabled(enabled: Boolean) {
        super.setEnabled(enabled)
        textArea.isEnabled = enabled
        sendButton.isVisible = enabled && !isBusy
    }

    override fun requestFocusInWindow(): Boolean {
        return textArea.requestFocusInWindow()
    }

    fun dispose() {
        scope.cancel()
        fileAutocomplete?.dispose()
    }

    fun clearText() {
        textArea.text = ""
    }

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)

        val radius = 12f
        val strokeWidth = if (isFocused) 2f else 1.5f
        val offset = strokeWidth / 2f

        g2.color = background
        g2.fill(RoundRectangle2D.Float(
            strokeWidth, strokeWidth,
            width - strokeWidth * 2, height - strokeWidth * 2,
            radius, radius
        ))

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
