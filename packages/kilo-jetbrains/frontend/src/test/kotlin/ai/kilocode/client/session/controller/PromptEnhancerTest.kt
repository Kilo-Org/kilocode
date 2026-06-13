package ai.kilocode.client.session.controller

import com.intellij.openapi.application.ApplicationManager
import kotlinx.coroutines.CancellationException
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

    fun `test enhance prompt cancels pending completions on disposal`() {
        val controller = controller()
        val gate = CompletableDeferred<Unit>()
        val results = mutableListOf<Result<String>>()
        rpc.enhanceGate = gate

        edt {
            controller.enhancePrompt("make a plan") {
                assertTrue(ApplicationManager.getApplication().isDispatchThread)
                results.add(it)
            }
            controller.enhancePrompt("rewrite a plan") {
                assertTrue(ApplicationManager.getApplication().isDispatchThread)
                results.add(it)
            }
        }
        settle()
        controller.dispose()

        assertEquals(2, results.size)
        assertTrue(results.all { it.exceptionOrNull() is CancellationException })

        runBlocking { gate.complete(Unit) }
        settle()

        assertEquals(2, results.size)
    }
}
