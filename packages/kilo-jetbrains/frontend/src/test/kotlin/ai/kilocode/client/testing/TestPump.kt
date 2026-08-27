package ai.kilocode.client.testing

import ai.kilocode.client.util.edtWait
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.impl.LaterInvocator
import com.intellij.testFramework.PlatformTestUtil

/**
 * Shared EDT synchronization for frontend tests.
 *
 * Every async UI test should flush the EDT the same, robust way instead of each file rolling
 * its own `pump` with `UIUtil.dispatchAllInvocationEvents()`.
 *
 * The frontend posts EDT continuations from background coroutines via `invokeLater`, which
 * carry a `NON_MODAL` modality. When a modal entity is left on the EDT modality stack — e.g. a
 * dialog an earlier test in the shared JVM failed to close — `LaterInvocator` *skips* those
 * `NON_MODAL` runnables, so no amount of event-queue pumping ever dispatches them. That wedges
 * a wait on a coroutine's EDT callback (the delete-failure revert is one such callback) until
 * the deadline. It only reproduces when class-discovery order puts a leaky test first, which is
 * why it surfaces on CI (Linux) and not locally.
 *
 * [pumpEdt] defends against that by resetting a leaked modality before draining, then flushing
 * the queue with the platform test drain. Deadline-bounded predicate waiting lives in
 * [TestCoroutines.pumpUntil].
 */

/** Generous default watchdog for predicate waits. Waits return as soon as the condition holds. */
const val TEST_WAIT_MS: Long = 10_000

/**
 * Dispatch all queued EDT + `LaterInvocator` events on the EDT.
 *
 * Prefer this over `UIUtil.dispatchAllInvocationEvents()` in tests: it flushes background-posted
 * `invokeLater` runnables under any modality, which is the exact handoff async UI tests wait on.
 * If a stray modal state leaked onto the EDT stack (which would otherwise indefinitely skip the
 * `NON_MODAL` callbacks those tests await), it is cleared first so the skipped runnables flush.
 */
fun pumpEdt() {
    edtWait {
        if (ModalityState.current() !== ModalityState.nonModal()) {
            LaterInvocator.leaveAllModals()
        }
        PlatformTestUtil.dispatchAllInvocationEventsInIdeEventQueue()
    }
}
