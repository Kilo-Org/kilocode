package ai.kilocode.client.testing

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.impl.LaterInvocator
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil

@Suppress("UnstableApiUsage")
class TestPumpTest : BasePlatformTestCase() {
    /**
     * Reproduces the CI hang: a modal entity left on the EDT stack (e.g. by an earlier test in
     * the shared JVM) makes `LaterInvocator` skip the NON_MODAL `invokeLater` callbacks that async
     * UI tests wait on, so plain event-queue pumping never dispatches them. [pumpEdt] must clear
     * the leaked modality so the skipped callback flushes.
     */
    fun `test pumpEdt flushes NON_MODAL callback skipped under a leaked modal`() {
        val entity = Any()
        var ran = false
        try {
            LaterInvocator.enterModal(entity)
            ApplicationManager.getApplication().invokeLater({ ran = true }, ModalityState.nonModal())

            // Plain queue pumping under the leaked modal does not dispatch the NON_MODAL callback.
            UIUtil.dispatchAllInvocationEvents()
            assertFalse("precondition: leaked modal should skip the NON_MODAL callback", ran)

            // pumpEdt clears the leaked modality and flushes the previously skipped callback.
            pumpEdt()
            assertTrue("pumpEdt must flush the callback that the leaked modal skipped", ran)
            assertSame(ModalityState.nonModal(), ModalityState.current())
        } finally {
            if (ModalityState.current() !== ModalityState.nonModal()) LaterInvocator.leaveAllModals()
        }
    }
}
