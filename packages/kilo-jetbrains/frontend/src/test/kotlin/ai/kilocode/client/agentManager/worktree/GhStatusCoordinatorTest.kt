package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.fakeRoot
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.testing.activateIde
import ai.kilocode.client.testing.deactivateIde
import ai.kilocode.client.testing.installBrowser
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.GhAvailability
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import kotlinx.coroutines.CompletableDeferred

@Suppress("UnstableApiUsage")
class GhStatusCoordinatorTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeWorktreeRpcApi
    private lateinit var timers: TestUiTimers
    private lateinit var service: GhStatusCoordinator

    override fun setUp() {
        super.setUp()
        installBrowser()
        coroutines = TestCoroutines()
        rpc = FakeWorktreeRpcApi()
        timers = TestUiTimers()
        ApplicationManager.getApplication()
            .replaceService(KiloWorktreeService::class.java, KiloWorktreeService(coroutines.scope, rpc), testRootDisposable)
        // The probe resolves the backend project root before each call.
        fakeRoot(project, coroutines.scope, testRootDisposable, ROOT)
        service = GhStatusCoordinator(coroutines.scope, timers)
        ApplicationManager.getApplication().replaceService(GhStatusCoordinator::class.java, service, testRootDisposable)
    }

    override fun tearDown() {
        try {
            KiloPluginSettings.unsetGithub()
            coroutines.close(::pump)
        } finally {
            super.tearDown()
        }
    }

    fun `test coordinator publishes only state transitions`() {
        val events = mutableListOf<GhAvailability>()
        ApplicationManager.getApplication().messageBus.connect(testRootDisposable)
            .subscribe(GhStatusListener.TOPIC, GhStatusListener { events += it })

        report(GhAvailability.MISSING)
        report(GhAvailability.MISSING)
        report(GhAvailability.OK)
        report(GhAvailability.UNAUTH)

        assertEquals(listOf(GhAvailability.MISSING, GhAvailability.OK, GhAvailability.UNAUTH), events)
        assertEquals(GhAvailability.UNAUTH, service<GhStatusCoordinator>().current())
    }

    fun `test coordinator polls fast while unauthorized and relaxes after recovery`() {
        rpc.ghResult = GhAvailability.UNAUTH
        val handle = edtWait { service.attach(project) }
        drain()
        assertEquals(GhAvailability.UNAUTH, service.current())
        assertEquals(1, rpc.ghCalls.size)

        timers.advanceBy(4_999)
        drain()
        assertEquals(1, rpc.ghCalls.size)

        rpc.ghResult = GhAvailability.OK
        timers.advanceBy(1)
        drain()
        assertEquals(GhAvailability.OK, service.current())
        assertEquals(2, rpc.ghCalls.size)

        timers.advanceBy(29_999)
        drain()
        assertEquals(2, rpc.ghCalls.size)

        timers.advanceBy(1)
        drain()
        assertEquals(3, rpc.ghCalls.size)
        handle.close()
    }

    fun `test coordinator slows right down while the github budget is spent`() {
        rpc.ghResult = GhAvailability.RATE_LIMITED
        val handle = edtWait { service.attach(project) }
        drain()
        assertEquals(GhAvailability.RATE_LIMITED, service.current())
        assertEquals(1, rpc.ghCalls.size)

        // Slower than every other state, including MISSING: the window resets on GitHub's schedule, so
        // each probe before then spends a call to be told the same thing.
        timers.advanceBy(299_999)
        drain()
        assertEquals("a spent budget must not be re-probed on the ordinary cadence", 1, rpc.ghCalls.size)

        rpc.ghResult = GhAvailability.OK
        timers.advanceBy(1)
        drain()
        assertEquals(2, rpc.ghCalls.size)
        // And the recovery is picked up on its own, without the user doing anything.
        assertEquals(GhAvailability.OK, service.current())
        handle.close()
    }

    fun `test coordinator backs off on backend failure without reporting ok`() {
        rpc.ghResult = GhAvailability.UNAUTH
        val handle = edtWait { service.attach(project) }
        drain()
        assertEquals(GhAvailability.UNAUTH, service.current())
        assertEquals(1, rpc.ghCalls.size)

        // A backend/RPC failure must reach the coordinator's failure path, not be laundered into OK.
        rpc.beforeGhStatus = { throw RuntimeException("backend down") }
        timers.advanceBy(5_000)
        drain()
        assertEquals(2, rpc.ghCalls.size)
        assertEquals(GhAvailability.UNAUTH, service.current())

        // failures>0 now drives exponential backoff instead of the steady FAST cadence.
        timers.advanceBy(5_000)
        drain()
        assertEquals(3, rpc.ghCalls.size)
        assertEquals(GhAvailability.UNAUTH, service.current())
        handle.close()
    }

    fun `test coordinator probes the resolved backend root`() {
        val handle = edtWait { service.attach(project) }
        awaitCalls(1)

        assertEquals(ROOT, rpc.ghCalls.first())
        assertFalse(rpc.ghCalls.contains(project.basePath))
        handle.close()
    }

    fun `test coordinator does not probe or latch when the root is unresolved`() {
        // A blank backend root must not call ghStatus, and must not leave the probe stuck busy:
        // the coordinator stays responsive to later reports.
        fakeRoot(project, coroutines.scope, testRootDisposable, "")
        val handle = edtWait { service.attach(project) }
        drain()
        assertTrue(rpc.ghCalls.isEmpty())

        report(GhAvailability.OK)
        assertEquals(GhAvailability.OK, service.current())
        handle.close()
    }

    fun `test coordinator stops polling after detach`() {
        val handle = edtWait { service.attach(project) }
        drain()
        assertEquals(1, rpc.ghCalls.size)

        handle.close()
        timers.advanceBy(120_000)
        drain()

        assertEquals(1, rpc.ghCalls.size)
    }

    fun `test a sync submitted while a probe runs is answered by that probe`() {
        val gate = CompletableDeferred<Unit>()
        rpc.beforeGhStatus = { gate.await() }
        val handle = edtWait { service.attach(project) }
        awaitCalls(1)

        // Past the event throttle, so an in-flight probe is the only thing holding this sync back.
        timers.advanceBy(EVENT_THROTTLE)
        edtWait { service.sync("test") }
        pump()
        assertEquals("a second probe must never run alongside the first", 1, rpc.ghCalls.size)

        gate.complete(Unit)
        drain()

        // The completed probe reports state from after the event, so the held sync is satisfied
        // rather than re-run: coalescing must not turn every deferral into a guaranteed second call.
        assertEquals(1, rpc.ghCalls.size)
        handle.close()
    }

    fun `test a throttled burst runs one trailing probe instead of none`() {
        val handle = edtWait { service.attach(project) }
        drain()
        assertEquals(1, rpc.ghCalls.size)

        // Focus and tab-switch events arrive in bursts; inside the window they fold into one sync.
        repeat(5) { edtWait { service.sync("burst") } }
        drain()
        assertEquals("no event may run inside the throttle window", 1, rpc.ghCalls.size)

        // At the end of the window that one sync runs. Dropping the burst outright would leave the
        // stale verdict standing until the next scheduled poll, which is the staleness to avoid.
        timers.advanceBy(EVENT_THROTTLE)
        drain()
        assertEquals("the burst owes exactly one probe", 2, rpc.ghCalls.size)

        // And it is spent: the same burst cannot produce a second trailing probe.
        timers.advanceBy(EVENT_THROTTLE)
        drain()
        assertEquals(2, rpc.ghCalls.size)
        handle.close()
    }

    fun `test the trailing window end is fixed rather than pushed back by later events`() {
        val handle = edtWait { service.attach(project) }
        drain()
        edtWait { service.sync("first") }

        // A continuing burst must not behave like a sliding debounce, or a user clicking between tabs
        // could postpone the probe indefinitely.
        timers.advanceBy(EVENT_THROTTLE - 1)
        edtWait { service.sync("later") }
        timers.advanceBy(1)
        drain()

        assertEquals(2, rpc.ghCalls.size)
        handle.close()
    }

    fun `test coordinator ignores submitted syncs while nothing is attached`() {
        edtWait { service.sync("detached") }
        drain()

        assertTrue(rpc.ghCalls.isEmpty())
    }

    fun `test detach discards a sync held behind a running probe`() {
        val gate = CompletableDeferred<Unit>()
        rpc.beforeGhStatus = { gate.await() }
        val handle = edtWait { service.attach(project) }
        awaitCalls(1)
        timers.advanceBy(EVENT_THROTTLE)
        edtWait { service.sync("tab-switch") }

        handle.close()
        gate.complete(Unit)
        drain()
        timers.advanceBy(120_000)
        drain()

        assertEquals("a held sync must not outlive the last consumer", 1, rpc.ghCalls.size)
    }

    fun `test detach cancels the trailing probe`() {
        val handle = edtWait { service.attach(project) }
        drain()
        edtWait { service.sync("tab-switch") }

        handle.close()
        timers.advanceBy(EVENT_THROTTLE)
        drain()

        assertEquals(1, rpc.ghCalls.size)
    }

    fun `test returning after a long absence probes past the backend cache`() {
        val handle = edtWait { service.attach(project) }
        drain()
        assertEquals(1, rpc.ghCalls.size)

        // The user ran `gh auth login` in a terminal while the IDE sat in the background.
        rpc.ghResult = GhAvailability.UNAUTH
        edtWait { deactivateIde(project) }
        timers.advanceBy(Away.FRESH)
        edtWait { activateIde(project) }
        drain()

        assertEquals(2, rpc.ghCalls.size)
        // The absence, not zero: a lookup that ran while we were gone is still current, and only an
        // answer cached before we left has to be rejected.
        assertEquals(listOf(null, Away.FRESH), rpc.ghAges.toList())
        assertEquals(GhAvailability.UNAUTH, service.current())
        handle.close()
    }

    fun `test returning from a quick switch probes without bypassing the backend cache`() {
        val handle = edtWait { service.attach(project) }
        drain()
        // Past the throttle, so only the absence rule decides what this activation costs.
        timers.advanceBy(EVENT_THROTTLE)

        edtWait { deactivateIde(project) }
        timers.advanceBy(Away.REAL)
        edtWait { activateIde(project) }
        drain()

        assertEquals(2, rpc.ghCalls.size)
        assertNull("a quick switch has no claim on the cache", rpc.ghAges.last())
        handle.close()
    }

    fun `test returning from a transient window does not probe at all`() {
        val handle = edtWait { service.attach(project) }
        drain()
        timers.advanceBy(EVENT_THROTTLE)

        // A dialog or popup that closes right away never took focus out of the IDE for long enough
        // to have changed anything, so it must cost nothing rather than one throttled probe.
        edtWait { deactivateIde(project) }
        timers.advanceBy(Away.REAL - 1)
        edtWait { activateIde(project) }
        drain()

        assertEquals(1, rpc.ghCalls.size)
        handle.close()
    }

    fun `test activation without a preceding absence does not probe`() {
        val handle = edtWait { service.attach(project) }
        drain()
        timers.advanceBy(EVENT_THROTTLE)

        edtWait { activateIde(project) }
        drain()

        assertEquals("the first focus of a session is not a return", 1, rpc.ghCalls.size)
        handle.close()
    }

    fun `test a burst of activations reloads once per absence`() {
        val handle = edtWait { service.attach(project) }
        drain()
        timers.advanceBy(EVENT_THROTTLE)

        edtWait { deactivateIde(project) }
        timers.advanceBy(Away.FRESH)
        repeat(5) { edtWait { activateIde(project) } }
        drain()

        assertEquals("one departure owes one probe, however often the frame reports focus", 2, rpc.ghCalls.size)
        handle.close()
    }

    fun `test coordinator does not probe on activation before anything attaches`() {
        edtWait { deactivateIde(project) }
        timers.advanceBy(Away.FRESH)
        edtWait { activateIde(project) }
        drain()

        assertTrue(rpc.ghCalls.isEmpty())
    }

    fun `test a freshness requirement held behind a running probe survives it`() {
        val gate = CompletableDeferred<Unit>()
        rpc.beforeGhStatus = { gate.await() }
        val handle = edtWait { service.attach(project) }
        awaitCalls(1)

        edtWait { deactivateIde(project) }
        timers.advanceBy(Away.FRESH)
        // Only the calls after this one answer freely; the first is already suspended on the gate.
        rpc.beforeGhStatus = {}
        edtWait { activateIde(project) }
        pump()
        assertEquals(1, rpc.ghCalls.size)

        gate.complete(Unit)
        drain()

        // The in-flight probe started before the absence was known, so unlike a plain sync this one
        // is not satisfied by it and must still run — with its ceiling intact.
        assertEquals(2, rpc.ghCalls.size)
        assertEquals(Away.FRESH, rpc.ghAges.last())
        handle.close()
    }

    fun `test a failed probe does not satisfy a held sync`() {
        val gate = CompletableDeferred<Unit>()
        rpc.beforeGhStatus = {
            gate.await()
            throw RuntimeException("backend down")
        }
        val handle = edtWait { service.attach(project) }
        awaitCalls(1)
        timers.advanceBy(EVENT_THROTTLE)
        edtWait { service.sync("tab-switch") }

        gate.complete(Unit)
        drain()

        // A failure establishes nothing about gh state, so it cannot stand in for the answer the
        // event asked for the way a successful probe does.
        assertEquals(2, rpc.ghCalls.size)
        handle.close()
    }

    fun `test coordinator probes git only while the github integration is off`() {
        rpc.ghResult = GhAvailability.UNAUTH
        val handle = edtWait { service.attach(project) }
        drain()
        assertEquals(GhAvailability.UNAUTH, service.current())

        github(false)
        drain()
        // Disabling publishes OK immediately so the banner hides without waiting for a probe.
        assertEquals(GhAvailability.OK, service.current())

        val before = rpc.ghCalls.size
        // SLOW cadence while disabled: the loop only checks whether git exists.
        timers.advanceBy(59_999)
        drain()
        assertEquals(before, rpc.ghCalls.size)

        timers.advanceBy(1)
        drain()
        assertEquals(before + 1, rpc.ghCalls.size)
        assertFalse("a disabled probe must never ask the backend to run gh", rpc.ghFlags.last())
        assertEquals(GhAvailability.OK, service.current())
        handle.close()
    }

    fun `test coordinator still reports a missing git while the github integration is off`() {
        rpc.ghResult = GhAvailability.GIT_MISSING
        github(false)
        val handle = edtWait { service.attach(project) }
        drain()

        assertEquals(GhAvailability.GIT_MISSING, service.current())
        assertFalse(rpc.ghFlags.last())
        handle.close()
    }

    fun `test coordinator ignores a stale gh report while the github integration is off`() {
        val events = mutableListOf<GhAvailability>()
        ApplicationManager.getApplication().messageBus.connect(testRootDisposable)
            .subscribe(GhStatusListener.TOPIC, GhStatusListener { events += it })
        github(false)

        // A prStatus lookup that was in flight at the moment of disabling.
        report(GhAvailability.UNAUTH)

        assertEquals(GhAvailability.OK, service.current())
        assertTrue(events.isEmpty())
    }

    fun `test coordinator cancels the in flight probe and reprobes when re-enabled`() {
        val gate = CompletableDeferred<Unit>()
        rpc.beforeGhStatus = { gate.await() }
        val handle = edtWait { service.attach(project) }
        awaitCalls(1)

        // Disabling must not wait for the running gh call to finish.
        github(false)
        assertEquals(GhAvailability.OK, service.current())
        gate.complete(Unit)
        drain()

        rpc.beforeGhStatus = {}
        rpc.ghResult = GhAvailability.UNAUTH
        val before = rpc.ghCalls.size
        github(true)
        drain()

        assertEquals("re-enabling probes at once instead of waiting out the timer", before + 1, rpc.ghCalls.size)
        assertTrue(rpc.ghFlags.last())
        assertEquals(GhAvailability.UNAUTH, service.current())
        handle.close()
    }

    private fun report(value: GhAvailability) {
        edtWait { service.report(project, value) }
        pump()
    }

    private fun github(enabled: Boolean) {
        edtWait { setGithubIntegration(enabled, "test") }
        pump()
    }

    private fun drain() = coroutines.drain()

    private fun awaitCalls(count: Int) {
        assertTrue(coroutines.pumpUntil { rpc.ghCalls.size >= count })
    }

    private fun pump() = pumpEdt()

    private companion object {
        private const val ROOT = "/real/repo"

        /** Mirrors GhStatusCoordinator.EVENT_THROTTLE, the floor between event-driven syncs. */
        private const val EVENT_THROTTLE = 3_000L
    }
}
