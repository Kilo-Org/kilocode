package ai.kilocode.client.onboarding.ui

import ai.kilocode.client.onboarding.OnboardingStep
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.views.base.DialogView
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JComponent

private const val ACTION_LATER = "later"
private const val ACTION_SKIP_ALL = "skipAll"
private const val ACTION_START = "start"

/**
 * Compact, read-only summary of the currently detected onboarding steps, shown as modal blocker
 * content in the session when a blocking step is pending. Steps render as a bullet list — per-step
 * controls live in [OnboardingDialog], opened via `Start`.
 *
 * Build once; call [update] for every state change. Does not rebuild the component tree.
 */
class OnboardingListCard : DialogView() {

    var onLater: (() -> Unit)? = null
    var onSkipAll: (() -> Unit)? = null
    var onStart: (() -> Unit)? = null

    init {
        setHeader(KiloBundle.message("onboarding.list.title"))
        setActions(
            listOf(
                DialogView.Action(ACTION_SKIP_ALL, KiloBundle.message("onboarding.button.skipAll"), primary = false) {
                    onSkipAll?.invoke()
                },
                DialogView.Action(ACTION_LATER, KiloBundle.message("onboarding.button.later"), primary = false) {
                    onLater?.invoke()
                },
                DialogView.Action(ACTION_START, KiloBundle.message("onboarding.button.start"), primary = true) {
                    onStart?.invoke()
                },
            ),
        )
    }

    /**
     * Renders the intro plus one short bullet per step into the card's description.
     *
     * Only [ai.kilocode.client.onboarding.OnboardingNeed.title] is shown here — the longer
     * `detail` text belongs to the dedicated dialog UI, and putting it in this narrow card is what
     * made the bullet wrap over several lines.
     *
     * This deliberately reuses the card's own description text rather than adding per-step labels:
     * [DialogView] lays that text out width-aware so it wraps instead of ellipsizing.
     */
    @RequiresEdt
    fun update(steps: List<OnboardingStep>) {
        setDescription(describe(steps))
    }

    @RequiresEdt
    fun preferredFocusComponent(): JComponent = preferredActionComponent(ACTION_START)

    private fun describe(steps: List<OnboardingStep>): String {
        val intro = KiloBundle.message("onboarding.list.subtitle")
        if (steps.isEmpty()) return intro
        return steps.joinToString(separator = "\n", prefix = "$intro\n\n") {
            KiloBundle.message("onboarding.list.item", it.need.title)
        }
    }
}
