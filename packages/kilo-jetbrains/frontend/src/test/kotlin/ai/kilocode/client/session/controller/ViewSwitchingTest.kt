package ai.kilocode.client.session.controller

import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ProfileBalanceDto
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.ProfileOrganizationDto
import kotlinx.coroutines.CompletableDeferred

class ViewSwitchingTest : SessionControllerTestBase() {

    fun `test first prompt shows messages view`() {
        val m = controller()
        val events = collect(m)
        flush()
        events.clear()

        edt { m.prompt("hello") }
        flush()

        assertControllerEvents("ViewChanged session", events)
        assertSession(
            """
            [app: DISCONNECTED] [workspace: PENDING]
            """,
            m,
        )
    }

    fun `test session event sees updated view state on EDT`() {
        val m = controller()
        val states = collectStates(m)
        flush()
        states.clear()

        edt { m.prompt("hello") }
        flush()

        val state = states.single { it.first is SessionControllerEvent.ViewChanged.ShowSession }.second
        assertTrue(state.showSession)
        assertEquals(SessionControllerEvent.ViewChanged.ShowSession, state.viewState)
    }

    fun `test ViewChanged not fired twice`() {
        val m = controller()
        val events = collect(m)
        flush()
        events.clear()

        edt { m.prompt("first") }
        flush()
        edt { m.prompt("second") }
        flush()

        assertControllerEvents("ViewChanged session", events)
    }

    fun `test recent sessions show after workspace ready`() {
        projectRpc.state.value = workspaceReady()
        rpc.recent.add(session("ses_1"))
        val m = controller()
        val events = collect(m)

        flush()

        assertTrue(rpc.recentCalls.contains("/test" to SessionController.RECENT_LIMIT))
        assertControllerEvents("""
            AccountOverlayChanged hide
            AccountOverlayChanged show loggedIn=false
            AppChanged
            WorkspaceChanged
            WorkspaceReady
            ViewChanged recents=1
        """, events)
    }

    fun `test recent load failure shows empty recents`() {
        projectRpc.state.value = workspaceReady()
        rpc.recentFailures = 1
        val m = controller()
        val events = collect(m)

        flush()

        assertTrue(rpc.recentCalls.contains("/test" to SessionController.RECENT_LIMIT))
        assertControllerEvents("""
            AccountOverlayChanged hide
            AccountOverlayChanged show loggedIn=false
            AppChanged
            WorkspaceChanged
            WorkspaceReady
            ViewChanged recents=0
        """, events)
    }

    fun `test empty explicit session history shows session view`() {
        rpc.recent.add(session("ses_1"))
        val m = controller("ses_test", displayMs = 1_000)
        val events = collect(m)

        flush()

        assertTrue(rpc.recentCalls.isEmpty())
        assertControllerEvents("""
            AccountOverlayChanged hide
            AppChanged
            WorkspaceChanged
            ViewChanged progress
            ViewChanged session
        """, events)
        assertTrue(m.model.showSession)
        assertFalse(events.any { it is SessionControllerEvent.ViewChanged.ShowRecents })
    }

    fun `test workspace ready does not load recents during explicit local load`() {
        projectRpc.state.value = workspaceReady()
        rpc.recent.add(session("ses_1"))
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        val m = controller("ses_test", displayMs = 50)
        val events = collect(m)

        pause(80)

        assertTrue(rpc.recentCalls.isEmpty())
        assertTrue(events.any { it is SessionControllerEvent.ViewChanged.ShowProgress })
        assertFalse(events.any { it is SessionControllerEvent.ViewChanged.ShowRecents })

        gate.complete(Unit)
        flush()

        assertTrue(rpc.recentCalls.isEmpty())
        assertTrue(events.any { it is SessionControllerEvent.ViewChanged.ShowSession })
        assertFalse(events.any { it is SessionControllerEvent.ViewChanged.ShowRecents })
    }

