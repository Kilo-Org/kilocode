package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.update.SessionController
import ai.kilocode.client.session.model.Question
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.QuestionReplyDto
import com.intellij.icons.AllIcons
import com.intellij.ui.dsl.builder.RightGap
import com.intellij.ui.dsl.builder.RowLayout
import com.intellij.ui.dsl.builder.panel
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout

/**
 * Docked question panel — shown above the prompt when the session is in
 * [ai.kilocode.client.session.model.SessionState.AwaitingQuestion].
 *
 * The inner layout is rebuilt via Kotlin UI DSL each time [show] is called,
 * so the option buttons always match the current question.
 *
 * Layout (mirrors VS Code's QuestionDock):
 * ```
 * ┌─────────────────────────────────────────┐
 * │  ❔ <header>                            │
 * │  <prompt text>                          │
 * │  [Option A]  [Option B]  [Dismiss]      │
 * └─────────────────────────────────────────┘
 * ```
 */
class QuestionPanel(
    private val controller: SessionController,
) : BorderLayoutPanel() {

    private var requestId: String? = null

    init {
        border = UiStyle.Dock.neutral()
        isVisible = false
    }

    /** Populate the panel for the first item in [question] and make it visible. */
    fun show(question: Question) {
        val item = question.items.firstOrNull() ?: run {
            hidePanel()
            return
        }
        requestId = question.id

        removeAll()
        add(panel {
            row {
                icon(AllIcons.General.QuestionDialog).gap(RightGap.SMALL)
                label(item.header).bold()
            }
            row {
                label(item.question)
            }
            row {
                for (opt in item.options) {
                    button(opt.label) { reply(listOf(listOf(opt.label))) }
                        .gap(RightGap.SMALL)
                        .applyToComponent { toolTipText = opt.description }
                }
                button(KiloBundle.message("session.question.dismiss")) { reject() }
            }.layout(RowLayout.INDEPENDENT)
        }, BorderLayout.CENTER)

        isVisible = true
        revalidate()
        repaint()
    }

    /** Hide this panel. */
    fun hidePanel() {
        requestId = null
        removeAll()
        isVisible = false
    }

    private fun reply(answers: List<List<String>>) {
        val id = requestId ?: return
        controller.replyQuestion(id, QuestionReplyDto(answers))
        hidePanel()
    }

    private fun reject() {
        val id = requestId ?: return
        controller.rejectQuestion(id)
        hidePanel()
    }
}
