package ai.kilocode.client.testing

import ai.kilocode.client.util.edtWait
import com.intellij.testFramework.PlatformTestUtil

/**
 * Shared EDT synchronization for frontend tests.
 *
 * Every async UI test should flush the EDT the same, robust way instead of each file rolling
 * its own `pump` with `UIUtil.dispatchAllInvocationEvents()`. That call can miss runnables
 * posted from background threads via `invokeLater` when the current modality state does not
 * match (e.g. a dialog left open by an earlier test) — a real cross-thread race under CI load.
 * [pumpEdt] uses the platform test drain, which flushes those runnables under any modality.
 *
 * Deadline-bounded predicate waiting lives in [TestCoroutines.pumpUntil]; see that helper for
 * draining coroutine + EDT work until a condition holds.
 */

/** Generous default watchdog for predicate waits. Waits return as soon as the condition holds. */
const val TEST_WAIT_MS: Long = 10_000

/**
 * Dispatch all queued EDT + `LaterInvocator` events on the EDT.
 *
 * Prefer this over `UIUtil.dispatchAllInvocationEvents()` in tests: it flushes background-posted
 * `invokeLater` runnables under any modality, which is the exact handoff async UI tests wait on.
 */
fun pumpEdt() {
    edtWait { PlatformTestUtil.dispatchAllInvocationEventsInIdeEventQueue() }
}
