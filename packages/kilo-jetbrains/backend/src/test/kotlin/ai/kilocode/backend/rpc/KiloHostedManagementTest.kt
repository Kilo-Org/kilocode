package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.HostedAgentDto
import ai.kilocode.rpc.dto.HostedCreateWorkspaceDto
import ai.kilocode.rpc.dto.HostedIDs
import ai.kilocode.rpc.dto.HostedRepositoryDto
import ai.kilocode.rpc.dto.HostedStartSessionDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class KiloHostedManagementTest {
    private val mock = MockCliServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val apps = mutableListOf<KiloBackendAppService>()
    private val ref = HostedWorkspaceRefDto("cloud", "wrk_1")

    @AfterTest
    fun tearDown() = runBlocking {
        apps.forEach { it.dispose() }
        apps.clear()
        scope.cancel()
        mock.close()
    }

    private fun app(log: TestLog): KiloBackendAppService =
        KiloBackendAppService.create(scope, FakeCliServer(mock), log).also { apps.add(it) }

    private suspend fun ready(app: KiloBackendAppService) {
        app.connect()
        withTimeout(10_000) { app.appState.first { it is KiloAppState.Ready } }
    }

    @Test
    fun `profiles create start and delete use the local Session Host`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloHostedRpcApiImpl(app)

        val profiles = api.workspaceProfiles(null)
        assertEquals("Default", profiles.items.single().name)
        assertTrue(mock.lastHostedProfilesPath.orEmpty().contains("/kilocode/session-host/workspace/profiles"))

        val request = HostedCreateWorkspaceDto(
            repository = HostedRepositoryDto("github", repo = "Kilo-Org/kilocode", branch = "main"),
            profileID = "00000000-0000-4000-8000-000000000001",
            prompt = "Build it",
            agent = HostedAgentDto("code", "kilo/kilo-auto/free"),
            operationKey = "00000000-0000-4000-8000-000000000002",
            messageID = "msg_create",
        )
        val created = api.createWorkspace(request)
        assertNull(created.failure)
        assertEquals(HostedIDs.session("cloud", "wrk_1", "ses_cloud"), created.session?.id)
        assertFalse(created.replayed)
        val createBody = Json.parseToJsonElement(assertNotNull(mock.lastHostedCreateBody)).jsonObject
        assertEquals("github", createBody["repository"]?.jsonObject?.get("type")?.jsonPrimitive?.content)
        assertEquals("Kilo-Org/kilocode", createBody["repository"]?.jsonObject?.get("repo")?.jsonPrimitive?.content)
        assertEquals("00000000-0000-4000-8000-000000000001", createBody["profile"]?.jsonObject?.get("id")?.jsonPrimitive?.content)
        assertEquals("msg_create", createBody["messageID"]?.jsonPrimitive?.content)

        val start = api.startWorkspaceSession(
            ref,
            HostedStartSessionDto(
                prompt = "Another",
                agent = HostedAgentDto("code", "kilo/kilo-auto/free"),
                operationKey = "00000000-0000-4000-8000-000000000003",
                messageID = "msg_start",
            ),
        )
        assertEquals(HostedIDs.session("cloud", "wrk_1", "ses_cloud_2"), start.session?.id)
        assertEquals(
            setOf("prompt", "agent", "operationKey", "messageID"),
            Json.parseToJsonElement(assertNotNull(mock.lastHostedStartBody)).jsonObject.keys,
        )

        val status = api.workspaceStatus(ref, null)
        assertEquals("active", status.deletionState)
        assertEquals("not_started", status.deletion?.phase)
        assertEquals(0, status.deletion?.remainingRuntimeLocationCount)

        val deleted = api.deleteWorkspace(ref, null)
        assertTrue(deleted.success)
        assertTrue(mock.lastHostedDeletePath.orEmpty().startsWith("/kilocode/session-host/workspace/cloud/wrk_1"))
    }

    @Test
    fun `management failures stay typed and retryable`() = runBlocking(Dispatchers.Default) {
        mock.hostedManagementStatus = 503
        val app = app(TestLog())
        ready(app)
        val api = KiloHostedRpcApiImpl(app)

        val created = api.createWorkspace(
            HostedCreateWorkspaceDto(
                repository = HostedRepositoryDto("git", url = "https://example.com/repo.git"),
                profileID = "00000000-0000-4000-8000-000000000001",
                prompt = "Build it",
                agent = HostedAgentDto("code", "kilo/kilo-auto/free"),
                operationKey = "00000000-0000-4000-8000-000000000002",
                messageID = "msg_create",
            ),
        )

        assertEquals("unavailable", created.failure?.code)
        assertTrue(created.failure?.retryable == true)
        assertTrue(created.failure?.message.orEmpty().startsWith("create workspace failed"))
    }
}
