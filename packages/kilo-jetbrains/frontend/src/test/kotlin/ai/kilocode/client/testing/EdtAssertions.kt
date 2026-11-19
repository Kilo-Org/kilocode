package ai.kilocode.client.testing

import com.intellij.openapi.application.ApplicationManager

/**
 * Assert that the current thread is NOT the EDT.
 * Used in fake RPC implementations to verify that RPC calls
 * are never made from the dispatch thread.
 */
fun assertNotEdt(method: String) {
    val app = ApplicationManager.getApplication() ?: return
    if (app.isDispatchThread) {
        throw AssertionError("RPC method '$method' must not be called on the EDT")
    }
}
