package ai.kilocode.client.session.controller

import ai.kilocode.client.testing.TestUiTimers
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class DelayedStateTest : BasePlatformTestCase() {
    private val states = mutableListOf<DelayedState>()
    private lateinit var timers: TestUiTimers

    override fun setUp() {
        super.setUp()
        timers = TestUiTimers()
    }

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
        timers.advanceBy(30)

        assertEquals(listOf("loading"), out)
    }

    fun `test run does not apply when current state changed`() {
        var state = "loading"
        val out = mutableListOf<String>()
        val delay = delayed(30)

        delay.run("loading", { state }) { out.add(it) }
        edt { state = "loaded" }
        timers.advanceBy(30)

        assertTrue(out.isEmpty())
    }

    fun `test multiple pending matching actions can run from shared timer`() {
        var first = "loading"
        var second = "connecting"
        val out = mutableListOf<String>()
        val delay = delayed(30)

        delay.run("loading", { first }) { out.add("first:$it") }
        delay.run("connecting", { second }) { out.add("second:$it") }
        timers.advanceBy(30)

        assertEquals(listOf("first:loading", "second:connecting"), out)
    }

    fun `test stale and matching pending actions are evaluated independently`() {
        var state = "first"
        val out = mutableListOf<String>()
        val delay = delayed(30)

        delay.run("first", { state }) { out.add(it) }
        edt { state = "second" }
        delay.run("second", { state }) { out.add(it) }
        timers.advanceBy(30)

        assertEquals(listOf("second"), out)
    }

    fun `test cancel suppresses pending actions`() {
        var state = "loading"
        val out = mutableListOf<String>()
        val delay = delayed(30)

        delay.run("loading", { state }) { out.add(it) }
        delay.cancel()
        timers.advanceBy(30)

        assertTrue(out.isEmpty())
    }

    fun `test cancel stops timer`() {
        var state = "loading"
        val delay = delayed(30)

        delay.run("loading", { state }) {}
        timers.advanceBy(10)
        delay.cancel()
        timers.advanceBy(10)

        assertFalse(delay.active())
    }

    fun `test timer stops after pending actions drain`() {
        var state = "loading"
        val delay = delayed(30)

        delay.run("loading", { state }) {}
        timers.advanceBy(30)

        assertFalse(delay.active())
    }

    fun `test dispose suppresses pending actions`() {
        var state = "loading"
        val out = mutableListOf<String>()
        val delay = delayed(30)

        delay.run("loading", { state }) { out.add(it) }
        Disposer.dispose(delay)
        states.remove(delay)
        timers.advanceBy(30)

        assertTrue(out.isEmpty())
    }

    fun `test zero delay applies on EDT`() {
        var state = "loading"
        val out = mutableListOf<Boolean>()
        val delay = delayed(0)

        delay.run("loading", { state }) {
            out.add(ApplicationManager.getApplication().isDispatchThread)
        }
        timers.advanceBy(0)

        assertEquals(listOf(true), out)
    }

    private fun delayed(ms: Long): DelayedState {
        val state = DelayedState(ms, timers)
        states.add(state)
        return state
    }

    private fun edt(block: () -> Unit) {
        ApplicationManager.getApplication().invokeAndWait(block)
    }
}
