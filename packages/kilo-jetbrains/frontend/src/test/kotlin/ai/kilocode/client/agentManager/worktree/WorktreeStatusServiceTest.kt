package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreePrListDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import ai.kilocode.rpc.dto.WorktreeStatsListDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService

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
        ApplicationManager.getApplication()
            .replaceService(GhStatusCoordinator::class.java, GhStatusCoordinator(coroutines.scope, TestUiTimers()), testRootDisposable)
        timers = TestUiTimers()
        service = WorktreeStatusService(project, coroutines.scope, timers)
    }

    override fun tearDown() {
        try {
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

    private fun drain() = coroutines.drain(::pump)

    private fun pump() = pumpEdt()
}
