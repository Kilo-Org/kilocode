package ai.kilocode.client.session.model

import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.util.Disposer

class ListenerLifecycleTest : SessionModelTestBase() {

    fun `test listener removed on parent dispose`() {
        val m = model()
        val disposable = Disposer.newDisposable("listener-parent")
        Disposer.register(parent, disposable)

        val events = mutableListOf<SessionEvent>()
        m.addListener(disposable) { events.add(it) }

        edt { m.prompt("before") }
        flush()
        val before = events.size

        Disposer.dispose(disposable)

        edt { m.prompt("after") }
        flush()

        assertEquals(before, events.size)
    }

    fun `test all listeners notified`() {
        val m = model()
        val events1 = mutableListOf<SessionEvent>()
        val events2 = mutableListOf<SessionEvent>()
        val d1 = Disposer.newDisposable("l1")
        val d2 = Disposer.newDisposable("l2")
        Disposer.register(parent, d1)
        Disposer.register(parent, d2)

        m.addListener(d1) { events1.add(it) }
        m.addListener(d2) { events2.add(it) }

        edt { m.prompt("go") }
        flush()

        assertTrue(events1.isNotEmpty())
        assertTrue(events2.isNotEmpty())
        assertEquals(events1.map { it::class }, events2.map { it::class })
    }

    fun `test session status busy fires BusyChanged`() {
        val m = model()
        val events = collect(m)

        edt { m.prompt("go") }
        flush()

        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("busy", null))
        flush()

        assertTrue(events.any { it is SessionEvent.BusyChanged && it.busy })
    }
}
