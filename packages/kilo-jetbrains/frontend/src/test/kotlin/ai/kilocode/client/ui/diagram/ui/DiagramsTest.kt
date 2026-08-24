package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.ui.diagram.Art
import ai.kilocode.client.ui.diagram.Engine
import ai.kilocode.client.ui.diagram.FontSpec
import ai.kilocode.client.ui.diagram.Out
import ai.kilocode.client.ui.diagram.Scene
import ai.kilocode.client.ui.diagram.Size
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.diagram.Type
import com.intellij.openapi.util.Disposer
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

    private fun spec(size: Int = 12) = Spec(FontSpec("Test", size))

    private class FakeEngine : Engine {
        var calls = 0
        var pause = false

        override fun accepts(type: Type) = true

        override suspend fun draw(source: String, spec: Spec): Out {
            calls++
            if (pause) awaitCancellation()
            return Out.Ok(Scene(Type.Flowchart, emptyList(), Size(20.0, 10.0)) as Art)
        }
    }
}