    fun `test workspace ready does not load recents during cloud import`() {
        projectRpc.state.value = workspaceReady()
        rpc.recent.add(session("ses_1"))
        rpc.importedCloudSession = session("ses_imported")
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        val m = controller("cloud:cloud_1", displayMs = 50)
        val events = collect(m)

        pause(80)

        assertTrue(rpc.recentCalls.isEmpty())
        assertTrue(events.any { it is SessionControllerEvent.ViewChanged.ShowProgress })
        assertFalse(events.any { it is SessionControllerEvent.ViewChanged.ShowRecents })

        gate.complete(Unit)
        flush()

        assertTrue(rpc.recentCalls.isEmpty())
        assertTrue(events.any { it is SessionControllerEvent.ViewChanged.ShowSession })
        assertFalse(events.any { it is SessionControllerEvent.ViewChanged.ShowRecents })
    }

    fun `test local history session event sees loaded state on EDT`() {
        projectRpc.state.value = workspaceReady()
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        val m = controller("ses_test", displayMs = 50)
        val states = collectStates(m)

        gate.complete(Unit)
        flush()

        val state = states.single { it.first is SessionControllerEvent.ViewChanged.ShowSession }.second
        assertTrue(state.showSession)
        assertEquals(SessionControllerEvent.ViewChanged.ShowSession, state.viewState)
        assertEquals("Idle", state.sessionLoadState)
        assertEquals("Idle", state.recentsState)
        assertEquals("ses_test", state.refKey)
        assertEquals("LOCAL", state.refType)
    }

    fun `test cloud history session event sees imported local state on EDT`() {
        projectRpc.state.value = workspaceReady()
        rpc.importedCloudSession = session("ses_imported")
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        val m = controller("cloud:cloud_1", displayMs = 50)
        val states = collectStates(m)

        gate.complete(Unit)
        flush()

        val state = states.single { it.first is SessionControllerEvent.ViewChanged.ShowSession }.second
        assertTrue(state.showSession)
        assertEquals(SessionControllerEvent.ViewChanged.ShowSession, state.viewState)
        assertEquals("Idle", state.sessionLoadState)
        assertEquals("Idle", state.recentsState)
        assertEquals("ses_imported", state.refKey)
        assertEquals("LOCAL", state.refType)
    }

    fun `test existing session load shows progress immediately`() {
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        val m = controller("ses_test", displayMs = 1_000)
        val events = collect(m)

        assertEquals(SessionState.Loading, m.model.state)
        pause(20)

        assertTrue(events.any { it is SessionControllerEvent.ViewChanged.ShowProgress })
        gate.complete(Unit)
        flush()
    }

    fun `test slow recents do not show progress then emit recents when complete`() {
        projectRpc.state.value = workspaceReady()
        rpc.recent.add(session("ses_1"))
        val gate = CompletableDeferred<Unit>()
        rpc.recentGate = gate
        val m = controller(displayMs = 50)
        val events = collect(m)

        pause(20)
        assertTrue(rpc.recentCalls.contains("/test" to SessionController.RECENT_LIMIT))
        assertFalse(events.any { it is SessionControllerEvent.ViewChanged.ShowProgress })

        pause(80)
        // Slow recents must NOT show progress even after the delay interval
        assertFalse(events.any { it is SessionControllerEvent.ViewChanged.ShowProgress })

        gate.complete(Unit)
        flush()

        // After completing, recents must fire directly (no prior progress event)
        assertFalse(events.any { it is SessionControllerEvent.ViewChanged.ShowProgress })
        assertEquals(1, events.count { it is SessionControllerEvent.ViewChanged.ShowRecents })
        val recentsView = events.filterIsInstance<SessionControllerEvent.ViewChanged>()
        assertEquals("ViewChanged recents=1", recentsView.last().toString())
    }

    fun `test recents loaded state visible on EDT when recents event fires`() {
        projectRpc.state.value = workspaceReady()
        rpc.recent.add(session("ses_1"))
        val gate = CompletableDeferred<Unit>()
        rpc.recentGate = gate
        val m = controller(displayMs = 50)
        val states = collectStates(m)

        gate.complete(Unit)
        flush()

        assertFalse(states.any { it.first is SessionControllerEvent.ViewChanged.ShowProgress })
        val state = states.single { it.first is SessionControllerEvent.ViewChanged.ShowRecents }.second
        assertEquals("Loaded", state.recentsState)
    }

