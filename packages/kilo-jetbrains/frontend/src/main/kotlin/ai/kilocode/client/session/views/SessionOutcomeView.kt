package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Outcome
import ai.kilocode.client.session.model.OutcomeTone
import ai.kilocode.client.session.ui.SessionView
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.views.base.BaseQuestionView
import com.intellij.icons.AllIcons
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.components.BorderLayoutPanel

class SessionOutcomeView(
    selection: SessionSelection? = null,
    focus: (() -> Unit)? = null,
) : BorderLayoutPanel(), SessionEditorStyleTarget, SessionView {

    override val sessionViewKind = SessionView.Kind.Default

    private val card = BaseQuestionView(selection, focus)

    init {
        isOpaque = false
        isVisible = false
        card.setActions(emptyList())
        addToCenter(card)
    }

    @RequiresEdt
    fun showError(message: String, kind: String?) {
        card.setHeaderIcon(AllIcons.General.Error, kind ?: KiloBundle.message("session.error.title"))
        card.setHeader(KiloBundle.message("session.error.title"), message)
        isVisible = true
        refresh()
    }

    @RequiresEdt
    fun showOutcome(outcome: Outcome, tone: OutcomeTone) {
        val title = when (outcome) {
            Outcome.INTERRUPTED -> KiloBundle.message("session.outcome.interrupted.title")
            Outcome.FAILED -> KiloBundle.message("session.outcome.failed.title")
        }
        val desc = when (outcome) {
            Outcome.INTERRUPTED -> KiloBundle.message("session.outcome.interrupted.description")
            Outcome.FAILED -> KiloBundle.message("session.outcome.failed.description")
        }
        val icon = when (tone) {
            OutcomeTone.WARNING -> AllIcons.General.Warning
            OutcomeTone.CRITICAL -> AllIcons.General.Error
        }
        card.setHeaderIcon(icon, title)
        card.setHeader(title, desc)
        isVisible = true
        refresh()
    }

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

    private fun refresh() {
        revalidate()
        repaint()
        parent?.revalidate()
        parent?.repaint()
    }
}
