package ai.kilocode.client.onboarding.ui

import ai.kilocode.client.onboarding.OnboardingNeed
import ai.kilocode.client.onboarding.OnboardingStep
import ai.kilocode.client.plugin.KiloBundle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBTextArea
import java.awt.Container
import javax.swing.JButton

@Suppress("UnstableApiUsage")
class OnboardingListCardTest : BasePlatformTestCase() {

    private fun step(id: String, title: String, detail: String = "Long detail for $title.") =
        OnboardingStep(id, OnboardingNeed(title, detail), blocking = true)

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

    /** Action buttons in visual (component tree) order. */
    private fun buttons(root: Container): List<JButton> {
        val found = mutableListOf<JButton>()
        for (child in root.components) {
            if (child is JButton) found.add(child)
            if (child is Container) found.addAll(buttons(child))
        }
        return found
    }

    fun `test each step renders as a short bullet`() {
        val card = OnboardingListCard()
        card.update(
            listOf(
                step("a", "Migrate from Kilo v5"),
                step("b", "Sign in"),
            ),
        )

        val body = body(card)
        assertTrue("expected a bullet for step a, got: $body", body.contains("• Migrate from Kilo v5"))
        assertTrue("expected a bullet for step b, got: $body", body.contains("• Sign in"))
        assertEquals("expected one bullet per step", 2, body.count { it == '•' })
    }

    /**
     * The bullet list is a short overview; the longer per-step `detail` belongs to the dedicated
     * dialog UI. Including it here is what made a single bullet wrap over several lines.
     */
    fun `test bullets omit the long detail text`() {
        val detail = "We found settings from your previous installation. Here's what we can bring over."
        val card = OnboardingListCard()
        card.update(listOf(step("a", "Migrate from Kilo v5", detail)))

        val body = body(card)
        assertTrue("short title should be shown, got: $body", body.contains("• Migrate from Kilo v5"))
        assertFalse("long detail must not leak into the card, got: $body", body.contains(detail))
    }

    /**
     * The intro is long enough to overflow the narrow session card, so it must land in a wrapping
     * text component rather than a plain label that ellipsizes at paint time.
     */
    fun `test card text wraps rather than ellipsizing`() {
        val intro = KiloBundle.message("onboarding.list.subtitle")
        val card = OnboardingListCard()
        card.update(listOf(step("a", "Migrate from Kilo v5")))

        val carrier = texts(card).firstOrNull { it.text.contains(intro) }
            ?: error("intro not carried by any text component: ${body(card)}")
        assertTrue("card text must wrap rather than ellipsize", carrier.lineWrap)
        assertTrue("card text should wrap on word boundaries", carrier.wrapStyleWord)
    }

    fun `test action buttons are ordered skip all then later then start`() {
        val card = OnboardingListCard()
        card.update(listOf(step("a", "Migrate from Kilo v5")))

        val labels = buttons(card).map { it.text }
        assertEquals(
            listOf(
                KiloBundle.message("onboarding.button.skipAll"),
                KiloBundle.message("onboarding.button.later"),
                KiloBundle.message("onboarding.button.start"),
            ),
            labels,
        )
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
        card.update(listOf(step("a", "One")))
        val count = texts(card).size

        card.update(listOf(step("a", "One"), step("b", "Two")))
        card.update(listOf(step("a", "One")))

        assertEquals("repeated updates must not add text components", count, texts(card).size)
    }

    /**
     * Regression: `.properties` only collapses `''` to `'` when MessageFormat runs, which it does
     * not for a key with no params — so `Here''s` rendered literally in the UI.
     */
    fun `test no-param bundle strings render apostrophes literally`() {
        val detail = KiloBundle.message("onboarding.migration.detail")
        assertTrue("expected a real apostrophe, got: $detail", detail.contains("Here's"))
        assertFalse("escaped '' leaked into the UI string: $detail", detail.contains("''"))
    }
}
