package ai.kilocode.client.onboarding

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Fake [OnboardingController] for UI tests.
 *
 * Push step list changes by setting [_steps]. Track calls via [laters], [skipAlls],
 * [laterSteps], [skipSteps], [starts].
 */
class FakeOnboardingController(private val providers: Map<String, OnboardingProvider> = emptyMap()) : OnboardingController {

    val _steps = MutableStateFlow<List<OnboardingStep>>(emptyList())
    override val steps: StateFlow<List<OnboardingStep>> = _steps

    val laters = mutableListOf<Unit>()
    val skipAlls = mutableListOf<Unit>()
    val laterSteps = mutableListOf<String>()
    val skipSteps = mutableListOf<String>()
    val starts = mutableListOf<Unit>()
    val reoffers = mutableListOf<String>()

    override fun provider(id: String): OnboardingProvider? = providers[id]

    override fun later() {
        laters.add(Unit)
    }

    override fun skipAll() {
        skipAlls.add(Unit)
    }

    override fun laterStep(id: String) {
        laterSteps.add(id)
    }

    override fun skipStep(id: String) {
        skipSteps.add(id)
    }

    override fun start() {
        starts.add(Unit)
    }

    override fun reoffer(id: String) {
        reoffers.add(id)
    }
}
