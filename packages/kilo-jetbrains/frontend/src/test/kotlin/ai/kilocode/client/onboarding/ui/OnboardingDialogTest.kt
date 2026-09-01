package ai.kilocode.client.onboarding.ui

import ai.kilocode.client.onboarding.FakeOnboardingController
import ai.kilocode.client.onboarding.FakeOnboardingProvider
import ai.kilocode.client.onboarding.FakeOnboardingStepView
import ai.kilocode.client.onboarding.OnboardingNeed
import ai.kilocode.client.onboarding.OnboardingRunState
import ai.kilocode.client.onboarding.OnboardingStep
import ai.kilocode.client.plugin.KiloBundle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil

@Suppress("UnstableApiUsage")
class OnboardingDialogTest : BasePlatformTestCase() {

    private fun step(id: String) = OnboardingStep(id, OnboardingNeed("Title $id", "Detail $id"), blocking = true)

    /** Drains posted EDT work so the dialog's coroutine-driven run-state watcher has applied. */
    private fun settle() = UIUtil.dispatchAllInvocationEvents()

    /** Buttons in visual (component tree) order. */
    private fun buttons(root: java.awt.Container): List<javax.swing.JButton> {
        val found = mutableListOf<javax.swing.JButton>()
        for (child in root.components) {
            if (child is javax.swing.JButton) found.add(child)
            if (child is java.awt.Container) found.addAll(buttons(child))
        }
        return found
    }

    /** The rail's real backing list, read off the live component tree (no test-only accessor). */
    private fun railList(root: java.awt.Container): javax.swing.JList<*> {
        fun find(c: java.awt.Container): javax.swing.JList<*>? {
            for (child in c.components) {
                if (child is javax.swing.JList<*>) return child
                if (child is java.awt.Container) find(child)?.let { return it }
            }
            return null
        }
        return find(root) ?: error("rail JList not found")
    }

    fun `test idle step shows later skip run and run is enabled when ready`() {
        val view = FakeOnboardingStepView(ready = true)
        val provider = FakeOnboardingProvider("a", newView = { view })
        val controller = FakeOnboardingController(mapOf("a" to provider))
        val dialog = OnboardingDialog(controller, listOf(step("a"))) {}

        assertTrue(dialog.laterButton.isVisible)
        assertTrue(dialog.skipButton.isVisible)
        assertTrue(dialog.runButton.isVisible)
        assertTrue(dialog.runButton.isEnabled)
        assertFalse(dialog.nextButton.isVisible)
    }

    fun `test dialog shows the selected step's long detail text`() {
        val viewA = FakeOnboardingStepView(ready = true)
        val viewB = FakeOnboardingStepView(ready = true)
        val providerA = FakeOnboardingProvider("a", newView = { viewA })
        val providerB = FakeOnboardingProvider("b", newView = { viewB })
        val controller = FakeOnboardingController(mapOf("a" to providerA, "b" to providerB))
        val dialog = OnboardingDialog(controller, listOf(step("a"), step("b"))) {}

        // The long detail belongs to this dedicated UI, not the session list card.
        assertEquals("Detail a", dialog.detail.text)

        dialog.rail.select("b")
        assertEquals("Detail b", dialog.detail.text)
    }

    fun `test step state present at construction is reflected without any edt pump`() {
        // The dialog is modal, so it cannot rely on queued EDT work to compute its initial button
        // state — a step that is already Done/not-ready when the dialog opens must render
        // correctly on first paint. Deliberately no settle() here.
        val view = FakeOnboardingStepView(ready = true)
        view._run.value = OnboardingRunState.Done
        val provider = FakeOnboardingProvider("a", newView = { view })
        val controller = FakeOnboardingController(mapOf("a" to provider))
        val dialog = OnboardingDialog(controller, listOf(step("a"))) {}

        assertFalse(dialog.runButton.isVisible)
        assertFalse(dialog.laterButton.isVisible)
        assertFalse(dialog.skipButton.isVisible)
        assertTrue(dialog.nextButton.isVisible)
    }

