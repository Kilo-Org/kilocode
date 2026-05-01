package ai.kilocode.client.session.update

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking

class DelayedStateTest : BasePlatformTestCase() {
    private val states = mutableListOf<DelayedState>()

    override fun tearDown() {
        try {
            states.forEach { Disposer.dispose(it) }
            states.clear()
        } finally {
            super.tearDown()
        }
    }

    fun `test run applies action after delay when state still matches`() {
        var state = "loading"
        val out = mutableListOf<String>()
        val delay = delayed(30)

        delay.run("loading", { state }) { out.add(it) }
        pause(120)

        assertEquals(listOf("loading"), out)
    }

    fun `test run does not apply when current state changed`() {
        var state = "loading"
        val out = mutableListOf<String>()
        val delay = delayed(30)

        delay.run("loading", { state }) { out.add(it) }
        edt { state = "loaded" }
        pause(120)

        assertTrue(out.isEmpty())
    }

    fun `test multiple pending matching actions can run from shared timer`() {
        var first = "loading"
        var second = "connecting"
        val out = mutableListOf<String>()
        val delay = delayed(30)

        delay.run("loading", { first }) { out.add("first:$it") }
        delay.run("connecting", { second }) { out.add("second:$it") }
        pause(120)

        assertEquals(listOf("first:loading", "second:connecting"), out)
    }

    fun `test stale and matching pending actions are evaluated independently`() {
        var state = "first"
        val out = mutableListOf<String>()
        val delay = delayed(30)

        delay.run("first", { state }) { out.add(it) }
        edt { state = "second" }
        delay.run("second", { state }) { out.add(it) }
        pause(120)

        assertEquals(listOf("second"), out)
    }

    fun `test cancel suppresses pending actions`() {
        var state = "loading"
        val out = mutableListOf<String>()
        val delay = delayed(30)

        delay.run("loading", { state }) { out.add(it) }
        delay.cancel()
        pause(120)

        assertTrue(out.isEmpty())
    }

    fun `test cancel stops timer`() {
        var state = "loading"
        val delay = delayed(30)

        delay.run("loading", { state }) {}
        pause(10)
        delay.cancel()
        pause(10)

        assertFalse(delay.active())
    }

    fun `test timer stops after pending actions drain`() {
        var state = "loading"
        val delay = delayed(30)

        delay.run("loading", { state }) {}
        pause(120)

        assertFalse(delay.active())
    }

    fun `test dispose suppresses pending actions`() {
        var state = "loading"
        val out = mutableListOf<String>()
        val delay = delayed(30)

        delay.run("loading", { state }) { out.add(it) }
        Disposer.dispose(delay)
        states.remove(delay)
        pause(120)

        assertTrue(out.isEmpty())
    }

    fun `test zero delay applies on EDT`() {
        var state = "loading"
        val out = mutableListOf<Boolean>()
        val delay = delayed(0)

        delay.run("loading", { state }) {
            out.add(ApplicationManager.getApplication().isDispatchThread)
        }
        pause(30)

        assertEquals(listOf(true), out)
    }

    private fun delayed(ms: Long): DelayedState {
        val state = DelayedState(ms)
        states.add(state)
        return state
    }

    private fun pause(ms: Long) = runBlocking {
        val tick = 10L
        repeat((ms / tick).coerceAtLeast(1).toInt()) {
            delay(tick)
            edt { UIUtil.dispatchAllInvocationEvents() }
        }
    }

    private fun edt(block: () -> Unit) {
        ApplicationManager.getApplication().invokeAndWait(block)
    }
}
