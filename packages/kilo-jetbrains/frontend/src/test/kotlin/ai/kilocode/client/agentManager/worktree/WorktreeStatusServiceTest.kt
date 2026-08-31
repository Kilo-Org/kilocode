package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.fakeRoot
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.testing.activateIde
import ai.kilocode.client.testing.fakeRoot
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

    fun `test activation reloads pr state within the throttle budget`() {
        val path = "${project.basePath}/.kilo/worktrees/feature-x"
        val key = normalizeWorktreePath(path)
        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(path, 1, GhState.OPEN, "https://pr/1")))
        val handle = service.attach()
        drain()
        assertEquals(1, service.pr.value[key]?.number)

        // A PR merged while the IDE sat in the background.
        rpc.prResult = WorktreePrListDto(GhAvailability.OK, listOf(WorktreePrDto(path, 1, GhState.MERGED, "https://pr/1")))
        timers.advanceBy(30_000)
        activateIde(project)
        drain()

        assertEquals(GhState.MERGED, service.pr.value[key]?.state)
        handle.close()
    }

    fun `test activation collapses a burst of focus events into one lookup`() {
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        val handle = service.attach()
        drain()
        val before = rpc.prCalls.size

        repeat(5) { activateIde(project) }
        drain()

        assertEquals("PR_THROTTLE must absorb repeated activation", before, rpc.prCalls.size)
        handle.close()
    }

    fun `test activation of another project does not reload pr state`() {
        rpc.prResult = WorktreePrListDto(GhAvailability.OK)
        val handle = service.attach()
        drain()
        val before = rpc.prCalls.size
        timers.advanceBy(30_000)

        // A different project's window gaining focus says nothing about this project's worktrees.
        activateIde(ProjectManager.getInstance().defaultProject)
        drain()

        assertEquals(before, rpc.prCalls.size)
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
    }
}