    fun `test footer buttons are ordered skip then later then run`() {
        val view = FakeOnboardingStepView(ready = true)
        val provider = FakeOnboardingProvider("a", newView = { view })
        val controller = FakeOnboardingController(mapOf("a" to provider))
        val dialog = OnboardingDialog(controller, listOf(step("a"))) {}

        // Matches the session list card's Skip All / Later / Start ordering. Read off the real
        // footer container, so this reflects child/layout order.
        val labels = buttons(dialog.footer).filter { it.isVisible }.map { it.text }
        assertEquals(
            listOf(
                KiloBundle.message("onboarding.button.skip"),
                KiloBundle.message("onboarding.button.later"),
                KiloBundle.message("onboarding.button.run"),
            ),
            labels,
        )
    }

    fun `test run disabled when step not ready`() {
        val view = FakeOnboardingStepView(ready = false)
        val provider = FakeOnboardingProvider("a", newView = { view })
        val controller = FakeOnboardingController(mapOf("a" to provider))
        val dialog = OnboardingDialog(controller, listOf(step("a"))) {}

        assertFalse(dialog.runButton.isEnabled)
    }

    fun `test running step disables run and hides later skip and locks the rail`() {
        val view = FakeOnboardingStepView(ready = true)
        val provider = FakeOnboardingProvider("a", newView = { view })
        val controller = FakeOnboardingController(mapOf("a" to provider))
        val dialog = OnboardingDialog(controller, listOf(step("a"))) {}

        dialog.runButton.doClick()

        assertEquals(1, view.starts.size)
        assertFalse(dialog.laterButton.isVisible)
        assertFalse(dialog.skipButton.isVisible)
        assertFalse(dialog.runButton.isEnabled)
        assertFalse("locked rail must disable the underlying list", railList(dialog.rail).isEnabled)
    }

    fun `test done step shows only next and calls view done then closes on the last step`() {
        val view = FakeOnboardingStepView(ready = true)
        val provider = FakeOnboardingProvider("a", newView = { view })
        val controller = FakeOnboardingController(mapOf("a" to provider))
        var closed = false
        val dialog = OnboardingDialog(controller, listOf(step("a"))) { closed = true }

        view._run.value = OnboardingRunState.Done
        settle()

        assertFalse(dialog.laterButton.isVisible)
        assertFalse(dialog.skipButton.isVisible)
        assertFalse(dialog.runButton.isVisible)
        assertTrue(dialog.nextButton.isVisible)
        assertEquals("Finish", dialog.nextButton.text)

        dialog.nextButton.doClick()
        assertEquals(1, view.dones.size)
        assertTrue("dialog should close on the last step's Next", closed)
    }

    fun `test next advances to the second step without closing`() {
        val viewA = FakeOnboardingStepView(ready = true)
        val viewB = FakeOnboardingStepView(ready = true)
        val providerA = FakeOnboardingProvider("a", newView = { viewA })
        val providerB = FakeOnboardingProvider("b", newView = { viewB })
        val controller = FakeOnboardingController(mapOf("a" to providerA, "b" to providerB))
        var closed = false
        val dialog = OnboardingDialog(controller, listOf(step("a"), step("b"))) { closed = true }

        viewA._run.value = OnboardingRunState.Done
        settle()
        assertEquals("Next", dialog.nextButton.text)
        dialog.nextButton.doClick()

        assertFalse("should not close with a second step pending", closed)
        assertEquals("b", dialog.rail.selected()?.key)
    }

    fun `test later on a step delegates to controller and advances`() {
        val viewA = FakeOnboardingStepView(ready = true)
        val viewB = FakeOnboardingStepView(ready = true)
        val providerA = FakeOnboardingProvider("a", newView = { viewA })
        val providerB = FakeOnboardingProvider("b", newView = { viewB })
        val controller = FakeOnboardingController(mapOf("a" to providerA, "b" to providerB))
        val dialog = OnboardingDialog(controller, listOf(step("a"), step("b"))) {}

        dialog.laterButton.doClick()

        assertEquals(listOf("a"), controller.laterSteps)
        assertEquals("b", dialog.rail.selected()?.key)
    }

