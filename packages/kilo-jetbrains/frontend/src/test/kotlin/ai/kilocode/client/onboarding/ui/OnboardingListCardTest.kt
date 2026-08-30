package ai.kilocode.client.onboarding.ui

import ai.kilocode.client.onboarding.OnboardingNeed
import ai.kilocode.client.onboarding.OnboardingStep
import ai.kilocode.client.plugin.KiloBundle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBTextArea
import java.awt.Container

@Suppress("UnstableApiUsage")
class OnboardingListCardTest : BasePlatformTestCase() {

    private fun step(id: String, title: String, summary: String) =
        OnboardingStep(id, OnboardingNeed(title, summary), blocking = true)

    /** Card body text, read off the real Swing tree. */
    private fun body(card: OnboardingListCard): String =
        texts(card).joinToString("\n") { it.text }

    private fun texts(root: Container): List<JBTextArea> {
        val found = mutableListOf<JBTextArea>()
        for (child in root.components) {
            if (child is JBTextArea) found.add(child)
            if (child is Container) found.addAll(texts(child))
        }
        return found
    }

    fun `test each step renders as a bullet`() {
        val card = OnboardingListCard()
        card.update(
            listOf(
                step("a", "Migrate from v5", "We found settings."),
                step("b", "Sign in", "Connect your account."),
            ),
        )

        val body = body(card)
        assertTrue("expected a bullet for step a, got: $body", body.contains("• Migrate from v5 — We found settings."))
        assertTrue("expected a bullet for step b, got: $body", body.contains("• Sign in — Connect your account."))
        assertEquals("expected one bullet per step", 2, body.count { it == '•' })
    }

    /**
     * The step summary is long enough to overflow the narrow session card. It must land in a
     * wrapping text component: a plain label would ellipsize it at paint time (which is how the
     * summary originally rendered as "Here's what...").
     */
    fun `test step summary lands in a wrapping component in full`() {
        val long = "We found settings from your previous installation. Here's what we can bring over."
        val card = OnboardingListCard()
        card.update(listOf(step("a", "Migrate from v5", long)))

        val carrier = texts(card).singleOrNull { it.text.contains(long) }
            ?: error("summary not carried in full by any text component: ${body(card)}")
        assertTrue("summary component must wrap rather than ellipsize", carrier.lineWrap)
        assertTrue("summary component should wrap on word boundaries", carrier.wrapStyleWord)
    }

    fun `test intro is shown with no steps`() {
        val card = OnboardingListCard()
        card.update(emptyList())

        val body = body(card)
        assertTrue(body.contains(KiloBundle.message("onboarding.list.subtitle")))
        assertFalse("no steps means no bullets, got: $body", body.contains("•"))
    }

    fun `test update is retained and does not grow the component tree`() {
        val card = OnboardingListCard()
        card.update(listOf(step("a", "One", "First.")))
        val count = texts(card).size

        card.update(listOf(step("a", "One", "First."), step("b", "Two", "Second.")))
        card.update(listOf(step("a", "One", "First.")))

        assertEquals("repeated updates must not add text components", count, texts(card).size)
    }

    /**
     * Regression: `.properties` only collapses `''` to `'` when MessageFormat runs, which it does
     * not for a key with no params — so `Here''s` rendered literally in the UI.
     */
    fun `test no-param bundle strings render apostrophes literally`() {
        val summary = KiloBundle.message("onboarding.migration.summary")
        assertTrue("expected a real apostrophe, got: $summary", summary.contains("Here's"))
        assertFalse("escaped '' leaked into the UI string: $summary", summary.contains("''"))
    }
}
