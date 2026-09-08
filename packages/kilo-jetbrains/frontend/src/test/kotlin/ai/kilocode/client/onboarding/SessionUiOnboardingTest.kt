package ai.kilocode.client.onboarding

import ai.kilocode.client.session.SessionUiTestBase
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.onboarding.ui.OnboardingListCard
import java.awt.Container
import java.awt.Rectangle

@Suppress("UnstableApiUsage")
class SessionUiOnboardingTest : SessionUiTestBase() {

    private lateinit var fakeOnboarding: FakeOnboardingController

    override fun setUp() {
        super.setUp()
        // Replace the default UI with one using our observable fake onboarding controller.
        fakeOnboarding = FakeOnboardingController()
        ui = newUi(onboarding = fakeOnboarding)
        layout()
    }

    fun `test empty step list keeps blocker hidden`() {
        val root = find<SessionRootPanel>(ui)
        fakeOnboarding._steps.value = emptyList()
        settle()
        assertFalse(root.blocker.isVisible)
    }

    fun `test blocking step shows root blocker`() {
        val root = find<SessionRootPanel>(ui)
        fakeOnboarding._steps.value = listOf(sampleStep())
        settle()
        layout()
        assertTrue("blocker should be visible", root.blocker.isVisible)
        assertTrue("blocker should be opaque", root.blocker.isOpaque)
        assertEquals(Rectangle(0, 0, root.width, root.height), root.blocker.bounds)
        assertEquals(1, root.blocker.componentCount)
    }

    fun `test non-blocking step does not show root blocker`() {
        val root = find<SessionRootPanel>(ui)
        fakeOnboarding._steps.value = listOf(sampleStep(blocking = false))
        settle()
        assertFalse(root.blocker.isVisible)
    }

    fun `test hidden after visible hides blocker`() {
        val root = find<SessionRootPanel>(ui)
        fakeOnboarding._steps.value = listOf(sampleStep())
        settle()
        assertTrue(root.blocker.isVisible)

        fakeOnboarding._steps.value = emptyList()
        settle()
        assertFalse(root.blocker.isVisible)
        assertEquals(0, root.blocker.componentCount)
    }

    fun `test two session UIs sharing one controller both react to step change`() {
        val ui2 = newUi(onboarding = fakeOnboarding)
        ui2.setSize(800, 600)
        try {
            fakeOnboarding._steps.value = listOf(sampleStep())
            settle()

            val root1 = find<SessionRootPanel>(ui)
            val root2 = find<SessionRootPanel>(ui2)
            assertTrue("ui1 blocker should be visible", root1.blocker.isVisible)
            assertTrue("ui2 blocker should be visible", root2.blocker.isVisible)
        } finally {
            com.intellij.openapi.util.Disposer.dispose(ui2)
        }
    }

    fun `test default focused component is onboarding card when blocked`() {
        fakeOnboarding._steps.value = listOf(sampleStep())
        settle()
        val root = find<SessionRootPanel>(ui)
        assertTrue("blocker should be visible for defaultFocused test", root.blocker.isVisible)
        val card = find<OnboardingListCard>(ui)
        assertSame(card.preferredFocusComponent(), ui.defaultFocusedComponent)
        assertNotSame(find<PromptPanel>(ui).defaultFocusedComponent, ui.defaultFocusedComponent)
    }

    fun `test onboarding card is centered and width-capped in the modal blocker`() {
        fakeOnboarding._steps.value = listOf(sampleStep())
        settle()
        ui.setSize(1600, 1000)
        layout()

        val root = find<SessionRootPanel>(ui)
        val align = root.blocker.getComponent(0) as Container
        align.doLayout()
        val card = find<OnboardingListCard>(root.blocker)

        val pad = UiStyle.Gap.pad()
        assertEquals("left padding", pad, align.x)
        assertEquals("top padding", pad, align.y)
        assertEquals("right padding", pad, root.blocker.width - (align.x + align.width))
        assertEquals("bottom padding", pad, root.blocker.height - (align.y + align.height))
        assertTrue("card should not stretch to full width: ${card.bounds} in ${align.bounds}", card.width in 1 until align.width)
    }

    private fun sampleStep(blocking: Boolean = true) = OnboardingStep(
        id = "sample",
        need = OnboardingNeed(title = "Migrate from Kilo v5", detail = "We found settings to bring over."),
        blocking = blocking,
    )
}
