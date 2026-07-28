package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.SessionView
import ai.kilocode.client.session.views.base.BaseQuestionView
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Container
import javax.swing.JButton

/**
 * Retained inline view shown at the bottom of the transcript when a session
 * enters [ai.kilocode.client.session.model.SessionState.LoginRequired].
 *
 * Mirrors the anchored placement of [PermissionView] and [question.QuestionView]:
 * it stays as a stable child inside [ai.kilocode.client.session.ui.SessionMessageListPanel]
 * and is toggled visible/hidden via [show]/[hideView].
 */
class LoginRequiredView(
    private val openProfile: () -> Unit,
    private val dismiss: () -> Unit,
    selection: SessionSelection? = null,
    focus: (() -> Unit)? = null,
) : BorderLayoutPanel(), SessionEditorStyleTarget, SessionView {

    override val sessionViewKind = SessionView.Kind.Default

    private val card = BaseQuestionView(selection, focus)

    private val ID_DISMISS = "dismiss"
    private val ID_OPEN = "open"

    init {
        isOpaque = false
        isVisible = false

        card.setHeader(KiloBundle.message("session.login.required.title"))
        card.setActions(listOf(
            BaseQuestionView.Action(ID_DISMISS, KiloBundle.message("session.login.required.dismiss"), primary = false) { dismiss() },
            BaseQuestionView.Action(ID_OPEN, KiloBundle.message("session.login.required.button"), primary = true) { openProfile() },
        ))

        addToCenter(card)
    }

    /** Make the view visible with [message] shown as the description. */
    @RequiresEdt
    fun show(message: String) {
        card.setDescription(message)
        isVisible = true
        refresh()
    }

    /** Hide the view. */
    @RequiresEdt
    fun hideView() {
        if (!isVisible) return
        isVisible = false
        refresh()
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        card.applyStyle(style)
    }

    // Test helpers — return generic JButton to keep SessionQuestionButton internal
    internal fun openProfileButton() = button(KiloBundle.message("session.login.required.button"))
    internal fun dismissButton() = button(KiloBundle.message("session.login.required.dismiss"))

    private fun button(text: String) = buttons(card).first { it.text == text }

    private fun buttons(root: Container): List<JButton> {
        val result = mutableListOf<JButton>()
        if (root is JButton) result.add(root)
        for (child in root.components) {
            if (child is Container) result.addAll(buttons(child))
        }
        return result
    }

    private fun refresh() {
        revalidate()
        repaint()
        parent?.revalidate()
        parent?.repaint()
    }
}