    fun `test skip on a step delegates to controller and advances`() {
        val viewA = FakeOnboardingStepView(ready = true)
        val viewB = FakeOnboardingStepView(ready = true)
        val providerA = FakeOnboardingProvider("a", newView = { viewA })
        val providerB = FakeOnboardingProvider("b", newView = { viewB })
        val controller = FakeOnboardingController(mapOf("a" to providerA, "b" to providerB))
        val dialog = OnboardingDialog(controller, listOf(step("a"), step("b"))) {}

        dialog.skipButton.doClick()

        assertEquals(listOf("a"), controller.skipSteps)
        assertEquals("b", dialog.rail.selected()?.key)
    }

    fun `test cancel is a no-op while the selected step is running`() {
        val view = FakeOnboardingStepView(ready = true)
        val provider = FakeOnboardingProvider("a", newView = { view })
        val controller = FakeOnboardingController(mapOf("a" to provider))
        var closed = false
        val dialog = OnboardingDialog(controller, listOf(step("a"))) { closed = true }

        dialog.runButton.doClick()
        dialog.doCancelAction()

        assertFalse("cancel must not close the dialog while running", closed)
    }

    fun `test cancel after a finished run still finalizes the step`() {
        val view = FakeOnboardingStepView(ready = true)
        val provider = FakeOnboardingProvider("a", newView = { view })
        val controller = FakeOnboardingController(mapOf("a" to provider))
        var closed = false
        val dialog = OnboardingDialog(controller, listOf(step("a"))) { closed = true }

        view._run.value = OnboardingRunState.Done
        settle()
        // Escape / the window close box bypass Next, but done() is what commits the run.
        dialog.doCancelAction()

        assertTrue(closed)
        assertEquals(1, view.dones.size)
    }

    fun `test cancel after a failed run still finalizes the step`() {
        val view = FakeOnboardingStepView(ready = true)
        val provider = FakeOnboardingProvider("a", newView = { view })
        val controller = FakeOnboardingController(mapOf("a" to provider))
        val dialog = OnboardingDialog(controller, listOf(step("a"))) {}

        view._run.value = OnboardingRunState.Failed("boom")
        settle()
        dialog.doCancelAction()

        assertEquals(1, view.dones.size)
    }

    fun `test cancel before running does not finalize the step`() {
        val view = FakeOnboardingStepView(ready = true)
        val provider = FakeOnboardingProvider("a", newView = { view })
        val controller = FakeOnboardingController(mapOf("a" to provider))
        val dialog = OnboardingDialog(controller, listOf(step("a"))) {}

        dialog.doCancelAction()

        assertTrue("an untouched step must not be finalized on dismiss", view.dones.isEmpty())
    }

    fun `test next then cancel finalizes the finished step only once`() {
        val viewA = FakeOnboardingStepView(ready = true)
        val viewB = FakeOnboardingStepView(ready = true)
        val providerA = FakeOnboardingProvider("a", newView = { viewA })
        val providerB = FakeOnboardingProvider("b", newView = { viewB })
        val controller = FakeOnboardingController(mapOf("a" to providerA, "b" to providerB))
        val dialog = OnboardingDialog(controller, listOf(step("a"), step("b"))) {}

        viewA._run.value = OnboardingRunState.Done
        settle()
        dialog.nextButton.doClick()
        dialog.doCancelAction()

        assertEquals(1, viewA.dones.size)
        assertTrue(viewB.dones.isEmpty())
    }

    fun `test selecting a different rail row swaps the right panel and buttons`() {
        val viewA = FakeOnboardingStepView(ready = true)
        val viewB = FakeOnboardingStepView(ready = false)
        val providerA = FakeOnboardingProvider("a", newView = { viewA })
        val providerB = FakeOnboardingProvider("b", newView = { viewB })
        val controller = FakeOnboardingController(mapOf("a" to providerA, "b" to providerB))
        val dialog = OnboardingDialog(controller, listOf(step("a"), step("b"))) {}

        assertTrue(dialog.runButton.isEnabled)
        dialog.rail.select("b")
        assertFalse("selecting step b's not-ready view should disable Run", dialog.runButton.isEnabled)
    }
}
