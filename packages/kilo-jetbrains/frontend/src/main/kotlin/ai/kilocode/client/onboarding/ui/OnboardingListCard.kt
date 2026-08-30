package ai.kilocode.client.onboarding.ui

import ai.kilocode.client.onboarding.OnboardingStep
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.views.base.DialogView
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JComponent

private const val ACTION_LATER = "later"
private const val ACTION_SKIP_ALL = "skipAll"
private const val ACTION_START = "start"

/**
 * Compact, read-only list of currently detected onboarding steps, shown as modal blocker content
 * in the session when a blocking step is pending. Rows show title + summary only — per-step
 * controls live in [OnboardingDialog], opened via `Start`.
 *
 * Build once; call [update] for every state change. Does not rebuild the component tree.
 */
class OnboardingListCard : DialogView() {

    var onLater: (() -> Unit)? = null
    var onSkipAll: (() -> Unit)? = null
    var onStart: (() -> Unit)? = null

    private val rows = mutableListOf<OnboardingStepRow>()
    private val content = Stack.vertical(gap = UiStyle.Gap.sm())

    init {
        isOpaque = false
        setHeader(
            KiloBundle.message("onboarding.list.title"),
            KiloBundle.message("onboarding.list.subtitle"),
        )
        setContent(content)
        setActions(
            listOf(
                DialogView.Action(ACTION_LATER, KiloBundle.message("onboarding.button.later"), primary = false) {
                    onLater?.invoke()
                },
                DialogView.Action(ACTION_SKIP_ALL, KiloBundle.message("onboarding.button.skipAll"), primary = false) {
                    onSkipAll?.invoke()
                },
                DialogView.Action(ACTION_START, KiloBundle.message("onboarding.button.start"), primary = true) {
                    onStart?.invoke()
                },
            ),
        )
    }

    @RequiresEdt
    fun update(steps: List<OnboardingStep>) {
        while (rows.size < steps.size) {
            val row = OnboardingStepRow()
            rows.add(row)
            content.next(row)
        }
        while (rows.size > steps.size) {
            val row = rows.removeAt(rows.size - 1)
            content.remove(row)
        }
        steps.forEachIndexed { index, step -> rows[index].update(step) }
        content.revalidate()
        content.repaint()
        revalidate()
        repaint()
    }

    @RequiresEdt
    fun preferredFocusComponent(): JComponent = preferredActionComponent(ACTION_START)
}
