package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.HostedPullRequestChecksDto
import ai.kilocode.rpc.dto.HostedPullRequestConversationsDto
import ai.kilocode.rpc.dto.HostedPullRequestMergeabilityDto
import ai.kilocode.rpc.dto.HostedPullRequestRefreshDto
import ai.kilocode.rpc.dto.HostedPullRequestReviewDto
import ai.kilocode.rpc.dto.HostedPullRequestSummaryDto
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import ai.kilocode.rpc.dto.GhChecks
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

class HostedPullRequestServiceTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private val ref = HostedWorkspaceRefDto("cloud", "wrk_1")
    private val identity = MutableStateFlow<String?>(null)
    private val signedOut = MutableStateFlow(false)
    private val waits = CopyOnWriteArrayList<Long>()
    private val reads = AtomicInteger()
    private val revalidates = AtomicInteger()
    private var now = 0L
    private var read: suspend (HostedWorkspaceRefDto) -> HostedWorkspacePullRequestDto = { failure(it) }
    private var revalidate: suspend (HostedWorkspaceRefDto) -> HostedWorkspacePullRequestDto = { failure(it) }
    private var pause: suspend (Long) -> Unit = { waits += it }
    private lateinit var service: HostedPullRequestService

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        service = HostedPullRequestService(
            coroutines.scope,
            read = { ref ->
                reads.incrementAndGet()
                read(ref)
            },
            revalidate = { ref ->
                revalidates.incrementAndGet()
                revalidate(ref)
            },
            pause = { pause(it) },
            clock = { now },
            identity = identity,
            signedOut = signedOut,
        )
    }

    override fun tearDown() {
        try {
            coroutines.close()
        } finally {
            super.tearDown()
        }
    }

    fun `test keeps the previous badge when a later observation has no summary`() {
        revalidate = { available(it, state = "open") }
        service.refresh(ref, revalidate = true)
        assertTrue(coroutines.pumpUntil { service.pulls.value[ref.key]?.state == GhState.OPEN })

        now = 20_000
        revalidate = { HostedWorkspacePullRequestDto(ref, "rate_limited", null) }
        service.refresh(ref, revalidate = true)
        assertTrue(coroutines.pumpUntil { revalidates.get() == 2 })
        coroutines.drain()

        assertEquals(GhState.OPEN, service.pulls.value[ref.key]?.state)
    }

    fun `test no_pr is the only authoritative clear`() {
        revalidate = { available(it, state = "open") }
        service.refresh(ref, revalidate = true)
        assertTrue(coroutines.pumpUntil { service.pulls.value[ref.key] != null })

        now = 20_000
        revalidate = { HostedWorkspacePullRequestDto(ref, "no_pr", null) }
        service.refresh(ref, revalidate = true)
        assertTrue(coroutines.pumpUntil { service.pulls.value[ref.key] == null })
    }

    fun `test unknown state for a different pull request never inherits the previous badge`() {
        revalidate = { available(it, state = "open", number = 1) }
        service.refresh(ref, revalidate = true)
        assertTrue(coroutines.pumpUntil { service.pulls.value[ref.key]?.number == 1 })

        now = 20_000
        revalidate = {
            HostedWorkspacePullRequestDto(it, "unavailable", summary(state = "unknown", number = 2))
        }
        service.refresh(ref, revalidate = true)
        assertTrue(coroutines.pumpUntil { revalidates.get() == 2 })
        coroutines.drain()

        assertNull(service.pulls.value[ref.key])
    }

    fun `test polls while review or checks are pending and stops once settled`() {
        val gate = CompletableDeferred<Unit>()
        pause = { waits += it; gate.await() }
        revalidate = { available(it, checks = checks(total = 4, passed = 2, pending = 2, complete = false)) }
        service.refresh(ref, revalidate = true)
        assertTrue(coroutines.pumpUntil { revalidates.get() == 1 && waits.isNotEmpty() })

        revalidate = { available(it, checks = checks()) }
        gate.complete(Unit)
        assertTrue(coroutines.pumpUntil { service.pulls.value[ref.key]?.checks?.state == GhChecks.PASSED })
        coroutines.drain()

        assertEquals(2, revalidates.get())
        assertTrue(waits.isNotEmpty())
        assertTrue(waits.all { it > 0 })
    }

    fun `test polling is bounded when checks never settle`() {
        revalidate = { available(it, checks = checks(total = 4, passed = 2, pending = 2, complete = false)) }
        service.refresh(ref, revalidate = true)
        assertTrue(coroutines.pumpUntil { revalidates.get() == 11 })
        assertTrue(coroutines.pumpUntil { service.pulls.value[ref.key] != null })

        coroutines.drain()

        assertEquals(11, revalidates.get())
    }

    fun `test signing out clears the cached badge`() {
        revalidate = { available(it, state = "open") }
        service.refresh(ref, revalidate = true)
        assertTrue(coroutines.pumpUntil { service.pulls.value[ref.key] != null })

        signedOut.value = true
        assertTrue(coroutines.pumpUntil { service.pulls.value.isEmpty() })
    }

    fun `test changing the signed-in account clears the cached badge`() {
        identity.value = "first@example.com"
        revalidate = { available(it, state = "open") }
        service.refresh(ref, revalidate = true)
        assertTrue(coroutines.pumpUntil { service.pulls.value[ref.key] != null })

        identity.value = "second@example.com"
        assertTrue(coroutines.pumpUntil { service.pulls.value.isEmpty() })
    }

    fun `test explicit refresh respects the core retry deadline`() {
        val retry = Instant.ofEpochMilli(60_000).toString()
        revalidate = {
            available(it, state = "open").copy(refresh = HostedPullRequestRefreshDto("failed", retry))
        }
        service.refresh(ref, revalidate = true)
        assertTrue(coroutines.pumpUntil { revalidates.get() == 1 && service.pulls.value[ref.key] != null })

        service.refresh(ref, revalidate = true)
        coroutines.drain()
        Thread.sleep(20)
        coroutines.drain()

        assertEquals(1, revalidates.get())
        assertEquals(GhState.OPEN, service.pulls.value[ref.key]?.state)
    }

    fun `test concurrent requests for one workspace coalesce`() {
        val gate = CompletableDeferred<Unit>()
        revalidate = {
            gate.await()
            available(it, state = "open")
        }
        service.refresh(ref, revalidate = true)
        assertTrue(coroutines.pumpUntil { revalidates.get() == 1 })
        service.refresh(ref, revalidate = true)
        coroutines.drain()
        assertEquals(1, revalidates.get())

        gate.complete(Unit)
        assertTrue(coroutines.pumpUntil { service.pulls.value[ref.key] != null })
    }

    private fun available(
        ref: HostedWorkspaceRefDto,
        state: String = "open",
        number: Long = 42,
        checks: HostedPullRequestChecksDto = checks(),
    ) = HostedWorkspacePullRequestDto(ref, "available", summary(state, number, checks))

    private fun summary(
        state: String = "open",
        number: Long = 42,
        checks: HostedPullRequestChecksDto = checks(),
    ) = HostedPullRequestSummaryDto(
        url = "https://github.com/owner/repo/pull/$number",
        number = number,
        state = state,
        title = "Fix Cloud PR",
        headSha = "a".repeat(40),
        lastSyncedAt = "2026-11-17T00:00:00Z",
        review = HostedPullRequestReviewDto("approved", available = true, pending = false),
        checks = checks,
        conversations = HostedPullRequestConversationsDto(0, complete = true),
        mergeability = HostedPullRequestMergeabilityDto(true, "clean", complete = true),
        partial = false,
        unavailable = emptyList(),
    )

    private fun failure(ref: HostedWorkspaceRefDto) = HostedWorkspacePullRequestDto(ref, "unreachable", null)

    private fun checks(
        total: Long = 3,
        passed: Long = 3,
        pending: Long = 0,
        complete: Boolean = true,
    ) = HostedPullRequestChecksDto(
        total = total,
        passed = passed,
        failed = 0,
        pending = pending,
        skipped = 0,
        unknown = 0,
        complete = complete,
        available = true,
    )
}
