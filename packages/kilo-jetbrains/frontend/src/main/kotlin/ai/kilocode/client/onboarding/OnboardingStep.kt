package ai.kilocode.client.onboarding

/** A currently-detected onboarding need, as published by [ai.kilocode.client.onboarding.KiloOnboardingService]. */
data class OnboardingStep(
    val id: String,
    val need: OnboardingNeed,
    val blocking: Boolean,
)
