package ai.kilocode.client.onboarding

import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JComponent
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emptyFlow

/**
 * A single onboarding need discovered by a provider.
 *
 * The two strings serve different surfaces and should read differently:
 * - [title] is a short label — one bullet in the session list card, one row in the dialog's step
 *   rail. Keep it to a few words, e.g. "Migrate from Kilo v5".
 * - [detail] is the longer explanation shown only in the dedicated dialog UI, above the step's own
 *   content, e.g. "We found settings from your previous installation...".
 */
data class OnboardingNeed(val title: String, val detail: String)

/**
 * Run-state of one onboarding step's content, owned and reported by the provider's own
 * [OnboardingStepView]. The [ai.kilocode.client.onboarding.ui.OnboardingDialog] only reads this to
 * drive its footer buttons — it never renders progress itself.
 */
sealed interface OnboardingRunState {
    object Idle : OnboardingRunState
    object Running : OnboardingRunState
    object Done : OnboardingRunState
    data class Failed(val message: String) : OnboardingRunState
}

/**
 * Dialog-hosted UI for one onboarding step.
 *
 * The provider owns the run lifecycle and renders its own progress inside [component]; the dialog
 * only reads [run] and [ready] to drive its footer buttons ([start] enablement, `Next`/`Finish`
 * label and visibility).
 */
interface OnboardingStepView {
    val component: JComponent
    val run: StateFlow<OnboardingRunState>

    /** Whether `Run` is currently actionable, e.g. at least one migration category is selected. */
    val ready: StateFlow<Boolean>

    @RequiresEdt
    fun start()

    /**
     * Called when the user leaves a finished ([OnboardingRunState.Done] or
     * [OnboardingRunState.Failed]) step via `Next`/`Finish`.
     */
    @RequiresEdt
    fun done()
}

/**
 * Pluggable onboarding source. A provider reports whether it currently has a need via [detect],
 * and — when the user chooses to act on it — renders its own [OnboardingStepView] inside
 * [ai.kilocode.client.onboarding.ui.OnboardingDialog].
 *
 * [ai.kilocode.client.onboarding.KiloOnboardingService] owns detection scheduling and the
 * skip/later bookkeeping shared across steps; providers own their own persistence (see
 * [skip] / [later]) and their own run state ([OnboardingStepView.run]).
 */
interface OnboardingProvider {
    val id: String

    /** Whether this step keeps the app paused until resolved (mirrors today's v5 migration gate). */
    val blocking: Boolean

    /** Extra re-detect triggers beyond app-state changes, e.g. the provider's own state flow. */
    val invalidate: Flow<Unit> get() = emptyFlow()

    suspend fun detect(): OnboardingNeed?

    @RequiresEdt
    fun view(): OnboardingStepView

    /** Persist a permanent skip. Provider-owned — the framework keeps no status of its own. */
    fun skip()

    /**
     * Defer for now, resuming whatever the provider paused, and report whether that actually
     * succeeded.
     *
     * The framework keeps this step out of [ai.kilocode.client.onboarding.KiloOnboardingService.steps]
     * for the rest of this IDE run only when this returns `true`. A [blocking] step whose resume
     * failed must stay offered — otherwise the app is left paused with no UI to recover from.
     */
    suspend fun later(): Boolean
}
