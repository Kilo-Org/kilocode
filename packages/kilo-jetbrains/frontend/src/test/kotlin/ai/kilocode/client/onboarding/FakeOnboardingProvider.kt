package ai.kilocode.client.onboarding

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.emptyFlow

/** Fake [OnboardingProvider] for [KiloOnboardingService] tests. */
class FakeOnboardingProvider(
    override val id: String,
    override val blocking: Boolean = true,
    private val invalidateFlow: MutableSharedFlow<Unit>? = null,
    private val newView: () -> OnboardingStepView = { FakeOnboardingStepView() },
) : OnboardingProvider {

    var need: OnboardingNeed? = null

    /** What [later] reports back — `false` simulates a provider that failed to resume. */
    var laterResult: Boolean = true

    override val invalidate: Flow<Unit> get() = invalidateFlow ?: emptyFlow()

    val skips = mutableListOf<Unit>()
    val laters = mutableListOf<Unit>()
    val views = mutableListOf<OnboardingStepView>()

    override suspend fun detect(): OnboardingNeed? = need

    override fun view(): OnboardingStepView = newView().also { views.add(it) }

    override fun skip() {
        skips.add(Unit)
    }

    override suspend fun later(): Boolean {
        laters.add(Unit)
        return laterResult
    }
}