    fun `test fast recents suppress progress`() {
        projectRpc.state.value = workspaceReady()
        rpc.recent.add(session("ses_1"))
        val m = controller(displayMs = 1_000)
        val events = collect(m)

        flush()

        assertTrue(rpc.recentCalls.contains("/test" to SessionController.RECENT_LIMIT))
        assertFalse(events.any { it is SessionControllerEvent.ViewChanged.ShowProgress })
        assertTrue(events.any { it is SessionControllerEvent.ViewChanged.ShowRecents })
    }

    fun `test recents event sees loaded state on EDT`() {
        projectRpc.state.value = workspaceReady()
        rpc.recent.add(session("ses_1"))
        val m = controller(displayMs = 1_000)
        val states = collectStates(m)

        flush()

        val event = states.single { it.first is SessionControllerEvent.ViewChanged.ShowRecents }
        assertEquals(event.first, event.second.viewState)
        assertEquals("Loaded", event.second.recentsState)
    }

    fun `test failed fast recents suppress progress and show empty recents`() {
        projectRpc.state.value = workspaceReady()
        rpc.recentFailures = 1
        val m = controller(displayMs = 1_000)
        val events = collect(m)

        flush()

        assertFalse(events.any { it is SessionControllerEvent.ViewChanged.ShowProgress })
        assertEquals(1, events.count { it is SessionControllerEvent.ViewChanged.ShowRecents })
        assertTrue(events.filterIsInstance<SessionControllerEvent.ViewChanged.ShowRecents>().single().recents.isEmpty())
    }

    fun `test recents progress is canceled when messages view appears`() {
        projectRpc.state.value = workspaceReady()
        rpc.recent.add(session("ses_1"))
        val gate = CompletableDeferred<Unit>()
        rpc.recentGate = gate
        val m = controller(displayMs = 50)
        val events = collect(m)

        pause(20)
        edt { m.prompt("hello") }
        pause(80)
        gate.complete(Unit)
        flush()

        assertTrue(events.any { it is SessionControllerEvent.ViewChanged.ShowSession })
        assertFalse(events.any { it is SessionControllerEvent.ViewChanged.ShowProgress })
        assertFalse(events.any { it is SessionControllerEvent.ViewChanged.ShowRecents })
    }

    fun `test id-only local ref starts with local identity`() {
        val m = controller(SessionRef.Local("ses_test"))

        flush()

        val snap = m.snapshotState()
        assertEquals("ses_test", snap.refKey)
        assertEquals("LOCAL", snap.refType)
    }

    fun `test cloud ref becomes local after import`() {
        rpc.importedCloudSession = session("ses_imported")
        val m = controller(SessionRef.Cloud("cloud_1"))

        val start = m.snapshotState()
        assertEquals("cloud:cloud_1", start.refKey)
        assertEquals("CLOUD", start.refType)

        flush()

        val end = m.snapshotState()
        assertEquals("ses_imported", end.refKey)
        assertEquals("LOCAL", end.refType)
    }

    fun `test prompt updates blank controller to local ref`() {
        val m = controller()

        flush()
        edt { m.prompt("hello") }
        flush()

        val snap = m.snapshotState()
        assertEquals("ses_test", snap.refKey)
        assertEquals("LOCAL", snap.refType)
    }

    private fun session(id: String) = ai.kilocode.rpc.dto.SessionDto(
        id = id,
        projectID = "prj",
        directory = "/test",
        title = "Title $id",
        version = "1",
        time = ai.kilocode.rpc.dto.SessionTimeDto(created = 1.0, updated = 2.0),
    )

    // --- account overlay controller tests ---

