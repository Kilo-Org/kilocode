package ai.kilo.plugin.ui.components.chat.message.parts

import ai.kilo.plugin.model.QuestionRequest
import java.awt.BorderLayout
import java.awt.FlowLayout
import javax.swing.*

/**
 * Simple question prompt using standard Swing controls.
 * - Single select: radio buttons, immediate submit on selection
 * - Multi select: checkboxes with submit button
 * - Custom input: text field option
 */
class InlineQuestionPrompt(
    private val request: QuestionRequest,
    private val onReply: (answers: List<List<String>>) -> Unit,
    private val onReject: () -> Unit
) : JPanel(BorderLayout(0, 8)) {

    private val questions = request.questions
    private val answers = MutableList<MutableList<String>>(questions.size) { mutableListOf() }

    init {
        isOpaque = false
        border = BorderFactory.createEmptyBorder(8, 0, 8, 0)

        // Questions panel
        val questionsPanel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
        }

        for ((index, question) in questions.withIndex()) {
            questionsPanel.add(createQuestionPanel(index, question))
            if (index < questions.size - 1) {
                questionsPanel.add(Box.createVerticalStrut(12))
            }
        }

        add(questionsPanel, BorderLayout.CENTER)

        // Actions panel
        val actionsPanel = JPanel(FlowLayout(FlowLayout.LEFT, 8, 0)).apply {
            isOpaque = false
        }

        actionsPanel.add(JButton("Dismiss").apply {
            addActionListener { onReject() }
        })

        // Show submit button if any question is multi-select or there are multiple questions
        val needsSubmitButton = questions.size > 1 || questions.any { it.multiple == true }
        if (needsSubmitButton) {
            actionsPanel.add(JButton("Submit").apply {
                addActionListener { submitAnswers() }
            })
        }

        add(actionsPanel, BorderLayout.SOUTH)
    }

    private fun createQuestionPanel(questionIndex: Int, question: ai.kilo.plugin.model.QuestionInfo): JPanel {
        val panel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
            alignmentX = LEFT_ALIGNMENT
        }

        // Question label
        val label = JLabel(question.question).apply {
            alignmentX = LEFT_ALIGNMENT
        }
        panel.add(label)
        panel.add(Box.createVerticalStrut(4))

        val isMultiple = question.multiple == true
        val isSingleQuestionSingleSelect = questions.size == 1 && !isMultiple
        val buttonGroup = if (!isMultiple) ButtonGroup() else null

        // Options
        for (option in question.options) {
            val toggle: JToggleButton = if (isMultiple) {
                JCheckBox(option.label)
            } else {
                JRadioButton(option.label)
            }

            toggle.alignmentX = LEFT_ALIGNMENT
            toggle.isOpaque = false
            if (option.description != null) {
                toggle.toolTipText = option.description
            }

            buttonGroup?.add(toggle)

            toggle.addActionListener {
                handleSelection(questionIndex, option.label, isMultiple, toggle.isSelected)
                if (isSingleQuestionSingleSelect && toggle.isSelected) {
                    submitAnswers()
                }
            }

            panel.add(toggle)
        }

        // Custom input option
        if (question.custom != false) {
            panel.add(Box.createVerticalStrut(4))
            panel.add(createCustomInputRow(questionIndex, isMultiple, buttonGroup, isSingleQuestionSingleSelect))
        }

        return panel
    }

    private fun createCustomInputRow(
        questionIndex: Int,
        isMultiple: Boolean,
        buttonGroup: ButtonGroup?,
        immediateSubmit: Boolean
    ): JPanel {
        val row = JPanel(FlowLayout(FlowLayout.LEFT, 4, 0)).apply {
            isOpaque = false
            alignmentX = LEFT_ALIGNMENT
        }

        val toggle: JToggleButton = if (isMultiple) {
            JCheckBox("Other:")
        } else {
            JRadioButton("Other:")
        }
        toggle.isOpaque = false
        buttonGroup?.add(toggle)

        val textField = JTextField(15).apply {
            isEnabled = false
        }

        val addButton = JButton(if (isMultiple) "Add" else "Submit").apply {
            isEnabled = false
            addActionListener {
                val text = textField.text.trim()
                if (text.isNotEmpty()) {
                    handleSelection(questionIndex, text, isMultiple, true)
                    if (immediateSubmit || !isMultiple) {
                        submitAnswers()
                    }
                }
            }
        }

        toggle.addActionListener {
            textField.isEnabled = toggle.isSelected
            addButton.isEnabled = toggle.isSelected
            if (toggle.isSelected) {
                textField.requestFocus()
            }
        }

        textField.addActionListener {
            if (addButton.isEnabled) {
                addButton.doClick()
            }
        }

        row.add(toggle)
        row.add(textField)
        row.add(addButton)

        return row
    }

    private fun handleSelection(questionIndex: Int, value: String, isMultiple: Boolean, selected: Boolean) {
        if (isMultiple) {
            if (selected) {
                if (!answers[questionIndex].contains(value)) {
                    answers[questionIndex].add(value)
                }
            } else {
                answers[questionIndex].remove(value)
            }
        } else {
            answers[questionIndex].clear()
            if (selected) {
                answers[questionIndex].add(value)
            }
        }
    }

    private fun submitAnswers() {
        onReply(answers.map { it.toList() })
    }
}
