package ai.kilocode.client.session.controller

import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.MessageWithPartsDto
import com.intellij.openapi.util.Disposer
import kotlinx.coroutines.CompletableDeferred

/**
 * Tests that disposed [SessionController] ignores all late async completions.
 */
class DisposedStateTest : SessionControllerTestBase() {

    fun `test dispose during local session loading emits no late model events`() {
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        val m = controller("ses_test")
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        Disposer.dispose(m)
        gate.complete(Unit)
        flush()

        assertTrue("expected no model events after dispose, got: $modelEvents", modelEvents.isEmpty())
    }

    fun `test dispose during local session loading emits no controller events`() {
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        val m = controller("ses_test")
        val events = collect(m)
        flush()
        events.clear()

        Disposer.dispose(m)
        gate.complete(Unit)
        flush()

        assertTrue("expected no controller events after dispose, got: $events", events.isEmpty())
    }

    fun `test dispose during cloud import emits no model events`() {
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        rpc.importedCloudSession = session("ses_imported")
        val m = controller("cloud:cloud_1")
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        Disposer.dispose(m)
        gate.complete(Unit)
        flush()

        assertTrue("expected no model events after cloud dispose, got: $modelEvents", modelEvents.isEmpty())
    }

    fun `test dispose during recents loading emits no recents event`() {
        projectRpc.state.value = workspaceReady()
        val gate = CompletableDeferred<Unit>()
        rpc.recentGate = gate
        val m = controller()
        val events = collect(m)
        flush()
        events.clear()

        Disposer.dispose(m)
        gate.complete(Unit)
        flush()

        assertFalse(events.any { it is SessionControllerEvent.ViewChanged.ShowRecents })
    }

    fun `test disposed controller addListener is no-op`() {
        val m = controller("ses_test")
        flush()
        Disposer.dispose(m)

        val extra = mutableListOf<SessionControllerEvent>()
        val disposable = Disposer.newDisposable("extra")
        Disposer.register(parent, disposable)
        m.addListener(disposable) { extra.add(it) }

        assertTrue(extra.isEmpty())
    }

    fun `test dispose marks controller disposed and blocks model updates`() {
        val m = controller("ses_test")
        flush()
        val modelEvents = collectModelEvents(m)

        Disposer.dispose(m)
        edt {
            // Simulate a late model mutation attempt on EDT after dispose
            // updateModel is no-op when disposed
            m.flushEvents()
        }

        assertTrue(modelEvents.isEmpty())
    }

    fun `test session load state is idle after normal load completes`() {
        rpc.history.add(MessageWithPartsDto(msg("msg1", "ses_test", "user"), emptyList()))
        val m = controller("ses_test")
        flush()

        var snap: ControllerStateSnapshot? = null
        edt { snap = m.snapshotState() }
        assertEquals("Idle", snap!!.sessionLoadState)
    }

    fun `test session load state is loading before history arrives`() {
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        val m = controller("ses_test")

        edt {
            assertEquals(SessionState.Loading, m.model.state)
            val snap = m.snapshotState()
            assertTrue("expected Loading in: ${snap.sessionLoadState}", snap.sessionLoadState.startsWith("Loading"))
        }

        gate.complete(Unit)
        flush()
    }
}
