package ai.kilo.plugin.ui.components.chat.message.parts

import ai.kilo.plugin.model.QuestionInfo
import ai.kilo.plugin.model.QuestionRequest
import ai.kilo.plugin.ui.KiloTheme
import ai.kilo.plugin.ui.KiloSpacing
import ai.kilo.plugin.ui.KiloTypography
import com.intellij.icons.AllIcons
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.JBUI
import java.awt.*
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.*

/**
 * Inline question prompt displayed below tool cards.
 * Matches the web client UX:
 * - Single question + single select: Click option = immediate submit
 * - Multi-select or multi-question: Tabs + confirm step
 */
class InlineQuestionPrompt(
    private val request: QuestionRequest,
    private val onReply: (answers: List<List<String>>) -> Unit,
    private val onReject: () -> Unit
) : JPanel(BorderLayout()) {

    private val questions = request.questions
    private val isSingleQuestion = questions.size == 1
    private val isSingleSelect = isSingleQuestion && questions[0].multiple != true
    
    // State
    private var currentTab = 0
    private val answers = MutableList<MutableList<String>>(questions.size) { mutableListOf() }
    private val customInputs = MutableList(questions.size) { "" }
    private var isEditingCustom = false
    
    // UI components
    private val contentPanel = JPanel(CardLayout())
    private val tabPanel = JPanel(FlowLayout(FlowLayout.LEFT, 4, 0))
    private val actionsPanel = JPanel(FlowLayout(FlowLayout.RIGHT, 8, 0))

    init {
        isOpaque = true
        background = KiloTheme.surfaceInteractive
        border = JBUI.Borders.compound(
            JBUI.Borders.customLine(KiloTheme.borderInteractive, 1),
            JBUI.Borders.empty(KiloSpacing.lg)
        )

        buildUI()
    }

    private fun buildUI() {
        // Tab bar (only for multi-question)
        if (!isSingleQuestion) {
            tabPanel.isOpaque = false
            buildTabBar()
            add(tabPanel, BorderLayout.NORTH)
        }

        // Content area
        contentPanel.isOpaque = false
        buildContentPanels()
        add(contentPanel, BorderLayout.CENTER)

        // Actions panel
        actionsPanel.isOpaque = false
        buildActionsPanel()
        add(actionsPanel, BorderLayout.SOUTH)

        showTab(0)
    }

    private fun buildTabBar() {
        tabPanel.removeAll()
        
        for ((index, question) in questions.withIndex()) {
            val tab = createTabButton(question.header, index)
            tabPanel.add(tab)
        }
        
        // Confirm tab
        val confirmTab = createTabButton("Confirm", questions.size)
        tabPanel.add(confirmTab)
    }

    private fun createTabButton(text: String, index: Int): JButton {
        return JButton(text).apply {
            isContentAreaFilled = false
            isBorderPainted = false
            isFocusPainted = false
            font = font.deriveFont(KiloTypography.fontSizeBase)
            foreground = if (index == currentTab) KiloTheme.textStrong else KiloTheme.textWeak
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            border = JBUI.Borders.empty(KiloSpacing.xs, KiloSpacing.lg)
            
            addActionListener {
                showTab(index)
            }
        }
    }

    private fun buildContentPanels() {
        // Question panels
        for ((index, question) in questions.withIndex()) {
            val panel = createQuestionPanel(question, index)
            contentPanel.add(panel, "question_$index")
        }
        
        // Confirm panel (for multi-question)
        if (!isSingleQuestion) {
            val confirmPanel = createConfirmPanel()
            contentPanel.add(confirmPanel, "confirm")
        }
    }

    private fun createQuestionPanel(question: QuestionInfo, index: Int): JPanel {
        val panel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
            border = JBUI.Borders.empty(KiloSpacing.md, 0)
        }

        // Question text
        val questionLabel = JBLabel("<html><body style='width: 400px'>${question.question}" +
            "${if (question.multiple == true) " (select multiple)" else ""}</body></html>").apply {
            alignmentX = Component.LEFT_ALIGNMENT
            foreground = KiloTheme.textStrong
            font = font.deriveFont(KiloTypography.fontSizeMedium)
        }
        panel.add(questionLabel)
        panel.add(Box.createVerticalStrut(KiloSpacing.lg))

        // Options
        for (option in question.options) {
            val optionCard = createOptionCard(option.label, option.description, index, question.multiple == true)
            optionCard.alignmentX = Component.LEFT_ALIGNMENT
            panel.add(optionCard)
            panel.add(Box.createVerticalStrut(KiloSpacing.xs))
        }

        // Custom input option (if enabled)
        if (question.custom != false) {
            val customCard = createCustomInputCard(index, question.multiple == true)
            customCard.alignmentX = Component.LEFT_ALIGNMENT
            panel.add(customCard)
        }

        return panel
    }

    private fun createOptionCard(
        label: String,
        description: String?,
        questionIndex: Int,
        isMultiple: Boolean
    ): JPanel {
        val card = JPanel(BorderLayout()).apply {
            isOpaque = true
            background = KiloTheme.surfaceRaisedBase
            border = JBUI.Borders.compound(
                JBUI.Borders.customLine(KiloTheme.borderWeak, 1),
                JBUI.Borders.empty(KiloSpacing.md, KiloSpacing.lg)
            )
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            maximumSize = Dimension(Int.MAX_VALUE, 60)
        }

        val textPanel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
        }

        val labelComponent = JBLabel(label).apply {
            font = font.deriveFont(Font.BOLD, KiloTypography.fontSizeBase)
            foreground = KiloTheme.textStrong
            alignmentX = Component.LEFT_ALIGNMENT
        }
        textPanel.add(labelComponent)

        if (description != null) {
            val descLabel = JBLabel(description).apply {
                foreground = KiloTheme.textWeak
                font = font.deriveFont(KiloTypography.fontSizeXSmall)
                alignmentX = Component.LEFT_ALIGNMENT
            }
            textPanel.add(descLabel)
        }

        card.add(textPanel, BorderLayout.CENTER)

        // Check icon (shown when selected)
        val checkIcon = JBLabel(AllIcons.Actions.Checked).apply {
            isVisible = answers[questionIndex].contains(label)
        }
        card.add(checkIcon, BorderLayout.EAST)

        // Click handler
        card.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                handleOptionClick(label, questionIndex, isMultiple)
                checkIcon.isVisible = answers[questionIndex].contains(label)
                card.repaint()
            }

            override fun mouseEntered(e: MouseEvent) {
                card.background = KiloTheme.surfaceRaisedStrong
            }

            override fun mouseExited(e: MouseEvent) {
                card.background = KiloTheme.surfaceRaisedBase
            }
        })

        return card
    }

    private fun createCustomInputCard(questionIndex: Int, isMultiple: Boolean): JPanel {
        val card = JPanel(BorderLayout()).apply {
            isOpaque = true
            background = KiloTheme.surfaceRaisedBase
            border = JBUI.Borders.compound(
                JBUI.Borders.customLine(KiloTheme.borderWeak, 1),
                JBUI.Borders.empty(KiloSpacing.md, KiloSpacing.lg)
            )
            maximumSize = Dimension(Int.MAX_VALUE, 70)
        }

        val labelComponent = JBLabel("Type your own answer").apply {
            font = font.deriveFont(KiloTypography.fontSizeBase)
            foreground = KiloTheme.textWeak
        }

        val inputField = JBTextField().apply {
            preferredSize = Dimension(200, 28)
            text = customInputs[questionIndex]
            isVisible = false
            background = KiloTheme.surfaceInsetBase
            foreground = KiloTheme.textBase
        }

        val submitButton = JButton(if (isMultiple) "Add" else "Submit").apply {
            isVisible = false
            background = KiloTheme.buttonPrimaryBg
            foreground = KiloTheme.buttonPrimaryFg
            addActionListener {
                val text = inputField.text.trim()
                if (text.isNotEmpty()) {
                    customInputs[questionIndex] = text
                    handleOptionClick(text, questionIndex, isMultiple)
                    if (!isMultiple && isSingleSelect) {
                        // Immediate submit for single question + single select
                        submitAnswers()
                    }
                }
                inputField.isVisible = false
                this.isVisible = false
                labelComponent.isVisible = true
                isEditingCustom = false
            }
        }

        val inputPanel = JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.md, 0)).apply {
            isOpaque = false
            add(inputField)
            add(submitButton)
        }

        card.add(labelComponent, BorderLayout.WEST)
        card.add(inputPanel, BorderLayout.CENTER)

        // Click to show input
        card.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (!isEditingCustom) {
                    labelComponent.isVisible = false
                    inputField.isVisible = true
                    submitButton.isVisible = true
                    inputField.requestFocus()
                    isEditingCustom = true
                }
            }

            override fun mouseEntered(e: MouseEvent) {
                if (!isEditingCustom) {
                    card.background = KiloTheme.surfaceRaisedStrong
                }
            }

            override fun mouseExited(e: MouseEvent) {
                card.background = KiloTheme.surfaceRaisedBase
            }
        })

        // Enter to submit
        inputField.addActionListener {
            submitButton.doClick()
        }

        return card
    }

    private fun createConfirmPanel(): JPanel {
        val panel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
            border = JBUI.Borders.empty(KiloSpacing.md, 0)
        }

        val titleLabel = JBLabel("Review your answers").apply {
            font = font.deriveFont(Font.BOLD, KiloTypography.fontSizeMedium)
            foreground = KiloTheme.textStrong
            alignmentX = Component.LEFT_ALIGNMENT
        }
        panel.add(titleLabel)
        panel.add(Box.createVerticalStrut(KiloSpacing.lg))

        for ((index, question) in questions.withIndex()) {
            val reviewItem = JPanel().apply {
                layout = BoxLayout(this, BoxLayout.Y_AXIS)
                isOpaque = false
                alignmentX = Component.LEFT_ALIGNMENT
                border = JBUI.Borders.empty(KiloSpacing.xs, 0)
            }

            val questionLabel = JBLabel(question.question).apply {
                foreground = KiloTheme.textWeak
                font = font.deriveFont(KiloTypography.fontSizeSmall)
                alignmentX = Component.LEFT_ALIGNMENT
            }
            reviewItem.add(questionLabel)

            val answerLabel = JBLabel().apply {
                val answerText = if (answers[index].isEmpty()) "(not answered)" else answers[index].joinToString(", ")
                text = answerText
                foreground = if (answers[index].isEmpty()) KiloTheme.textWeak else KiloTheme.textStrong
                font = font.deriveFont(Font.BOLD, KiloTypography.fontSizeBase)
                alignmentX = Component.LEFT_ALIGNMENT
            }
            reviewItem.add(answerLabel)

            panel.add(reviewItem)
            panel.add(Box.createVerticalStrut(KiloSpacing.md))
        }

        return panel
    }

    private fun buildActionsPanel() {
        actionsPanel.removeAll()

        // Dismiss button (always shown)
        val dismissButton = JButton("Dismiss").apply {
            isContentAreaFilled = false
            isBorderPainted = false
            foreground = KiloTheme.textWeak
            addActionListener { onReject() }
        }
        actionsPanel.add(dismissButton)

        // Next/Submit button (for multi-question or multi-select)
        if (!isSingleSelect) {
            val isOnConfirmTab = currentTab == questions.size
            val isMultiSelect = !isSingleQuestion || questions[0].multiple == true
            
            if (isOnConfirmTab) {
                val submitButton = JButton("Submit").apply {
                    icon = AllIcons.Actions.Checked
                    addActionListener { submitAnswers() }
                }
                actionsPanel.add(submitButton)
            } else if (isMultiSelect && currentTab < questions.size) {
                val nextButton = JButton("Next").apply {
                    icon = AllIcons.Actions.Forward
                    isEnabled = answers[currentTab].isNotEmpty()
                    addActionListener { showTab(currentTab + 1) }
                }
                actionsPanel.add(nextButton)
            }
        }

        actionsPanel.revalidate()
        actionsPanel.repaint()
    }

    private fun handleOptionClick(label: String, questionIndex: Int, isMultiple: Boolean) {
        if (isMultiple) {
            // Toggle selection
            if (answers[questionIndex].contains(label)) {
                answers[questionIndex].remove(label)
            } else {
                answers[questionIndex].add(label)
            }
            buildActionsPanel()
        } else {
            // Single select
            answers[questionIndex].clear()
            answers[questionIndex].add(label)
            
            // Immediate submit for single question + single select
            if (isSingleSelect) {
                submitAnswers()
            } else {
                // Move to next question or confirm
                showTab(currentTab + 1)
            }
        }
    }

    private fun showTab(index: Int) {
        currentTab = index
        
        val cardLayout = contentPanel.layout as CardLayout
        if (index < questions.size) {
            cardLayout.show(contentPanel, "question_$index")
        } else {
            // Rebuild confirm panel to show current answers
            rebuildConfirmPanel()
            cardLayout.show(contentPanel, "confirm")
        }

        // Update tab styling
        if (!isSingleQuestion) {
            for ((i, component) in tabPanel.components.withIndex()) {
                if (component is JButton) {
                    component.foreground = if (i == currentTab) KiloTheme.textStrong else KiloTheme.textWeak
                    component.font = component.font.deriveFont(if (i == currentTab) Font.BOLD else Font.PLAIN)
                }
            }
        }

        buildActionsPanel()
    }

    private fun rebuildConfirmPanel() {
        // Find and rebuild the confirm panel
        for (i in 0 until contentPanel.componentCount) {
            val component = contentPanel.getComponent(i)
            if (component is JPanel) {
                val constraint = (contentPanel.layout as CardLayout).toString()
                // Recreate confirm panel with updated answers
            }
        }
        
        // Simpler approach: rebuild content panels
        contentPanel.removeAll()
        buildContentPanels()
        contentPanel.revalidate()
    }

    private fun submitAnswers() {
        onReply(answers.map { it.toList() })
    }
}
