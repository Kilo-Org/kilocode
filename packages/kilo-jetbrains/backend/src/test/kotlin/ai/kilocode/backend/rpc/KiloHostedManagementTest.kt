package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.HostedAgentDto
import ai.kilocode.rpc.dto.HostedCreateWorkspaceDto
import ai.kilocode.rpc.dto.HostedIDs
import ai.kilocode.rpc.dto.HostedPullRequestChecksDto
import ai.kilocode.rpc.dto.HostedPullRequestConversationsDto
import ai.kilocode.rpc.dto.HostedPullRequestMergeabilityDto
import ai.kilocode.rpc.dto.HostedPullRequestReviewDto
import ai.kilocode.rpc.dto.HostedPullRequestSummaryDto
import ai.kilocode.rpc.dto.HostedRepositoryDto
import ai.kilocode.rpc.dto.HostedStartSessionDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class KiloHostedManagementTest {
    companion object {
        private const val WAIT = 10_000L
        private const val PATH = "/kilocode/session-host/workspace/cloud/wrk_1/pull-request"
        private const val LIMIT = 65_536
    }

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
        withTimeout(WAIT) { app.appState.first { it is KiloAppState.Ready } }
    }

    private fun summary(): JsonObject = Json.parseToJsonElement(
        """{
            "url":"https://github.com/Kilo-Org/cloud/pull/142","number":9007199254740991,"state":"open",
            "title":"Hosted PR status","headSha":"${"a".repeat(40)}","lastSyncedAt":"original source timestamp",
            "review":{"decision":"approved","available":true,"pending":false},
            "checks":{"total":21,"passed":6,"failed":5,"pending":4,"skipped":3,"unknown":3,"complete":true,"available":true},
            "conversations":{"unresolved":9007199254740991,"complete":true},
            "mergeability":{"mergeable":true,"state":"clean","complete":true},
            "partial":false,"unavailable":[]
        }""".trimIndent(),
    ).jsonObject

    private fun result(state: String = "available", summary: JsonElement = summary(), refresh: JsonElement? = null): String =
        JsonObject(buildMap {
            put("id", JsonObject(mapOf("providerID" to JsonPrimitive("cloud"), "workspaceID" to JsonPrimitive("wrk_1"))))
            put("state", JsonPrimitive(state))
            put("pullRequest", summary)
            refresh?.let { put("refresh", it) }
        }).toString()

    private fun refresh(status: String, retry: JsonElement = JsonNull) =
        JsonObject(mapOf("status" to JsonPrimitive(status), "retryAt" to retry))

    @Test
    fun `PR read preserves complete evidence through authenticated local RPC without native work`() = runBlocking(Dispatchers.Default) {
        mock.hostedPullRequest = result()
        val app = app(TestLog())
        ready(app)

        val result = KiloHostedRpcApiImpl(app).workspacePullRequest(ref, null)

        assertEquals(ref, result.ref)
        assertEquals("available", result.state)
        assertNull(result.refresh)
        assertEquals(
            HostedPullRequestSummaryDto(
                "https://github.com/Kilo-Org/cloud/pull/142", 9_007_199_254_740_991L, "open", "Hosted PR status",
                "a".repeat(40), "original source timestamp", HostedPullRequestReviewDto("approved", true, false),
                HostedPullRequestChecksDto(21, 6, 5, 4, 3, 3, true, true),
                HostedPullRequestConversationsDto(9_007_199_254_740_991L, true),
                HostedPullRequestMergeabilityDto(true, "clean", true), false, emptyList(),
            ),
            result.pullRequest,
        )
        val call = mock.hostedPullRequestCalls.single()
        assertEquals("GET", call.method)
        assertEquals(PATH, call.path)
        assertEquals("", call.body)
        assertEquals(okhttp3.Credentials.basic("kilo", mock.password), call.authorization)
        assertEquals(listOf(PATH), mock.paths.filter { it.startsWith("/kilocode/session-host/") })
        assertNull(mock.lastHostedAttachPath)
        assertNull(mock.lastHostedDetachPath)
        assertTrue(mock.paths.none { it.contains("wake") || it.contains("/worktree/") || it.contains("/gh/") })
    }

    @Test
    fun `PR read preserves unknown nullable and partial evidence without synthesizing green counts`() = runBlocking(Dispatchers.Default) {
        val value = JsonObject(summary() + mapOf(
            "state" to JsonPrimitive("unknown"), "title" to JsonNull, "headSha" to JsonNull,
            "review" to Json.parseToJsonElement("""{"decision":null,"available":false,"pending":true}"""),
            "checks" to Json.parseToJsonElement("""{"total":0,"passed":0,"failed":0,"pending":0,"skipped":0,"unknown":0,"complete":false,"available":false}"""),
            "conversations" to Json.parseToJsonElement("""{"unresolved":null,"complete":false}"""),
            "mergeability" to Json.parseToJsonElement("""{"mergeable":null,"state":null,"complete":false}"""),
            "partial" to JsonPrimitive(true), "unavailable" to JsonArray(listOf(JsonPrimitive("checks"), JsonPrimitive("statuses"), JsonPrimitive("reviews"))),
        ))
        val app = app(TestLog())
        ready(app)
        val api = KiloHostedRpcApiImpl(app)
        mock.hostedPullRequest = result(summary = value)

        val actual = assertNotNull(api.workspacePullRequest(ref, null).pullRequest)

        assertEquals("unknown", actual.state)
        assertNull(actual.title)
        assertNull(actual.headSha)
        assertEquals(HostedPullRequestReviewDto(null, false, true), actual.review)
        assertEquals(HostedPullRequestChecksDto(0, 0, 0, 0, 0, 0, false, false), actual.checks)
        assertEquals(HostedPullRequestConversationsDto(null, false), actual.conversations)
        assertEquals(HostedPullRequestMergeabilityDto(null, null, false), actual.mergeability)
        assertTrue(actual.partial)
        assertEquals(listOf("checks", "statuses", "reviews"), actual.unavailable)

        val checks = JsonObject(value.getValue("checks").jsonObject + mapOf("available" to JsonPrimitive(true), "complete" to JsonPrimitive(true)))
        mock.hostedPullRequest = result(summary = JsonObject(value + mapOf("checks" to checks, "unavailable" to JsonArray(emptyList()))))
        val zero = assertNotNull(api.workspacePullRequest(ref, null).pullRequest)
        assertEquals(HostedPullRequestChecksDto(0, 0, 0, 0, 0, 0, true, true), zero.checks)
        assertTrue(zero.partial)
        assertEquals(emptyList(), zero.unavailable)
    }

    @Test
    fun `PR result distinguishes authoritative absence and every unavailable state`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloHostedRpcApiImpl(app)
        listOf("no_pr", "signed_out", "rejected", "unreachable", "rate_limited", "unavailable", "unsupported").forEach { state ->
            mock.hostedPullRequest = result(state, JsonNull)
            val actual = api.workspacePullRequest(ref, null)
            assertEquals(ref, actual.ref)
            assertEquals(state, actual.state)
            assertNull(actual.pullRequest)
        }
    }

    @Test
    fun `PR reads never merge prior account organization workspace PR or head evidence`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloHostedRpcApiImpl(app)
        mock.hostedPullRequest = result()
        val initial = api.workspacePullRequest(ref, "org_one")
        assertNotNull(initial.pullRequest)

        val next = JsonObject(summary() + mapOf("headSha" to JsonPrimitive("b".repeat(40)), "title" to JsonNull))
        mock.hostedPullRequest = result(summary = next)
        val changed = assertNotNull(api.workspacePullRequest(ref, "org_two").pullRequest)
        assertEquals("b".repeat(40), changed.headSha)
        assertNull(changed.title)

        mock.hostedPullRequest = result("signed_out", JsonNull)
        assertNull(api.workspacePullRequest(ref, "org_two").pullRequest)
        mock.hostedPullRequest = result()
        assertEquals("unavailable", api.workspacePullRequest(ref.copy(workspaceID = "wrk_other"), "org_one").state)
        assertEquals("unavailable", api.workspacePullRequest(ref.copy(providerID = "other"), "org_one").state)
        mock.hostedPullRequest = result("no_pr", JsonNull)
        val absent = api.workspacePullRequest(ref, "org_one")
        assertEquals("no_pr", absent.state)
        assertNull(absent.pullRequest)
    }

    @Test
    fun `PR refresh retains complete cached evidence and exact retry metadata for every outcome`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloHostedRpcApiImpl(app)
        mock.hostedPullRequest = result()
        val cached = api.workspacePullRequest(ref, null).pullRequest
        mapOf("refreshed" to "available", "no_integration" to "unavailable", "failed" to "unavailable",
            "unavailable" to "unavailable", "rate_limited" to "rate_limited", "throttled" to "rate_limited").forEach { (status, state) ->
            mock.hostedPullRequest = result(state, refresh = refresh(status, JsonPrimitive("original retry timestamp")))
            val actual = api.refreshWorkspacePullRequest(ref, null)
            assertEquals(state, actual.state, status)
            assertEquals(cached, actual.pullRequest, status)
            assertEquals(status, actual.refresh?.status)
            assertEquals("original retry timestamp", actual.refresh?.retryAt)
        }
        mock.hostedPullRequest = result("no_pr", JsonNull, refresh("no_pr"))
        val absent = api.refreshWorkspacePullRequest(ref, null)
        assertEquals("no_pr", absent.state)
        assertNull(absent.pullRequest)
        assertEquals("no_pr", absent.refresh?.status)
        assertNull(absent.refresh?.retryAt)
        assertTrue(mock.hostedPullRequestCalls.drop(1).all { it.method == "POST" && it.path == "$PATH/refresh" && it.body.isEmpty() })

        mock.hostedPullRequest = result("rate_limited", refresh = refresh("throttled", JsonPrimitive("cached retry timestamp")))
        val passive = api.workspacePullRequest(ref, null)
        assertEquals("rate_limited", passive.state)
        assertEquals(cached, passive.pullRequest)
        assertEquals("throttled", passive.refresh?.status)
        assertEquals("cached retry timestamp", passive.refresh?.retryAt)
        assertEquals("GET", mock.hostedPullRequestCalls.last().method)
    }

    @Test
    fun `PR transport preserves provider-neutral HTTPS links and rejects unsafe schemes and userinfo`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloHostedRpcApiImpl(app)
        listOf(
            "https://gitlab.com/group/project/-/merge_requests/142",
            "https://git.example.test:8443/team/repo/pulls/142",
        ).forEach { url ->
            mock.hostedPullRequest = result(summary = JsonObject(summary() + ("url" to JsonPrimitive(url))))
            val actual = api.workspacePullRequest(ref, null)
            assertEquals("available", actual.state, url)
            assertEquals(url, actual.pullRequest?.url)
        }
        listOf(
            "http://github.com/Kilo-Org/cloud/pull/142",
            "javascript:alert(1)",
            "file:///private/repo/pull/142",
            "https://token:secret@github.com/Kilo-Org/cloud/pull/142",
        ).forEach { url ->
            mock.hostedPullRequest = result(summary = JsonObject(summary() + ("url" to JsonPrimitive(url))))
            val actual = api.workspacePullRequest(ref, null)
            assertEquals("unavailable", actual.state, url)
            assertNull(actual.pullRequest, url)
        }
    }

    @Test
    fun `PR organization query uses explicit then current scope while personal calls omit it`() = runBlocking(Dispatchers.Default) {
        mock.profile = """{"profile":{"email":"test@test.com","name":"Test"},"balance":null,"currentOrgId":"org_current"}"""
        val app = app(TestLog())
        ready(app)
        val api = KiloHostedRpcApiImpl(app)
        api.workspacePullRequest(ref, null)
        api.refreshWorkspacePullRequest(ref, null)
        api.workspacePullRequest(ref, "org_explicit")
        api.refreshWorkspacePullRequest(ref, "org_explicit")
        assertEquals(listOf("$PATH?organizationID=org_current", "$PATH/refresh?organizationID=org_current",
            "$PATH?organizationID=org_explicit", "$PATH/refresh?organizationID=org_explicit"), mock.hostedPullRequestCalls.map { it.path })

        mock.profile = """{"profile":{"email":"test@test.com","name":"Test"},"balance":null,"currentOrgId":null}"""
        app.refreshProfile()
        api.workspacePullRequest(ref, null)
        api.refreshWorkspacePullRequest(ref, null)
        assertEquals(listOf(PATH, "$PATH/refresh"), mock.hostedPullRequestCalls.takeLast(2).map { it.path })
    }

    @Test
    fun `PR malformed required nullable properties states and identities never become no PR`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloHostedRpcApiImpl(app)
        val raw = Json.parseToJsonElement(result()).jsonObject
        val invalid = buildList {
            raw.keys.forEach { add(JsonObject(raw - it).toString()) }
            add(result("unknown"))
            add(result("available", JsonNull))
            add(result("no_pr"))
            add(result().replace("wrk_1", "wrk_other"))
            add(result().replace("\"cloud\"", "\"other\""))
            add(result(refresh = JsonNull))
            add(result(refresh = JsonObject(mapOf("status" to JsonPrimitive("refreshed")))))
            add(result(refresh = refresh("unknown")))
            add(result(refresh = refresh("no_pr")))
            add("not JSON credential-secret")
            add("[]")
            add("null")
            add(result(summary = JsonObject(summary() + ("number" to JsonPrimitive(0)))))
            add(result(summary = JsonObject(summary() + ("number" to JsonPrimitive(9_007_199_254_740_992L)))))
            add(result(summary = JsonObject(summary() + ("headSha" to JsonPrimitive("bad")))))
            add(result(summary = JsonObject(summary() + ("lastSyncedAt" to JsonPrimitive("")))))
            add(result(summary = JsonObject(summary() + ("url" to JsonPrimitive("https://token:secret@example.com/pull/1")))))
            add(result(summary = JsonObject(summary() + ("state" to JsonPrimitive("invalid")))))
            add(result(summary = JsonObject(summary() + ("unavailable" to JsonArray(listOf(JsonPrimitive("invalid")))))))
            add(result(summary = JsonObject(summary() + ("number" to JsonPrimitive(1.5)))))
            add(result(summary = JsonObject(summary() + ("partial" to JsonNull))))
            listOf("total", "passed", "failed", "pending", "skipped", "unknown").forEach { key ->
                val counts = summary().getValue("checks").jsonObject
                add(result(summary = JsonObject(summary() + ("checks" to JsonObject(counts + (key to JsonPrimitive(-1)))))))
            }
            summary().forEach { (key, value) ->
                add(result(summary = JsonObject(summary() - key)))
                if (value is JsonObject) value.keys.forEach { nested ->
                    add(result(summary = JsonObject(summary() + (key to JsonObject(value - nested)))))
                }
            }
        }
        invalid.forEach { value ->
            mock.hostedPullRequest = value
            val actual = api.refreshWorkspacePullRequest(ref, null)
            assertEquals("unavailable", actual.state, value)
            assertNull(actual.pullRequest, value)
        }
    }

    @Test
    fun `PR response byte limit accepts valid JSON at the boundary and rejects one extra byte`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloHostedRpcApiImpl(app)
        val body = result().padEnd(LIMIT, ' ')
        val oversized = "$body "
        assertEquals(LIMIT, body.toByteArray(Charsets.UTF_8).size)
        assertEquals(LIMIT + 1, oversized.toByteArray(Charsets.UTF_8).size)
        assertEquals(Json.parseToJsonElement(body), Json.parseToJsonElement(oversized))

        mock.hostedPullRequest = body
        val accepted = api.workspacePullRequest(ref, null)
        assertEquals("available", accepted.state)
        assertNotNull(accepted.pullRequest)

        mock.hostedPullRequest = oversized
        val rejected = api.workspacePullRequest(ref, null)
        assertEquals("unavailable", rejected.state)
        assertNull(rejected.pullRequest)
    }

    @Test
    fun `PR transport bounds the existing authenticated client without changing its global budget`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val http = assertNotNull(app.http)
        assertEquals(0, http.callTimeoutMillis)
        assertEquals(0, http.readTimeoutMillis)
        val budgets = java.util.concurrent.CopyOnWriteArrayList<Long>()
        val client = http.newBuilder().addInterceptor { chain ->
            budgets.add(chain.call().timeout().timeoutNanos())
            assertEquals(180_000, chain.readTimeoutMillis())
            assertEquals(180_000, chain.writeTimeoutMillis())
            assertEquals(180_000, chain.connectTimeoutMillis())
            chain.proceed(chain.request())
        }.build()
        app.hosted.start(assertNotNull(app.api), client, app.port, app.chat)

        val api = KiloHostedRpcApiImpl(app)
        api.workspacePullRequest(ref, null)
        api.refreshWorkspacePullRequest(ref, null)

        assertEquals(listOf(180_000_000_000L, 180_000_000_000L), budgets)
        assertEquals(0, http.callTimeoutMillis)
        assertEquals(0, http.readTimeoutMillis)
    }

    @Test
    fun `PR local HTTP failures are generic typed states and never expose response bodies`() = runBlocking(Dispatchers.Default) {
        val log = TestLog()
        val app = app(log)
        ready(app)
        val api = KiloHostedRpcApiImpl(app)
        mock.hostedPullRequest = "credential-secret provider-origin private-path"
        mapOf(401 to "rejected", 403 to "rejected", 409 to "rejected", 404 to "unsupported", 405 to "unsupported",
            429 to "rate_limited", 500 to "unavailable", 503 to "unavailable").forEach { (status, state) ->
            mock.hostedPullRequestStatus = status
            val actual = api.refreshWorkspacePullRequest(ref, null)
            assertEquals(state, actual.state)
            assertNull(actual.pullRequest)
            assertFalse(actual.toString().contains("credential-secret"))
        }
        assertTrue(log.messages.none { it.contains("credential-secret") || it.contains("provider-origin") || it.contains("private-path") })
    }

    @Test
    fun `PR refresh dispatches only once after losing its response and does not follow redirects`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloHostedRpcApiImpl(app)
        mock.hostedPullRequestHandler = { socket, _ -> socket.close() }
        assertEquals("unreachable", api.refreshWorkspacePullRequest(ref, null).state)
        assertEquals(1, mock.requestCount("$PATH/refresh"))

        mock.hostedPullRequestHandler = { socket, writer ->
            writer.write("HTTP/1.1 307 Temporary Redirect\r\nLocation: /must-not-follow\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            writer.flush()
            socket.close()
        }
        assertEquals("unavailable", api.refreshWorkspacePullRequest(ref, null).state)
        assertEquals(0, mock.requestCount("/must-not-follow"))
        assertEquals(2, mock.requestCount("$PATH/refresh"))

        mock.hostedPullRequestHandler = { socket, writer ->
            writer.write("HTTP/1.1 503 Unavailable\r\nRetry-After: 0\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            writer.flush()
            socket.close()
        }
        assertEquals("unavailable", api.refreshWorkspacePullRequest(ref, null).state)
        assertEquals(3, mock.requestCount("$PATH/refresh"))
    }

    @Test
    fun `PR RPC cancellation cancels the underlying call before headers and during response body`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloHostedRpcApiImpl(app)
        listOf(false, true).forEach { headers ->
            val entered = CompletableDeferred<Unit>()
            val closed = CompletableDeferred<Int>()
            mock.hostedPullRequestHandler = { socket, writer ->
                if (headers) {
                    writer.write("HTTP/1.1 200 OK\r\nContent-Length: 10000\r\n\r\n{")
                    writer.flush()
                }
                entered.complete(Unit)
                closed.complete(socket.getInputStream().read())
            }
            val pending = async { api.refreshWorkspacePullRequest(ref, null) }
            withTimeout(WAIT) { entered.await() }
            pending.cancel()
            assertFailsWith<CancellationException> { withTimeout(WAIT) { pending.await() } }
            assertEquals(-1, withTimeout(WAIT) { closed.await() })
        }
        assertEquals(2, mock.requestCount("$PATH/refresh"))
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
