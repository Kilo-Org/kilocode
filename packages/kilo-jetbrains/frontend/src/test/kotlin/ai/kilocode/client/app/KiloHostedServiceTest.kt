package ai.kilocode.client.app

import ai.kilocode.client.testing.TestLog
import ai.kilocode.rpc.KiloHostedRpcApi
import ai.kilocode.rpc.dto.HostedProviderDto
import ai.kilocode.rpc.dto.HostedSystemEventDto
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceListDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class KiloHostedServiceTest {
    private val cs = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @AfterTest
    fun tearDown() {
        cs.cancel()
    }

    @Test
    fun `discovers every page and dedupes workspaces with passive status`() = runBlocking(Dispatchers.Default) {
        val one = workspace("1")
        val two = workspace("2")
        val rpc = FakeRpc(
            pages = mapOf(
                null to HostedWorkspaceListDto(
                    items = listOf(one),
                    cursor = "c2",
                    providers = listOf(HostedProviderDto("cloud", true, true)),
                ),
                "c2" to HostedWorkspaceListDto(
                    items = listOf(one, two),
                    cursor = null,
                    providers = listOf(HostedProviderDto("cloud", true, true)),
                ),
            ),
        )
        val service = KiloHostedService(
            cs = cs,
            rpc = rpc,
            gate = { true },
            log = TestLog(),
            repo = { "https://github.com/Kilo-Org/kilocode" },
        )

        service.refresh("/repo")
        val state = withTimeout(5_000) {
            service.state.first { !it.loading && it.items.isNotEmpty() }
        }

        assertEquals(2, state.items.size)
        assertEquals(listOf("wrk_1", "wrk_2"), state.items.map { it.ref.workspaceID })
        assertEquals("running", state.statuses[one.ref.key]?.computeStatus)
        assertTrue(state.providers.single().available)
        assertTrue(state.enabled)
    }

    @Test
    fun `pagination follows the session cursor`() = runBlocking(Dispatchers.Default) {
        val ref = HostedWorkspaceRefDto("cloud", "wrk_1")
        val rpc = FakeRpc(
            sessionPages = mapOf(
                null to sessionPage("s1", "s2", cursor = "next"),
                "next" to sessionPage("s2", "s3", cursor = null),
            ),
        )
        val service = KiloHostedService(cs = cs, rpc = rpc, gate = { true }, log = TestLog(), repo = { "repo" })

        val sessions = service.sessions(ref)

        assertEquals(listOf("s1", "s2", "s3"), sessions.map { it.nativeSessionID })
    }

    @Test
    fun `gate off never calls the backend`() = runBlocking(Dispatchers.Default) {
        val rpc = FakeRpc()
        val service = KiloHostedService(cs = cs, rpc = rpc, gate = { false }, log = TestLog(), repo = { "repo" })

        service.refresh("/repo")

        assertEquals(false, service.state.value.enabled)
        assertTrue(service.state.value.items.isEmpty())
        assertEquals(0, rpc.workspaceCalls)
    }

    @Test
    fun `refresh reloads hosted rows and emits an invalidation each time`() = runBlocking(Dispatchers.Default) {
        val pages = mutableMapOf<String?, HostedWorkspaceListDto>(
            null to HostedWorkspaceListDto(items = listOf(workspace("1"))),
        )
        val service = KiloHostedService(
            cs = cs,
            rpc = FakeRpc(pages = pages),
            gate = { true },
            log = TestLog(),
            repo = { "repo" },
        )
        service.refresh("/repo")
        withTimeout(5_000) { service.state.first { !it.loading && it.items.isNotEmpty() } }
        assertEquals(1L, service.refreshes.value)
        pages[null] = HostedWorkspaceListDto(items = listOf(workspace("2")))

        service.refresh("/repo")
        val state = withTimeout(5_000) {
            service.state.first { !it.loading && it.items.firstOrNull()?.ref?.workspaceID == "wrk_2" }
        }

        assertEquals(listOf("wrk_2"), state.items.map { it.ref.workspaceID })
        assertEquals(2L, service.refreshes.value)
    }

    private fun workspace(id: String): HostedWorkspaceDto = HostedWorkspaceDto(
        ref = HostedWorkspaceRefDto("cloud", "wrk_$id"),
        name = "Repo $id",
        repositoryUrl = "https://github.com/Kilo-Org/kilocode",
        branch = "main",
        sessions = listOf(session("ses_$id")),
    )

    private fun sessionPage(vararg ids: String, cursor: String?) = HostedWorkspaceDto(
        ref = HostedWorkspaceRefDto("cloud", "wrk_1"),
        sessions = ids.map { session(it) },
        sessionCursor = cursor,
    )

    private fun session(id: String) = HostedWorkspaceSessionDto(
        id = "hosted:cloud:wrk_1:$id",
        nativeSessionID = id,
        title = id,
        created = 1.0,
        updated = 1.0,
    )

    private class FakeRpc(
        private val pages: Map<String?, HostedWorkspaceListDto> = emptyMap(),
        private val sessionPages: Map<String?, HostedWorkspaceDto> = emptyMap(),
    ) : KiloHostedRpcApi {
        var workspaceCalls = 0
            private set

        override suspend fun providers(): List<HostedProviderDto> =
            pages.values.firstOrNull()?.providers ?: emptyList()

        override suspend fun workspaces(
            repositoryUrl: String?,
            cursor: String?,
            organizationID: String?,
        ): HostedWorkspaceListDto = pages.getValue(cursor)

        override suspend fun workspace(
            ref: HostedWorkspaceRefDto,
            sessionCursor: String?,
            organizationID: String?,
        ): HostedWorkspaceDto {
            workspaceCalls++
            return sessionPages.getValue(sessionCursor)
        }

        override suspend fun workspaceStatus(
            ref: HostedWorkspaceRefDto,
            organizationID: String?,
        ): HostedWorkspaceStatusDto = HostedWorkspaceStatusDto(
            ref = ref,
            deletionState = "active",
            computeStatus = "running",
            computeDetail = "ready",
            observedAt = 1.0,
            activeSessionCount = 1,
            rateMicrodollarsPerHour = 1_000_000,
        )

        override suspend fun systemEvents(
            ref: HostedWorkspaceRefDto,
            sessionID: String,
            organizationID: String?,
        ): Flow<HostedSystemEventDto> = emptyFlow()
    }
}
