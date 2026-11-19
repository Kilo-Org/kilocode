package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.ui.diagram.Art
import ai.kilocode.client.ui.diagram.Engine
import ai.kilocode.client.ui.diagram.Fault
import ai.kilocode.client.ui.diagram.FontSpec
import ai.kilocode.client.ui.diagram.Limits
import ai.kilocode.client.ui.diagram.Out
import ai.kilocode.client.ui.diagram.Scene
import ai.kilocode.client.ui.diagram.Size
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.diagram.Type
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.LoggedErrorProcessor
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.awaitCancellation

class DiagramsTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var engine: FakeEngine
    private lateinit var service: Diagrams

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        engine = FakeEngine()
        service = Diagrams(coroutines.scope, engine)
    }

    override fun tearDown() {
        try {
            coroutines.close()
        } finally {
            super.tearDown()
        }
    }

    fun `test miss resolves then identical request is synchronous cache hit`() {
        val owner = Disposer.newDisposable("diagram")
        val calls = mutableListOf<Out>()

        service.render("flowchart TD\nA-->B", spec(), owner) { calls.add(it) }
        assertTrue(calls.isEmpty())
        coroutines.drain()
        assertEquals(1, calls.size)
        assertEquals(1, engine.calls)

        service.render("flowchart TD\nA-->B", spec(), owner) { calls.add(it) }
        assertEquals(2, calls.size)
        assertEquals(1, engine.calls)
        Disposer.dispose(owner)
    }

    fun `test different font misses cache`() {
        val owner = Disposer.newDisposable("diagram")

        service.render("flowchart TD\nA-->B", spec(12), owner) {}
        coroutines.drain()
        service.render("flowchart TD\nA-->B", spec(13), owner) {}
        coroutines.drain()

        assertEquals(2, engine.calls)
        Disposer.dispose(owner)
    }

    fun `test owner dispose cancels render callback`() {
        val owner = Disposer.newDisposable("diagram")
        engine.pause = true
        var called = false

        service.render("flowchart TD\nA-->B", spec(), owner) { called = true }
        Disposer.dispose(owner)
        coroutines.drain(::pumpEdt)

        assertFalse(called)
    }

    /**
     * A crash in the engine is the caller's cue to keep showing the source, but it is only actionable if
     * the stack trace reaches the log: the fault message alone says nothing about where it came from.
     */
    fun `test engine crash is logged with its stack trace and reported as an internal fault`() {
        val owner = Disposer.newDisposable("diagram")
        val calls = mutableListOf<Out>()
        engine.fail = IllegalStateException("boom")

        val logged = LoggedErrorProcessor.executeAndReturnLoggedError {
            service.render("flowchart TD\nA-->B", spec(), owner) { calls.add(it) }
            coroutines.drain()
        }

        val out = calls.single() as Out.Err
        assertEquals(Fault.Internal, out.fault)
        assertEquals("boom", out.message)
        assertEquals("boom", logged.message)
        assertEquals(IllegalStateException::class.java, logged.javaClass)
        Disposer.dispose(owner)
    }

    fun `test an internal fault is not cached so the next attempt can recover`() {
        val owner = Disposer.newDisposable("diagram")
        val calls = mutableListOf<Out>()
        engine.fail = IllegalStateException("boom")

        LoggedErrorProcessor.executeAndReturnLoggedError {
            service.render("flowchart TD\nA-->B", spec(), owner) { calls.add(it) }
            coroutines.drain()
        }
        engine.fail = null
        service.render("flowchart TD\nA-->B", spec(), owner) { calls.add(it) }
        coroutines.drain()

        assertEquals(2, engine.calls)
        assertTrue(calls.last() is Out.Ok)
        Disposer.dispose(owner)
    }

    /** Syntax, limit and unsupported outcomes are deterministic, so they stay cached. */
    fun `test a refusal is cached`() {
        val owner = Disposer.newDisposable("diagram")
        engine.out = Out.Err(Fault.Syntax, "bad")

        service.render("flowchart TD\nA-->", spec(), owner) {}
        coroutines.drain()
        service.render("flowchart TD\nA-->", spec(), owner) {}

        assertEquals(1, engine.calls)
        Disposer.dispose(owner)
    }

    /** Cancellation is cooperative, so a phase that never yields still has to end somewhere. */
    fun `test a hung engine ends as a limit fault instead of rendering forever`() {
        val owner = Disposer.newDisposable("diagram")
        val calls = mutableListOf<Out>()
        engine.pause = true

        service.render("flowchart TD\nA-->B", spec().copy(limits = Limits(millis = 1)), owner) { calls.add(it) }
        assertTrue("the render never settled", coroutines.pumpUntil { calls.isNotEmpty() })

        val out = calls.single() as Out.Err
        assertEquals(Fault.Limit, out.fault)
        assertTrue(out.message, out.message.contains("1 ms"))
        Disposer.dispose(owner)
    }

    /**
     * A callback that throws must not escape into the service scope: it would be reported as a plugin
     * error and the result would never be recorded, leaving the caller pending forever.
     */
    fun `test a failing callback is contained and the result is still cached`() {
        val owner = Disposer.newDisposable("diagram")
        val calls = mutableListOf<Out>()

        LoggedErrorProcessor.executeAndReturnLoggedError {
            service.render("flowchart TD\nA-->B", spec(), owner) { throw IllegalStateException("callback") }
            coroutines.drain()
        }
        service.render("flowchart TD\nA-->B", spec(), owner) { calls.add(it) }

        assertEquals(1, engine.calls)
        assertEquals(1, calls.size)
        Disposer.dispose(owner)
    }

    private fun spec(size: Int = 12) = Spec(FontSpec("Test", size))

    private class FakeEngine : Engine {
        var calls = 0
        var pause = false
        var fail: Exception? = null
        var out: Out? = null

        override fun accepts(type: Type) = true

        override suspend fun draw(source: String, spec: Spec): Out {
            calls++
            fail?.let { throw it }
            if (pause) awaitCancellation()
            return out ?: Out.Ok(Scene(Type.Flowchart, emptyList(), Size(20.0, 10.0)) as Art)
        }
    }
}
