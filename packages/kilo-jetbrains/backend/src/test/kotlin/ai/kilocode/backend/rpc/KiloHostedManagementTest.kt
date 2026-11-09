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
    fun `personal default carries the current organization`() = runBlocking(Dispatchers.Default) {
        mock.profile = """{"profile":{"email":"test@test.com","name":"Test"},"balance":null,"currentOrgId":"org_1"}"""
        val app = app(TestLog())
        ready(app)
        val api = KiloHostedRpcApiImpl(app)

        assertTrue(api.setPersonalDefaultProfile("00000000-0000-4000-8000-000000000001").success)
        val body = Json.parseToJsonElement(assertNotNull(mock.lastHostedProfileDefaultBody)).jsonObject
        assertEquals("org_1", body["organizationID"]?.jsonPrimitive?.content)
    }

    @Test
    fun `missing personal defaults return the server error without reporting success`() = runBlocking(Dispatchers.Default) {
        mock.hostedManagementStatus = 404
        mock.hostedProfileDefault = """{"message":"Profile not found"}"""
        val app = app(TestLog())
        ready(app)

        val result = KiloHostedRpcApiImpl(app).setPersonalDefaultProfile("00000000-0000-4000-8000-000000000001")

        assertFalse(result.success)
        val failure = assertNotNull(result.failure)
        assertEquals("not_found", failure.code)
        assertEquals("Profile not found", failure.message)
        assertFalse(failure.retryable)
        assertEquals(
            "/kilocode/session-host/workspace/profiles/personal-default",
            mock.lastHostedProfileDefaultPath,
        )
        val body = Json.parseToJsonElement(assertNotNull(mock.lastHostedProfileDefaultBody)).jsonObject
        assertEquals("00000000-0000-4000-8000-000000000001", body["id"]?.jsonPrimitive?.content)
    }

    @Test
    fun `profiles create start and delete use the local Session Host`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloHostedRpcApiImpl(app)

        val profiles = api.workspaceProfiles(null)
        assertEquals(listOf("Default", "Org"), profiles.items.map { it.name })
        assertEquals("00000000-0000-4000-8000-000000000001", profiles.personalDefaultProfileID)
        assertEquals("00000000-0000-4000-8000-000000000002", profiles.organizationDefaultProfileID)
        assertTrue(mock.lastHostedProfilesPath.orEmpty().contains("/kilocode/session-host/workspace/profiles"))

        val default = api.setPersonalDefaultProfile("00000000-0000-4000-8000-000000000001")
        assertTrue(default.success)
        assertEquals("/kilocode/session-host/workspace/profiles/personal-default", mock.lastHostedProfileDefaultPath)
        assertEquals(
            "00000000-0000-4000-8000-000000000001",
            Json.parseToJsonElement(assertNotNull(mock.lastHostedProfileDefaultBody)).jsonObject["id"]?.jsonPrimitive?.content,
        )

        val request = HostedCreateWorkspaceDto(
            repository = HostedRepositoryDto("github", repo = "Kilo-Org/kilocode", branch = "main"),
            profileID = "00000000-0000-4000-8000-000000000001",
            prompt = "Build it",
            agent = HostedAgentDto("code", "kilo/kilo-auto/free", "high"),
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
        assertEquals("high", createBody["agent"]?.jsonObject?.get("variant")?.jsonPrimitive?.content)
        assertEquals("msg_create", createBody["messageID"]?.jsonPrimitive?.content)

        val start = api.startWorkspaceSession(
            ref,
            HostedStartSessionDto(
                prompt = "Another",
                agent = HostedAgentDto("code", "kilo/kilo-auto/free", "low"),
                operationKey = "00000000-0000-4000-8000-000000000003",
                messageID = "msg_start",
            ),
        )
        assertEquals(HostedIDs.session("cloud", "wrk_1", "ses_cloud_2"), start.session?.id)
        val startBody = Json.parseToJsonElement(assertNotNull(mock.lastHostedStartBody)).jsonObject
        assertEquals(
            setOf("prompt", "agent", "operationKey", "messageID"),
            startBody.keys,
        )
        assertEquals("low", startBody["agent"]?.jsonObject?.get("variant")?.jsonPrimitive?.content)

        val status = api.workspaceStatus(ref, null)
        assertEquals("active", status.deletionState)
        assertEquals("not_started", status.deletion?.phase)
        assertEquals(0, status.deletion?.remainingRuntimeLocationCount)

        val deleted = api.deleteWorkspace(ref, null)
        assertTrue(deleted.success)
        assertTrue(mock.lastHostedDeletePath.orEmpty().startsWith("/kilocode/session-host/workspace/cloud/wrk_1"))
    }

    @Test
    fun `workspace creation omits an absent profile from the local Session Host request`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)

        val created = KiloHostedRpcApiImpl(app).createWorkspace(
            HostedCreateWorkspaceDto(
                repository = HostedRepositoryDto("git", url = "https://example.com/repo.git"),
                prompt = "Build it",
                agent = HostedAgentDto("code", "kilo/kilo-auto/free"),
                operationKey = "00000000-0000-4000-8000-000000000002",
                messageID = "msg_create",
            ),
        )

        assertNull(created.failure)
        val body = Json.parseToJsonElement(assertNotNull(mock.lastHostedCreateBody)).jsonObject
        assertEquals(setOf("repository", "prompt", "agent", "operationKey", "messageID"), body.keys)
        assertFalse(body.containsKey("profile"))
    }

    @Test
    fun `workspace creation omits an empty initial message`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)

        val created = KiloHostedRpcApiImpl(app).createWorkspace(
            HostedCreateWorkspaceDto(
                repository = HostedRepositoryDto("git", url = "https://example.com/repo.git"),
                prompt = "",
                agent = HostedAgentDto("code", "kilo/kilo-auto/free"),
                operationKey = "00000000-0000-4000-8000-000000000004",
                messageID = "msg_empty",
            ),
        )

        assertNull(created.failure)
        val body = Json.parseToJsonElement(assertNotNull(mock.lastHostedCreateBody)).jsonObject
        assertEquals(setOf("repository", "agent", "operationKey"), body.keys)
        assertFalse(body.containsKey("prompt"))
        assertFalse(body.containsKey("messageID"))
    }

    @Test
    fun `delete treats a missing workspace as already removed`() = runBlocking(Dispatchers.Default) {
        mock.hostedManagementStatus = 404
        val app = app(TestLog())
        ready(app)

        val deleted = KiloHostedRpcApiImpl(app).deleteWorkspace(ref, null)

        assertTrue(deleted.success)
        assertNull(deleted.failure)
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
