package ai.kilocode.client.session.controller

import com.intellij.openapi.application.ApplicationManager
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking

class PromptEnhancerTest : SessionControllerTestBase() {

    fun `test enhance prompt completes on EDT with workspace directory`() {
        val controller = controller()
        rpc.enhanced = "Use a focused implementation plan"
        var result: Result<String>? = null

        edt {
            controller.enhancePrompt("make a plan") {
                assertTrue(ApplicationManager.getApplication().isDispatchThread)
                result = it
            }
        }
        flush()

        assertEquals(listOf("/test" to "make a plan"), rpc.enhancements)
        assertEquals("Use a focused implementation plan", result!!.getOrThrow())
    }

    fun `test enhance prompt reports failure without changing session state`() {
        val controller = controller()
        rpc.enhanceThrows = IllegalStateException("provider unavailable")
        val before = edt { controller.model.state }
        var result: Result<String>? = null

        edt { controller.enhancePrompt("make a plan") { result = it } }
        flush()

        assertEquals("provider unavailable", result!!.exceptionOrNull()!!.message)
        assertSame(before, edt { controller.model.state })
    }

    fun `test enhance prompt ignores completion after disposal`() {
        val controller = controller()
        val gate = CompletableDeferred<Unit>()
        rpc.enhanceGate = gate
        var completed = false

        edt { controller.enhancePrompt("make a plan") { completed = true } }
        settle()
        controller.dispose()
        runBlocking { gate.complete(Unit) }
        settle()

        assertFalse(completed)
    }
}
