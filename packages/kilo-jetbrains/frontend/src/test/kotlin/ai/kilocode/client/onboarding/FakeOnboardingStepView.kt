package ai.kilocode.client.onboarding

import javax.swing.JLabel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Fake [OnboardingStepView] for dialog tests. Push run/ready state via [_run] / [_ready]. */
class FakeOnboardingStepView(ready: Boolean = true) : OnboardingStepView {

    override val component = JLabel("fake-step-view")

    val _run = MutableStateFlow<OnboardingRunState>(OnboardingRunState.Idle)
    override val run: StateFlow<OnboardingRunState> = _run

    val _ready = MutableStateFlow(ready)
    override val ready: StateFlow<Boolean> = _ready

    val starts = mutableListOf<Unit>()
    val dones = mutableListOf<Unit>()

    override fun start() {
        starts.add(Unit)
        _run.value = OnboardingRunState.Running
    }

    override fun done() {
        dones.add(Unit)
    }
}