    fun `test empty session with workspace ready emits account overlay show`() {
        projectRpc.state.value = workspaceReady()
        rpc.recent.add(session("ses_1"))
        val m = controller()
        val events = collect(m)

        flush()

        assertTrue(events.any { it is SessionControllerEvent.AccountOverlayChanged.Show })
        val show = events.filterIsInstance<SessionControllerEvent.AccountOverlayChanged.Show>().last()
        assertEquals("AccountOverlayChanged show loggedIn=false", show.toString())
    }

    fun `test empty session overlay show includes logged in profile`() {
        projectRpc.state.value = workspaceReady()
        rpc.recent.add(session("ses_1"))
        val prof = ProfileDto(
            email = "user@example.com",
            name = "Test User",
            balance = ProfileBalanceDto(10.0),
        )
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = prof)
        val m = controller()
        val events = collect(m)

        flush()

        val show = events.filterIsInstance<SessionControllerEvent.AccountOverlayChanged.Show>().last()
        assertEquals("AccountOverlayChanged show loggedIn=true", show.toString())
        assertEquals(prof.email, show.account.profile?.email)
    }

    fun `test first prompt hides overlay`() {
        projectRpc.state.value = workspaceReady()
        rpc.recent.add(session("ses_1"))
        val m = controller()
        flush()
        val events = collect(m)

        edt { m.prompt("hello") }
        flush()

        assertTrue(events.any { it is SessionControllerEvent.AccountOverlayChanged.Hide })
        assertFalse(events.filterIsInstance<SessionControllerEvent.AccountOverlayChanged.Show>().any { it.account.profile != null })
    }

    fun `test explicit local session load never shows overlay`() {
        projectRpc.state.value = workspaceReady()
        rpc.recent.add(session("ses_1"))
        val m = controller("ses_test")
        val events = collect(m)

        flush()

        assertFalse(events.any { it is SessionControllerEvent.AccountOverlayChanged.Show })
    }

    fun `test explicit cloud import never shows overlay`() {
        projectRpc.state.value = workspaceReady()
        rpc.importedCloudSession = session("ses_imported")
        rpc.recent.add(session("ses_1"))
        val m = controller("cloud:cloud_1")
        val events = collect(m)

        flush()

        assertFalse(events.any { it is SessionControllerEvent.AccountOverlayChanged.Show })
    }

    fun `test app profile change refreshes overlay while allowed`() {
        projectRpc.state.value = workspaceReady()
        rpc.recent.add(session("ses_1"))
        val m = controller()
        val events = collect(m)
        flush()

        val prof = ProfileDto(email = "user@example.com", balance = ProfileBalanceDto(20.0))
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = prof)
        flush()

        val shows = events.filterIsInstance<SessionControllerEvent.AccountOverlayChanged.Show>()
        assertTrue(shows.isNotEmpty())
        assertTrue(shows.last().account.profile?.email == "user@example.com")
    }

    fun `test selecting personal account emits switching overlay`() {
        projectRpc.state.value = workspaceReady()
        rpc.recent.add(session("ses_1"))
        appRpc.state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            profile = ProfileDto(
                email = "user@example.com",
                currentOrgId = "org_1",
                organizations = listOf(ProfileOrganizationDto("org_1", "Kilo", "OWNER")),
            ),
        )
        val m = controller()
        val events = collect(m)
        flush()
        events.clear()

        edt { m.selectOrganization(null) }
        flush()

        val show = events.filterIsInstance<SessionControllerEvent.AccountOverlayChanged.Show>()
            .first { it.account.switching }
        assertTrue(show.account.switching)
        assertNull(show.account.targetOrgId)
        assertEquals(null, appRpc.orgSelections.last())
    }

    fun `test replay includes current overlay event`() {
        projectRpc.state.value = workspaceReady()
        rpc.recent.add(session("ses_1"))
        val m = controller()
        flush()

        // Add a new listener after initial events are done
        val replayed = collect(m)

        assertTrue(replayed.any { it is SessionControllerEvent.AccountOverlayChanged.Show })
    }

    fun `test overlay hide event has correct string`() {
        assertEquals("AccountOverlayChanged hide", SessionControllerEvent.AccountOverlayChanged.Hide.toString())
    }
}
