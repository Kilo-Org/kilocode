package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.HostedDiffException
import ai.kilocode.backend.app.HostedDiffTransport
import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import okhttp3.Credentials
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class KiloHostedDiffTest {
    companion object {
        private const val WAIT = 10_000L
        private const val ROOT = "/kilocode/session-host/workspace/cloud/wrk_1"
        private const val REVISION = 9_007_199_254_740_991L
        private const val TIME = "2026-11-17T16:04:00.365Z"
        private val HEAD = "a".repeat(64)
        private val BASE = "b".repeat(40)
        private const val PATH = "src/a +#.kt"
        private const val ID = """{"providerID":"cloud","workspaceID":"wrk_1"}"""
        private const val REPOSITORY = """{"path":"","repoFullName":"Kilo-Org/kilocode"}"""
    }

    private val mock = MockCliServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val apps = mutableListOf<KiloBackendAppService>()
    private val ref = HostedWorkspaceRefDto("cloud", "wrk_1")

    @AfterTest
    fun tearDown() {
        apps.forEach { it.dispose() }
        scope.cancel()
        mock.close()
    }

    private suspend fun api(): KiloHostedRpcApiImpl {
        val app = KiloBackendAppService.create(scope, FakeCliServer(mock), TestLog()).also { apps.add(it) }
        app.connect()
        withTimeout(WAIT) { app.appState.first { it is KiloAppState.Ready } }
        return KiloHostedRpcApiImpl(app)
    }

    private fun comparison() = """{"baseRef":"main","mergeBase":"$BASE","head":"$HEAD","baseRefFallback":{"requested":"main","used":"HEAD~1"}}"""

    private fun metadata(scope: String? = "against-base-branch") = """{
        "path":"$PATH","status":"modified",${scope?.let { "\"scope\":\"$it\"," }.orEmpty()}
        "additions":$REVISION,"deletions":0,"tracked":true,"binary":false,"countsComplete":false,
        "revision":$REVISION,"repository":$REPOSITORY,
        "diff":{"status":"available"},"content":{"status":"available","source":"current"}
    }""".trimIndent()

    private fun changes(files: String = metadata()) = """{
        "id":$ID,"status":"captured","revision":$REVISION,"capturedAt":"$TIME","truncated":true,
        "comparisons":[{"repository":null,"comparison":${comparison()},"truncated":false,"files":[$files]}]
    }""".trimIndent()

    private fun file(scope: String? = "against-base-branch", omission: String? = null) = """{
        "status":"${if (omission == null) "available" else "omitted"}",
        "file":{"schemaVersion":1,"revision":$REVISION,"path":"$PATH",
            ${scope?.let { "\"scope\":\"$it\"," }.orEmpty()}
            "diff":${omission?.let { """{"status":"omitted","reason":"$it"}""" } ?: """{"status":"available","patch":"@@ -1 +1 @@\n-old\n+new\n"}"""},
            "content":${omission?.let { """{"status":"unavailable","reason":"$it"}""" } ?: """{"status":"available","source":"deleted-original","text":"old\n"}"""}},
        "capturedAt":"$TIME","comparison":${comparison()},"currentRevision":null
    }""".trimIndent()

    private fun pull() = """{
        "id":$ID,"status":"linked","reason":null,
        "pullRequest":{"number":$REVISION,"url":"https://github.com/Kilo-Org/kilocode/pull/147",
            "state":"closed","draft":true,"headSha":"$HEAD","baseRef":"main",
            "repository":$REPOSITORY,"cacheStale":true},"truncated":true,
        "files":[{"path":"$PATH","previousPath":"old.kt","status":"renamed","additions":$REVISION,
            "deletions":0,"patchAvailable":false}]
    }""".trimIndent()

    private fun patch(status: String = "available", head: String = HEAD) = """{
        "status":"$status","path":"$PATH","reason":null,
        "omissionReason":${if (status == "omitted") "\"provider_omitted\"" else "null"},
        "headSha":"$head","patch":${if (status == "available") "\"@@ -1 +1 @@\\n-old\\n+new\\n\"" else "null"}
    }""".trimIndent()

    @Test
    fun `all five RPCs use exact authenticated passive routes and query organization without attachment`() = runBlocking(Dispatchers.Default) {
        mock.profile = """{"profile":{"email":"test@test.com","name":"Test"},"balance":null,"currentOrgId":"org_current"}"""
        val api = api()
        mock.hostedDiff = changes()
        val snapshot = api.workspaceChanges(ref, null)
        assertEquals(ref, snapshot.ref)
        assertEquals(REVISION, snapshot.revision)
        assertEquals(TIME, snapshot.capturedAt)
        val group = assertNotNull(snapshot.comparisons).single()
        assertNull(group.repository)
        assertEquals("Kilo-Org/kilocode", group.files.single().repository?.repoFullName)
        assertEquals(REVISION, group.files.single().additions)
        assertEquals(HEAD, group.comparison.head)
        assertEquals("HEAD~1", group.comparison.baseRefFallback?.used)
        mock.hostedDiff = """{"status":"refreshed","changes":${changes()}}"""
        assertEquals(snapshot, api.refreshWorkspaceChanges(ref, "org_override").changes)
        mock.hostedDiff = file()
        val record = assertNotNull(api.workspaceChangeFile(ref, PATH, "against-base-branch", REVISION, "org_override").file)
        assertEquals("deleted-original", record.content.source)
        assertEquals("old\n", record.content.text)
        mock.hostedDiff = pull()
        val published = api.workspacePullRequestDiff(ref, "org_override")
        assertEquals(REVISION, published.pullRequest?.number)
        assertEquals("closed", published.pullRequest?.state)
        assertEquals("renamed", published.files.single().status)
        mock.hostedDiff = patch()
        assertNotNull(api.workspacePullRequestDiffFile(ref, PATH, HEAD, "org_override").patch)

        val calls = mock.hostedDiffCalls
        assertEquals(listOf("GET", "POST", "GET", "GET", "GET"), calls.map { it.method })
        assertEquals(listOf("$ROOT/changes", "$ROOT/changes/refresh", "$ROOT/changes/file", "$ROOT/pull-request-diff", "$ROOT/pull-request-diff/file"), calls.map { it.path.substringBefore('?') })
        assertTrue(calls.all { it.body.isEmpty() && it.authorization == Credentials.basic("kilo", mock.password) })
        val urls = calls.map { "http://localhost${it.path}".toHttpUrl() }
        assertEquals(listOf("org_current", "org_override", "org_override", "org_override", "org_override"), urls.map { it.queryParameter("organizationID") })
        assertEquals(PATH, urls[2].queryParameter("path"))
        assertEquals("against-base-branch", urls[2].queryParameter("scope"))
        assertEquals(REVISION.toString(), urls[2].queryParameter("expectedRevision"))
        assertEquals(PATH, urls[4].queryParameter("path"))
        assertEquals(HEAD, urls[4].queryParameter("expectedHeadSha"))
        assertEquals(calls.map { it.path }, mock.paths.filter { it.startsWith("/kilocode/session-host/") })
        assertNull(mock.lastHostedAttachPath)
        assertTrue(mock.paths.none { it.contains("wake") || it.contains("/worktree/") || it.contains("/gh/") })
    }

    @Test
    fun `absent scope is omitted and preserved without a fabricated default`() = runBlocking(Dispatchers.Default) {
        val api = api()
        mock.hostedDiff = changes(metadata(null))
        assertNull(api.workspaceChanges(ref, null).comparisons?.single()?.files?.single()?.scope)
        mock.hostedDiff = file(null)
        assertNull(api.workspaceChangeFile(ref, PATH, null, REVISION, null).file?.scope)
        assertNull("http://localhost${mock.hostedDiffCalls.last().path}".toHttpUrl().queryParameter("scope"))
        mock.hostedDiff = file()
        assertEquals("against-base-branch", api.workspaceChangeFile(ref, PATH, null, REVISION, null).file?.scope)
    }

    @Test
    fun `optional scope and fallback reject explicit null but preserve absent fields and union nulls`() = runBlocking(Dispatchers.Default) {
        val api = api()
        val fallback = ",\"baseRefFallback\":{\"requested\":\"main\",\"used\":\"HEAD~1\"}"
        listOf(
            changes().replace("\"scope\":\"against-base-branch\"", "\"scope\":null"),
            changes().replace(fallback, ",\"baseRefFallback\":null"),
        ).forEach { raw ->
            mock.hostedDiff = raw
            assertFailsWith<HostedDiffException> { api.workspaceChanges(ref, null) }
        }
        listOf(
            file().replace("\"scope\":\"against-base-branch\"", "\"scope\":null"),
            file().replace(fallback, ",\"baseRefFallback\":null"),
        ).forEach { raw ->
            mock.hostedDiff = raw
            assertFailsWith<HostedDiffException> { api.workspaceChangeFile(ref, PATH, null, REVISION, null) }
        }

        mock.hostedDiff = changes(metadata(null)).replace(fallback, "")
        val group = assertNotNull(api.workspaceChanges(ref, null).comparisons).single()
        assertNull(group.comparison.baseRefFallback)
        assertNull(group.files.single().scope)
        mock.hostedDiff = file(null).replace(fallback, "")
            .replace("\"diff\":{\"status\":\"available\",", "\"diff\":{\"status\":\"available\",\"reason\":null,")
        val available = api.workspaceChangeFile(ref, PATH, null, REVISION, null)
        assertEquals("available", available.status)
        assertNull(available.file?.scope)
        assertNull(available.comparison?.baseRefFallback)
        mock.hostedDiff = file(scope = null, omission = "binary").replace(fallback, "")
        val omitted = api.workspaceChangeFile(ref, PATH, null, REVISION, null)
        assertEquals("omitted", omitted.status)
        assertEquals("binary", omitted.file?.diff?.reason)
        assertNull(omitted.file?.scope)
    }

    @Test
    fun `snapshot and per-file revisions are independent and file reads use the listed file fence`() = runBlocking(Dispatchers.Default) {
        val api = api()
        mock.hostedDiff = changes(metadata().replace("\"revision\":$REVISION", "\"revision\":5"))
        val snapshot = api.workspaceChanges(ref, null)
        assertEquals(REVISION, snapshot.revision)
        val metadata = assertNotNull(snapshot.comparisons).single().files.single()
        assertEquals(5L, metadata.revision)
        mock.hostedDiff = file().replace("\"revision\":$REVISION", "\"revision\":5")
        assertEquals(5L, api.workspaceChangeFile(ref, PATH, metadata.scope, metadata.revision, null).file?.revision)
    }

    @Test
    fun `offline and failed refresh preserve durable saved comparison rather than reporting clean success`() = runBlocking(Dispatchers.Default) {
        val api = api()
        mock.hostedDiff = changes()
        val snapshot = api.workspaceChanges(ref, null)
        listOf("refreshed", "offline", "failed").forEach { status ->
            mock.hostedDiff = """{"status":"$status","changes":${changes()}}"""
            val result = api.refreshWorkspaceChanges(ref, null)
            assertEquals(status, result.status)
            assertEquals(snapshot, result.changes)
        }
        listOf("not_captured", "inconsistent").forEach { status ->
            mock.hostedDiff = """{"id":$ID,"status":"$status","revision":null,"capturedAt":null,"truncated":false,"comparisons":null}"""
            val result = api.workspaceChanges(ref, null)
            assertEquals(status, result.status)
            assertNull(result.comparisons)
        }
        mock.hostedDiff = changes("")
        assertTrue(assertNotNull(api.workspaceChanges(ref, null).comparisons).single().files.isEmpty())
    }

    @Test
    fun `all workspace omission reasons and non-file states remain explicit without renderable content`() = runBlocking(Dispatchers.Default) {
        val api = api()
        listOf("binary", "unsupported", "invalid_utf8", "too_large", "line_limit", "budget_exhausted", "inconsistent", "capture_failed").forEach { reason ->
            mock.hostedDiff = file(omission = reason)
            val result = api.workspaceChangeFile(ref, PATH, "against-base-branch", REVISION, null)
            assertEquals("omitted", result.status)
            assertEquals(reason, result.file?.diff?.reason)
            assertEquals(reason, result.file?.content?.reason)
            assertNull(result.file?.diff?.patch)
            assertNull(result.file?.content?.text)
        }
        listOf("not_captured", "stale", "no_longer_listed").forEach { status ->
            mock.hostedDiff = """{"status":"$status","file":null,"capturedAt":null,"comparison":null,"currentRevision":${if (status == "not_captured") "null" else "5"}}"""
            val result = api.workspaceChangeFile(ref, PATH, null, REVISION, null)
            assertEquals(status, result.status)
            assertNull(result.file)
            assertEquals(if (status == "not_captured") null else 5L, result.currentRevision)
        }
    }

    @Test
    fun `PR omission stale delisted and absent verification states never synthesize a patch`() = runBlocking(Dispatchers.Default) {
        val api = api()
        mock.hostedDiff = pull().replace(HEAD, BASE)
        assertEquals(BASE, api.workspacePullRequestDiff(ref, null).pullRequest?.headSha)
        mock.hostedDiff = patch(head = BASE)
        assertNotNull(api.workspacePullRequestDiffFile(ref, PATH, BASE, null).patch)
        listOf("omitted", "stale", "not_listed", "not_linked", "unverified", "credential_required", "unavailable", "not_github").forEach { status ->
            mock.hostedDiff = patch(status, if (status == "stale") BASE else HEAD)
            val result = api.workspacePullRequestDiffFile(ref, PATH, HEAD, null)
            assertEquals(status, result.status)
            assertNull(result.patch)
            assertEquals(if (status == "omitted") "provider_omitted" else null, result.omissionReason)
        }
        listOf("stale", "not_linked", "unverified", "credential_required", "unavailable", "not_github").forEach { status ->
            mock.hostedDiff = """{"id":$ID,"status":"$status","reason":"no_pull_request","pullRequest":null,"truncated":false,"files":[]}"""
            val result = api.workspacePullRequestDiff(ref, null)
            assertEquals(status, result.status)
            assertNull(result.pullRequest)
            assertTrue(result.files.isEmpty())
        }
    }

    @Test
    fun `workspace identity nullable field and strict snapshot invariants reject malformed responses`() = runBlocking(Dispatchers.Default) {
        val api = api()
        val raw = changes()
        val malformed = listOf(
            "not json", "{}", raw.replace("wrk_1", "wrk_other"), raw.replace("\"cloud\"", "\"other\""),
            raw.replace("\"captured\"", "\"unknown\""), raw.replace("\"revision\":$REVISION", "\"revision\":0"),
            raw.replace(REVISION.toString(), "9007199254740992"), raw.replace("\"additions\":$REVISION", "\"additions\":-1"),
            raw.replace("\"deletions\":0", "\"deletions\":0.5"), raw.replace(HEAD, HEAD.uppercase()),
            raw.replace("\"additions\":$REVISION", "\"additions\":\"$REVISION\""),
            raw.replace(TIME, "yesterday"), raw.replace("\"main\"", "\"-unsafe\""),
            raw.replace("\"repository\":null,", ""),
            JsonObject(Json.parseToJsonElement(raw).jsonObject - "capturedAt").toString(),
            """{"id":$ID,"status":"captured","revision":1,"capturedAt":"$TIME","truncated":false,"comparisons":[]}""",
            """{"id":$ID,"status":"not_captured","revision":null,"capturedAt":null,"truncated":true,"comparisons":null}""",
        )
        malformed.forEach { value ->
            mock.hostedDiff = value
            val error = assertFailsWith<HostedDiffException> { api.workspaceChanges(ref, null) }
            assertEquals("Hosted comparison request failed", error.message)
            assertTrue(generateSequence<Throwable>(error) { it.cause }.all {
                it is HostedDiffException && it.message == "Hosted comparison request failed"
            })
        }
    }

    @Test
    fun `workspace file rejects wrong path requested scope revision and invalid result envelopes`() = runBlocking(Dispatchers.Default) {
        val api = api()
        listOf(
            file().replace(PATH, "other.kt"), file("uncommitted"), file().replace(REVISION.toString(), "5"),
            file().replace("\"schemaVersion\":1", "\"schemaVersion\":2"),
            file().replace("\"currentRevision\":null", "\"currentRevision\":5"),
            file().replace("\"status\":\"available\"", "\"status\":\"omitted\""),
            file().replace("\"text\":\"old\\n\"", "\"text\":null"),
            """{"status":"stale","file":null,"capturedAt":null,"comparison":null,"currentRevision":null}""",
            """{"status":"not_captured","file":null,"comparison":null,"currentRevision":null}""",
        ).forEach { value ->
            mock.hostedDiff = value
            assertFailsWith<HostedDiffException> { api.workspaceChangeFile(ref, PATH, "against-base-branch", REVISION, null) }
        }
    }

    @Test
    fun `PR decoder rejects wrong workspace missing nullable fields unsupported status and unsafe identity`() = runBlocking(Dispatchers.Default) {
        val api = api()
        listOf(
            pull().replace("wrk_1", "wrk_other"), pull().replace("\"reason\":null,", ""),
            pull().replace("\"previousPath\":\"old.kt\",", ""), pull().replace("\"closed\"", "\"merged\""),
            pull().replace(HEAD, HEAD.uppercase()), pull().replace("https://github.com", "http://github.com"),
            pull().replace("https://github.com", "https://token:secret@github.com"),
            pull().replace("\"linked\"", "\"not_linked\""), pull().replace("\"renamed\"", "\"deleted\""),
            pull().replace(REVISION.toString(), "9007199254740992"),
            """{"id":$ID,"status":"not_linked","reason":null,"pullRequest":null,"truncated":false,"files":[{"path":"file.kt","previousPath":null,"status":"modified","additions":0,"deletions":0,"patchAvailable":false}]}""",
        ).forEach { value ->
            mock.hostedDiff = value
            assertFailsWith<HostedDiffException> { api.workspacePullRequestDiff(ref, null) }
        }
        listOf(
            patch().replace(PATH, "other.kt"), patch(head = BASE), patch("omitted", BASE),
            patch().replace("\"reason\":null,", ""), patch().replace("\"omissionReason\":null,", ""),
            patch().replace("\"patch\":\"@@ -1 +1 @@\\n-old\\n+new\\n\"", "\"patch\":\"\""),
            patch("omitted").replace("provider_omitted", "binary"), patch().replace("\"available\"", "\"stale\""),
        ).forEach { value ->
            mock.hostedDiff = value
            assertFailsWith<HostedDiffException> { api.workspacePullRequestDiffFile(ref, PATH, HEAD, null) }
        }
    }

    @Test
    fun `invalid paths and fences are rejected before any hosted network request`() = runBlocking(Dispatchers.Default) {
        val api = api()
        listOf("", "/private/file", "../file", "a/../file", "a//file", "./file", "a/", "a\u0000file").forEach { path ->
            assertFailsWith<IllegalArgumentException> { api.workspaceChangeFile(ref, path, null, REVISION, null) }
            assertFailsWith<IllegalArgumentException> { api.workspacePullRequestDiffFile(ref, path, HEAD, null) }
        }
        assertFailsWith<IllegalArgumentException> { api.workspaceChangeFile(ref, PATH, "default", REVISION, null) }
        assertFailsWith<IllegalArgumentException> { api.workspaceChangeFile(ref, PATH, null, 0, null) }
        assertFailsWith<IllegalArgumentException> { api.workspacePullRequestDiffFile(ref, PATH, HEAD.uppercase(), null) }
        assertTrue(mock.hostedDiffCalls.isEmpty())
    }

    @Test
    fun `HTTP parse offline and oversized failures are sanitized and never become domain absence`(): Unit = runBlocking(Dispatchers.Default) {
        val api = api()
        mock.hostedDiff = """{"token":"secret","url":"https://private-cloud.invalid"}"""
        listOf(401, 403, 404, 409, 429, 500, 503).forEach { status ->
            mock.hostedDiffStatus = status
            val error = assertFailsWith<HostedDiffException> { api.workspaceChanges(ref, null) }
            assertEquals("Hosted comparison request failed", error.message)
            assertTrue(generateSequence<Throwable>(error) { it.cause }.all {
                it is HostedDiffException && it.message == "Hosted comparison request failed"
            })
            assertFailsWith<HostedDiffException> { api.workspacePullRequestDiff(ref, null) }
        }
        mock.hostedDiffStatus = 200
        mock.hostedDiff = " ".repeat(16_777_217)
        assertFailsWith<HostedDiffException> { api.workspaceChanges(ref, null) }
        val calls = mock.hostedDiffCalls.size
        assertFailsWith<HostedDiffException> { HostedDiffTransport(null, null).workspaceChanges(ref, null) }
        assertFailsWith<HostedDiffException> {
            HostedDiffTransport(OkHttpClient(), "https://provider.invalid").workspaceChanges(ref, null)
        }
        assertEquals(calls, mock.hostedDiffCalls.size)
        mock.shutdown()
        assertFailsWith<HostedDiffException> { api.workspaceChanges(ref, null) }
    }

    @Test
    fun `redirects are not followed and refresh operations are never retried`() = runBlocking(Dispatchers.Default) {
        val api = api()
        mock.hostedDiffHandler = { _, writer ->
            writer.write("HTTP/1.1 307 Temporary Redirect\r\nLocation: /private-cloud\r\nContent-Length: 0\r\n\r\n")
            writer.flush()
        }
        assertFailsWith<HostedDiffException> { api.refreshWorkspaceChanges(ref, null) }
        assertEquals(1, mock.hostedDiffCalls.size)
        assertFalse(mock.paths.any { it.contains("private-cloud") })
    }

    @Test
    fun `cancellation closes the underlying socket before headers and during body consumption`() = runBlocking(Dispatchers.Default) {
        val api = api()
        listOf(false, true).forEach { headers ->
            val entered = CompletableDeferred<Unit>()
            val closed = CompletableDeferred<Int>()
            mock.hostedDiffHandler = { socket, writer ->
                if (headers) {
                    writer.write("HTTP/1.1 200 OK\r\nContent-Length: 10000\r\n\r\n{")
                    writer.flush()
                }
                entered.complete(Unit)
                closed.complete(socket.getInputStream().read())
            }
            val pending = async { api.refreshWorkspaceChanges(ref, null) }
            withTimeout(WAIT) { entered.await() }
            pending.cancel()
            assertFailsWith<CancellationException> { withTimeout(WAIT) { pending.await() } }
            assertEquals(-1, withTimeout(WAIT) { closed.await() })
        }
        assertEquals(2, mock.hostedDiffCalls.size)
    }
}
