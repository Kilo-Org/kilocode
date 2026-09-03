package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.fakeRoot
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.testing.activateIde
import ai.kilocode.client.testing.deactivateIde
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreeDirtyListDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreePrListDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import ai.kilocode.rpc.dto.WorktreeStatsListDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.ProjectManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

@Suppress("UnstableApiUsage")
class WorktreeStatusServiceTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeWorktreeRpcApi
    private lateinit var timers: TestUiTimers
    private lateinit var service: WorktreeStatusService

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        rpc = FakeWorktreeRpcApi()
        ApplicationManager.getApplication()
            .replaceService(KiloWorktreeService::class.java, KiloWorktreeService(coroutines.scope, rpc), testRootDisposable)
        // Stats and PR loading resolve the backend project root before every call.
        fakeRoot(project, coroutines.scope, testRootDisposable, project.basePath!!)
        ApplicationManager.getApplication()
            .replaceService(GhStatusCoordinator::class.java, GhStatusCoordinator(coroutines.scope, TestUiTimers()), testRootDisposable)
        timers = TestUiTimers()
        service = WorktreeStatusService(project, coroutines.scope, timers)
    }

    override fun tearDown() {
        try {
            KiloPluginSettings.unsetGithub()
            coroutines.close(::pump)
        } finally {
            super.tearDown()
        }
    }

    fun `test attach loads pr immediately and stats after debounce`() {
        val path = "${project.basePath}/.kilo/worktrees/feature-x"
        rpc.statsResult = WorktreeStatsListDto(listOf(WorktreeStatsDto(path, additions = 4)))
        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(path, 3, GhState.OPEN, "https://pr/3")))
        val key = normalizeWorktreePath(path)

        val handle = service.attach()
        drain()
        assertEquals(3, service.pr.value[key]?.number)

        timers.advanceBy(300)
        drain()
        assertEquals(4, service.stats.value[key]?.additions)
        handle.close()
    }

    fun `test attach loads dirty on the same debounce as stats`() {
        val path = "${project.basePath}/.kilo/worktrees/feature-x"
        rpc.statsResult = WorktreeStatsListDto(listOf(WorktreeStatsDto(path, additions = 4)))
        rpc.dirtyResult = WorktreeDirtyListDto(listOf(WorktreeDirtyDto(path, additions = 2, files = 1)))
        val key = normalizeWorktreePath(path)

        val handle = service.attach()
        timers.advanceBy(300)
        drain()

        assertEquals(4, service.stats.value[key]?.additions)
        assertEquals(2, service.dirty.value[key]?.additions)
        assertEquals(1, service.dirty.value[key]?.files)
        handle.close()
    }

    fun `test refresh is ignored after the last handle closes`() {
        val path = "${project.basePath}/.kilo/worktrees/feature-x"
        val key = normalizeWorktreePath(path)
        rpc.statsResult = WorktreeStatsListDto(listOf(WorktreeStatsDto(path, additions = 1)))
        val handle = service.attach()
        timers.advanceBy(300)
        drain()
        assertEquals(1, service.stats.value[key]?.additions)

        handle.close()
        rpc.statsResult = WorktreeStatsListDto(listOf(WorktreeStatsDto(path, additions = 5)))
        service.refreshStats()
        timers.advanceBy(300)
        drain()

        assertEquals(1, service.stats.value[key]?.additions)
    }

    fun `test polling keeps loading while a handle remains`() {
        val path = "${project.basePath}/.kilo/worktrees/feature-x"
        val key = normalizeWorktreePath(path)
        rpc.statsResult = WorktreeStatsListDto(listOf(WorktreeStatsDto(path, additions = 1)))
        val first = service.attach()
        val second = service.attach()
        timers.advanceBy(300)
        drain()
        assertEquals(1, service.stats.value[key]?.additions)

        first.close()
        rpc.statsResult = WorktreeStatsListDto(listOf(WorktreeStatsDto(path, additions = 7)))
        // The 30s poll fires refreshStats, which reschedules the 300ms debounce.
        timers.advanceBy(30_000)
        timers.advanceBy(300)
        drain()

        assertEquals(7, service.stats.value[key]?.additions)
        second.close()
    }

    fun `test pr refresh throttles non-forced calls but honors force`() {
        val path = "${project.basePath}/.kilo/worktrees/feature-x"
        val key = normalizeWorktreePath(path)
        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(path, 1, GhState.OPEN, "https://pr/1")))
        val handle = service.attach()
        drain()
        assertEquals(1, service.pr.value[key]?.number)

        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(path, 2, GhState.OPEN, "https://pr/2")))
        service.refreshPr()
        drain()
        assertEquals(1, service.pr.value[key]?.number)

        service.refreshPr(force = true)
        drain()
        assertEquals(2, service.pr.value[key]?.number)
        handle.close()
    }

    fun `test a forced refresh does not stack a second lookup on a running one`() {
        val gate = CompletableDeferred<Unit>()
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        rpc.beforePrStatus = { gate.await() }
        val handle = service.attach()
        assertTrue(coroutines.pumpUntil { rpc.prCalls.isNotEmpty() })

        // Every return from a long absence forces past PR_THROTTLE, so without an in-flight guard a
        // user leaving and coming back faster than a lookup completes would multiply the per-worktree
        // `gh` fan-out instead of getting an answer sooner.
        repeat(5) { service.refreshPr(force = true, maxAge = 0) }
        drain()
        assertEquals("a lookup already running covers the request", 1, rpc.prCalls.size)

        // Once it lands the path is open again, so the guard throttles nothing on its own.
        gate.complete(Unit)
        drain()
        rpc.beforePrStatus = {}
        service.refreshPr(force = true)
        drain()

        assertEquals(2, rpc.prCalls.size)
        handle.close()
    }

    fun `test activation while a lookup runs does not stack a second one`() {
        val gate = CompletableDeferred<Unit>()
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        rpc.beforePrStatus = { gate.await() }
        val handle = service.attach()
        assertTrue(coroutines.pumpUntil { rpc.prCalls.isNotEmpty() })

        deactivateIde(project)
        timers.advanceBy(Away.FRESH)
        activateIde(project)
        drain()

        assertEquals(1, rpc.prCalls.size)
        gate.complete(Unit)
        drain()

        // The return is held, not spent: the running lookup covered the request, and the attach lookup
        // is still inside the spend floor, so the trailing lookup waits out the rest of the window.
        assertEquals(1, rpc.prCalls.size)
        timers.advanceBy(PR_FLOOR - Away.FRESH)
        drain()
        assertEquals(2, rpc.prCalls.size)
        handle.close()
    }

    fun `test a return held behind a running lookup is spent when that lookup ends`() {
        val gate = CompletableDeferred<Unit>()
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        rpc.beforePrStatus = { gate.await() }
        val handle = service.attach()
        assertTrue(coroutines.pumpUntil { rpc.prCalls.isNotEmpty() })
        // Clear of the spend floor, so the in-flight guard is the only thing left holding the return.
        timers.advanceBy(PR_FLOOR)

        deactivateIde(project)
        timers.advanceBy(Away.FRESH)
        activateIde(project)
        drain()
        assertEquals("the running lookup must not be joined by a second fan-out", 1, rpc.prCalls.size)

        // The lookup that was running started before the departure, so its answer can predate the very
        // change this return came back to observe. Dropping the request would leave that stale answer
        // standing until the 120s poll, which is the staleness this whole path exists to avoid.
        gate.complete(Unit)
        drain()

        assertEquals(2, rpc.prCalls.size)
        assertEquals("the held return keeps the ceiling it was submitted with", Away.FRESH, rpc.prAges.last())
        handle.close()
    }

    fun `test a return held behind a lookup that reports a rate limit is dropped`() {
        val gate = CompletableDeferred<Unit>()
        rpc.prResult = WorktreePrListDto(GhAvailability.RATE_LIMITED)
        rpc.beforePrStatus = { gate.await() }
        val handle = service.attach()
        assertTrue(coroutines.pumpUntil { rpc.prCalls.isNotEmpty() })
        timers.advanceBy(PR_FLOOR)

        deactivateIde(project)
        timers.advanceBy(Away.FRESH)
        activateIde(project)
        drain()
        assertEquals(1, rpc.prCalls.size)

        // The budget was still OK when the return was recorded, so it could not have been refused up
        // front. Spending it now would pay for the one fan-out GitHub is currently refusing.
        gate.complete(Unit)
        drain()

        assertEquals(1, rpc.prCalls.size)
        assertEquals(GhAvailability.RATE_LIMITED, service.gh.value)
        handle.close()
    }

    fun `test a return held behind a running lookup does not outlive a detach`() {
        val gate = CompletableDeferred<Unit>()
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        rpc.beforePrStatus = { gate.await() }
        val handle = service.attach()
        assertTrue(coroutines.pumpUntil { rpc.prCalls.isNotEmpty() })
        timers.advanceBy(PR_FLOOR)

        deactivateIde(project)
        timers.advanceBy(Away.FRESH)
        activateIde(project)
        drain()
        assertEquals(1, rpc.prCalls.size)

        // Nothing is watching worktrees any more, so the held return has no surface left to update.
        handle.close()
        gate.complete(Unit)
        drain()
        timers.advanceBy(PR_FLOOR)
        drain()

        assertEquals(1, rpc.prCalls.size)
    }

    fun `test gh availability propagates from pr status`() {
        rpc.prResult = WorktreePrListDto(GhAvailability.MISSING)
        val handle = service.attach()
        drain()

        assertEquals(GhAvailability.MISSING, service.gh.value)
        handle.close()
    }

    fun `test stats and dirty both target the resolved backend root`() {
        // In split/remote mode project.basePath is a synthetic JetBrains Client path. Sending it to
        // the backend makes dirty() answer for a directory that is not there, which the UI would
        // render as "no local changes" instead of the real uncommitted counts.
        fakeRoot(project, coroutines.scope, testRootDisposable, BACKEND_ROOT)
        val remote = WorktreeStatusService(project, coroutines.scope, timers)

        val handle = remote.attach()
        timers.advanceBy(300)
        drain()

        assertEquals(listOf(BACKEND_ROOT), rpc.statsCalls)
        assertEquals(listOf(BACKEND_ROOT), rpc.dirtyCalls)
        assertFalse(rpc.dirtyCalls.contains(project.basePath))
        handle.close()
    }

    fun `test a pr lookup cancelled by a disable cannot publish after a re-enable`() {
        val path = "${project.basePath}/.kilo/worktrees/feature-x"
        val key = normalizeWorktreePath(path)
        val gate = CompletableDeferred<Unit>()
        // The lookup that gets abandoned. It answers empty and OK, which is what the RPC layer
        // synthesizes when it swallows the cancellation. NonCancellable holds it open past the
        // cancel so it lands after the replacement, the ordering that makes a stale write dangerous.
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        rpc.beforePrStatus = { withContext(NonCancellable) { gate.await() } }
        val handle = service.attach()
        assertTrue(coroutines.pumpUntil { rpc.prCalls.isNotEmpty() })

        github(false)
        // The fresh lookup after re-enabling sees a real PR and an unauthorized gh.
        rpc.beforePrStatus = {}
        rpc.prResult = WorktreePrListDto(GhAvailability.UNAUTH, listOf(WorktreePrDto(path, 7, GhState.OPEN, "https://pr/7")))
        github(true)
        drain()
        assertEquals(7, service.pr.value[key]?.number)
        assertEquals(GhAvailability.UNAUTH, service.gh.value)

        // Now let the abandoned lookup finish. It must not wipe the badge or report a false OK.
        gate.complete(Unit)
        drain()

        assertEquals(7, service.pr.value[key]?.number)
        assertEquals(GhAvailability.UNAUTH, service.gh.value)
        handle.close()
    }

    fun `test returning after a long absence observes a pr merged elsewhere`() {
        val path = "${project.basePath}/.kilo/worktrees/feature-x"
        val key = normalizeWorktreePath(path)
        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(path, 1, GhState.OPEN, "https://pr/1")))
        val handle = service.attach()
        drain()
        assertEquals(1, service.pr.value[key]?.number)

        // A PR merged in a browser while the IDE sat in the background.
        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(path, 1, GhState.MERGED, "https://pr/1")))
        deactivateIde(project)
        timers.advanceBy(30_000)
        activateIde(project)
        drain()

        assertEquals(GhState.MERGED, service.pr.value[key]?.state)
        handle.close()
    }

    fun `test an absence past the bar outranks the throttle and the backend pr cache`() {
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        val handle = service.attach()
        drain()
        assertEquals(1, rpc.prCalls.size)
        // Clear of the spend floor, so only the absence rule decides what this activation costs.
        timers.advanceBy(PR_FLOOR)

        // The absence is the whole reason to spend the lookup, and the ceiling is the only way past the
        // backend's own PR cache — without it the answer could predate the departure by up to its TTL.
        deactivateIde(project)
        timers.advanceBy(Away.FRESH)
        activateIde(project)
        drain()

        assertEquals(2, rpc.prCalls.size)
        assertEquals(listOf(null, Away.FRESH), rpc.prAges.toList())
        handle.close()
    }

    fun `test a spent github budget leaves the badges it cannot refresh alone`() {
        val path = "${project.basePath}/.kilo/worktrees/feature-x"
        val key = normalizeWorktreePath(path)
        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(path, 1, GhState.OPEN, "https://pr/1")))
        val handle = service.attach()
        drain()
        assertEquals(1, service.pr.value[key]?.number)

        // GitHub refuses the lookup, so it carries no PRs. That is not evidence the PR went away, and
        // the limit can stand for an hour — blanking every badge over it would be a worse lie than
        // holding the last known state behind the banner.
        rpc.prResult = WorktreePrListDto(GhAvailability.RATE_LIMITED)
        service.refreshPr(force = true)
        drain()

        assertEquals(1, service.pr.value[key]?.number)
        assertEquals(GhAvailability.RATE_LIMITED, service.gh.value)
        handle.close()
    }

    fun `test an absence one tick under the bar does not bypass the backend cache`() {
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        val handle = service.attach()
        drain()
        assertEquals(1, rpc.prCalls.size)
        timers.advanceBy(PR_FLOOR)

        // Under the bar the absence is window churn, which does not justify a fresh per-worktree gh
        // fan-out. It still reloads — the RPC round trip is cheap — but a cached answer is acceptable.
        deactivateIde(project)
        timers.advanceBy(Away.FRESH - 1)
        activateIde(project)
        drain()

        assertEquals(2, rpc.prCalls.size)
        assertNull("window churn has no claim on the backend cache", rpc.prAges.last())
        handle.close()
    }

    fun `test returning from a quick switch reloads without bypassing the backend cache`() {
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        val handle = service.attach()
        drain()
        // Past PR_THROTTLE, so only the absence rule decides what this activation costs.
        timers.advanceBy(30_000)

        deactivateIde(project)
        timers.advanceBy(Away.REAL)
        activateIde(project)
        drain()

        assertEquals(2, rpc.prCalls.size)
        assertNull("a quick switch does not justify a fresh gh fan-out", rpc.prAges.last())
        handle.close()
    }

    fun `test returning from a transient window does not reload pr state`() {
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        val handle = service.attach()
        drain()
        timers.advanceBy(30_000)
        val before = rpc.prCalls.size

        // A dialog or popup closing never took focus out of the IDE for long enough to have changed a
        // PR, and this lookup costs one `gh` call per worktree.
        deactivateIde(project)
        timers.advanceBy(Away.REAL - 1)
        activateIde(project)
        drain()

        assertEquals(before, rpc.prCalls.size)
        handle.close()
    }

    fun `test a burst of activations reloads once per absence`() {
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        val handle = service.attach()
        drain()
        assertEquals(1, rpc.prCalls.size)

        timers.advanceBy(PR_FLOOR)
        deactivateIde(project)
        timers.advanceBy(Away.FRESH)
        repeat(5) { activateIde(project) }
        drain()

        assertEquals("one departure owes one lookup, however often the frame reports focus", 2, rpc.prCalls.size)
        handle.close()
    }

    fun `test activation without a preceding absence does not reload pr state`() {
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        val handle = service.attach()
        drain()
        timers.advanceBy(30_000)
        val before = rpc.prCalls.size

        activateIde(project)
        drain()

        assertEquals("the first focus of a session is not a return", before, rpc.prCalls.size)
        handle.close()
    }

    fun `test activation of any frame reloads every attached project`() {
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        val handle = service.attach()
        drain()
        assertEquals(1, rpc.prCalls.size)
        timers.advanceBy(PR_FLOOR)
        deactivateIde(project)
        timers.advanceBy(Away.FRESH)

        // The absence belongs to the application, so returning to it is news for every project that is
        // watching worktrees — not only the one whose frame happened to report the focus. The frame the
        // platform hands us can also answer with a null or default project, so routing on it would drop
        // the return entirely.
        activateIde(ProjectManager.getInstance().defaultProject)
        drain()

        assertEquals(2, rpc.prCalls.size)
        assertEquals(listOf(null, Away.FRESH), rpc.prAges.toList())
        handle.close()
    }

    fun `test a return blocked by the spend floor runs once the floor clears`() {
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        val handle = service.attach()
        drain()
        assertEquals(1, rpc.prCalls.size)

        // Past the bar, so this return deserves fresh data — but the attach lookup was 5s ago, so we
        // may not pay for it yet. Dropping it would leave the badge stale until the 120s poll.
        timers.advanceBy(5_000)
        deactivateIde(project)
        timers.advanceBy(Away.FRESH)
        activateIde(project)
        drain()
        assertEquals("the floor holds the return rather than spending on it", 1, rpc.prCalls.size)

        // 5s + FRESH of the 30s floor is already spent, so the trailing lookup is due at the remainder.
        timers.advanceBy(PR_FLOOR - 5_000 - Away.FRESH)
        drain()

        assertEquals(2, rpc.prCalls.size)
        assertEquals("the held return keeps the ceiling it was submitted with", Away.FRESH, rpc.prAges.last())
        handle.close()
    }

    fun `test a burst of blocked returns costs one trailing lookup`() {
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        val handle = service.attach()
        drain()
        assertEquals(1, rpc.prCalls.size)

        // Two departures and returns inside one floor window. Each is real news, but they are news about
        // the same thing, and one fan-out answers both.
        repeat(2) {
            deactivateIde(project)
            timers.advanceBy(Away.FRESH)
            activateIde(project)
            drain()
        }
        assertEquals("no return may spend while the floor stands", 1, rpc.prCalls.size)

        // The deadline is fixed from the first deferral, so the second return cannot push it out. Under a
        // sliding debounce the window would now end at 2 x FRESH past here and this would still be 1.
        timers.advanceBy(PR_FLOOR - 2 * Away.FRESH)
        drain()

        assertEquals("one window owes one lookup, however many returns it held", 2, rpc.prCalls.size)
        assertEquals("the strictest ceiling the window held survives", Away.FRESH, rpc.prAges.last())
        handle.close()
    }

    fun `test a spent github budget suppresses focus refreshes`() {
        rpc.prResult = WorktreePrListDto(GhAvailability.RATE_LIMITED)
        val handle = service.attach()
        drain()
        assertEquals(GhAvailability.RATE_LIMITED, service.gh.value)
        val before = rpc.prCalls.size
        timers.advanceBy(PR_FLOOR)

        // The fan-out this return would pay for is the one GitHub is currently refusing, so it can only
        // confirm what the last answer already said. Returning to the IDE is not a reason to spend it.
        deactivateIde(project)
        timers.advanceBy(Away.FRESH)
        activateIde(project)
        drain()

        assertEquals(before, rpc.prCalls.size)
        handle.close()
    }

    fun `test the poll still recovers after a rate limit suppressed focus refreshes`() {
        val path = "${project.basePath}/.kilo/worktrees/feature-x"
        val key = normalizeWorktreePath(path)
        rpc.prResult = WorktreePrListDto(GhAvailability.RATE_LIMITED)
        val handle = service.attach()
        drain()
        deactivateIde(project)
        timers.advanceBy(Away.FRESH)
        activateIde(project)
        drain()
        val before = rpc.prCalls.size

        // Suppressing the focus path must not be a dead end: the budget resets on GitHub's schedule,
        // and the poll is what notices.
        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(path, 5, GhState.OPEN, "https://pr/5")))
        timers.advanceBy(120_000)
        drain()

        assertEquals(before + 1, rpc.prCalls.size)
        assertEquals(GhAvailability.OK, service.gh.value)
        assertEquals(5, service.pr.value[key]?.number)
        handle.close()
    }

    fun `test a forced refresh can demand a fresh backend lookup`() {
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        val handle = service.attach()
        drain()

        // What creating a worktree needs: the cached PR list was built before this worktree existed,
        // so serving it would leave the new row without a badge until the entry aged out.
        service.refreshPr(force = true, maxAge = 0)
        drain()

        assertEquals(listOf(null, 0L), rpc.prAges.toList())
        handle.close()
    }

    fun `test attach skips pr polling while the github integration is off`() {
        val path = "${project.basePath}/.kilo/worktrees/feature-x"
        val key = normalizeWorktreePath(path)
        rpc.statsResult = WorktreeStatsListDto(listOf(WorktreeStatsDto(path, additions = 4)))
        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(path, 3, GhState.OPEN, "https://pr/3")))
        KiloPluginSettings.setGithub(false)
        val off = WorktreeStatusService(project, coroutines.scope, timers)

        val handle = off.attach()
        drain()
        assertTrue(rpc.prCalls.isEmpty())

        // Git-backed stats and dirty counts are unaffected by the GitHub integration setting.
        timers.advanceBy(300)
        drain()
        assertEquals(4, off.stats.value[key]?.additions)

        // No PR timer was started, so the poll interval must not produce a lookup either.
        timers.advanceBy(120_000)
        drain()
        assertTrue(rpc.prCalls.isEmpty())
        assertTrue(off.pr.value.isEmpty())
        handle.close()
    }

    fun `test disabling clears pr state and stops the poll`() {
        val path = "${project.basePath}/.kilo/worktrees/feature-x"
        val key = normalizeWorktreePath(path)
        rpc.prResult = WorktreePrListDto(GhAvailability.UNAUTH, listOf(WorktreePrDto(path, 1, GhState.OPEN, "https://pr/1")))
        val handle = service.attach()
        drain()
        assertEquals(1, service.pr.value[key]?.number)
        assertEquals(GhAvailability.UNAUTH, service.gh.value)
        val before = rpc.prCalls.size

        github(false)
        drain()
        assertTrue("badges, tab titles, and PR actions all read this map", service.pr.value.isEmpty())
        assertEquals(GhAvailability.OK, service.gh.value)

        timers.advanceBy(120_000)
        drain()
        assertEquals(before, rpc.prCalls.size)
        handle.close()
    }

    fun `test re-enabling reloads pr state and resumes the poll`() {
        val path = "${project.basePath}/.kilo/worktrees/feature-x"
        val key = normalizeWorktreePath(path)
        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(path, 1, GhState.OPEN, "https://pr/1")))
        val handle = service.attach()
        drain()
        github(false)
        drain()
        assertTrue(service.pr.value.isEmpty())

        github(true)
        drain()
        assertEquals("re-enabling loads at once instead of waiting out the poll", 1, service.pr.value[key]?.number)

        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(path, 2, GhState.OPEN, "https://pr/2")))
        timers.advanceBy(120_000)
        drain()
        assertEquals(2, service.pr.value[key]?.number)
        handle.close()
    }

    private fun github(enabled: Boolean) {
        edtWait { setGithubIntegration(enabled, "test") }
        pump()
    }

    private fun drain() = coroutines.drain(::pump)

    private fun pump() = pumpEdt()

    private companion object {
        /** Stands in for a real repo path that differs from the project's synthetic client basePath. */
        private const val BACKEND_ROOT = "/real/repo"

        /**
         * Minimum gap between lookups the focus path may pay for, measured from the last one. A return
         * past `Away.FRESH` deserves fresh data; this is whether it may be afforded yet. Mirrors the
         * service's private `PR_THROTTLE`, which serves as both the unforced throttle and this floor.
         */
        private const val PR_FLOOR = 30_000L
    }
}
