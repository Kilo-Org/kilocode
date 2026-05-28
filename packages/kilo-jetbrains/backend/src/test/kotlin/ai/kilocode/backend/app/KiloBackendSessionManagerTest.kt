package ai.kilocode.backend.app

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.app.KiloBackendSessionManager
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.net.URLDecoder
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class KiloBackendSessionManagerTest {

    private val mock = MockCliServer()
    private val log = TestLog()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @AfterTest
    fun tearDown() {
        scope.cancel()
        mock.close()
    }

    private fun setup(): KiloBackendAppService {
        return KiloBackendAppService.create(scope, FakeCliServer(mock), log)
    }

    private suspend fun ready(app: KiloBackendAppService) {
        app.connect()
        withTimeout(10_000) {
            app.appState.first { it is KiloAppState.Ready }
        }
    }

    // ------ Lifecycle ------

    @Test
    fun `session manager starts when app reaches Ready`() = runBlocking {
        mock.sessions = """[
            {"id":"ses_1","slug":"s","projectID":"p","directory":"/d","title":"T","version":"1","time":{"created":1,"updated":1}}
        ]"""
        val app = setup()
        ready(app)

        // Manager was started by app service — CRUD works without manual start()
        val result = app.sessions.list("/d")
        assertEquals(1, result.sessions.size)
        assertEquals("ses_1", result.sessions[0].id)
    }

    @Test
    fun `session manager throws when not started`() = runBlocking {
        val app = setup()
        // Don't connect — manager is not started

        assertFailsWith<IllegalStateException> {
            app.sessions.list("/test")
        }
    }

    @Test
    fun `session manager stops on app disconnect`() = runBlocking {
        val app = setup()
        ready(app)

        // Verify it works
        app.sessions.list("/test")

        // Dispose triggers clear() which calls sessions.stop()
        app.dispose()

        assertFailsWith<IllegalStateException> {
            app.sessions.list("/test")
        }
    }

    // ------ Session list ------

    @Test
    fun `list returns sessions from server`() = runBlocking {
        mock.sessions = """[
            {"id":"ses_1","slug":"s1","projectID":"prj","directory":"/test","title":"Session 1","version":"1","time":{"created":1000,"updated":2000}},
            {"id":"ses_2","slug":"s2","projectID":"prj","directory":"/test","title":"Session 2","version":"1","time":{"created":3000,"updated":4000}}
        ]"""
        val app = setup()
        ready(app)

        val result = app.sessions.list("/test")
        assertEquals(2, result.sessions.size)
        assertEquals("ses_1", result.sessions[0].id)
        assertEquals("Session 1", result.sessions[0].title)
        assertEquals(1000.0, result.sessions[0].time.created)
        assertEquals("ses_2", result.sessions[1].id)
    }

    @Test
    fun `list includes session statuses`() = runBlocking {
        mock.sessions = """[
            {"id":"ses_1","slug":"s","projectID":"p","directory":"/d","title":"T","version":"1","time":{"created":1,"updated":1}}
        ]"""
        mock.sessionStatuses = """{"ses_1":{"type":"busy","attempt":0,"message":"","next":0,"requestID":""}}"""
        val app = setup()
        ready(app)

        app.sessions.seed("/d")
        val result = app.sessions.list("/d")
        assertEquals(1, result.sessions.size)
        assertEquals("busy", result.statuses["ses_1"]?.type)
    }

    @Test
    fun `recent returns global sessions from experimental endpoint`() = runBlocking {
        mock.recentSessions = """[
            {"id":"ses_1","slug":"s1","projectID":"prj","directory":"/repo","title":"Session 1","version":"1","time":{"created":1000,"updated":5000},"project":{"id":"prj","worktree":"/repo","name":"Repo"},"summary":{"additions":10,"deletions":2,"files":3}},
            {"id":"ses_2","slug":"s2","projectID":"prj","directory":"/repo-wt","title":"Session 2","version":"1","time":{"created":2000,"updated":4000},"project":{"id":"prj","worktree":"/repo","name":"Repo"},"parentID":"ses_parent"}
        ]"""
        val app = setup()
        ready(app)

        val result = app.sessions.recent("/repo", 5)

        assertEquals(2, result.sessions.size)
        assertEquals("ses_1", result.sessions[0].id)
        assertEquals("Session 1", result.sessions[0].title)
        assertEquals("/repo", result.sessions[0].directory)
        assertEquals(10, result.sessions[0].summary?.additions)
        assertEquals("ses_parent", result.sessions[1].parentID)
    }

    @Test
    fun `recent passes worktree filters and limit`() = runBlocking {
        val app = setup()
        ready(app)

        app.sessions.recent("/repo path", 5)

        val path = mock.lastExperimentalSessionPath ?: error("missing experimental session request")
        assertTrue(path.startsWith("/experimental/session?"))
        assertTrue(URLDecoder.decode(path, "UTF-8").contains("directory=/repo path"), path)
        assertTrue(path.contains("worktrees=true"), path)
        assertTrue(path.contains("roots=true"), path)
        assertTrue(path.contains("limit=5.0"), path)
        assertTrue(path.contains("archived=false"), path)
    }

    @Test
    fun `recent filters statuses to returned sessions`() = runBlocking {
        mock.recentSessions = """[
            {"id":"ses_1","slug":"s1","projectID":"prj","directory":"/repo","title":"Session 1","version":"1","time":{"created":1,"updated":1},"project":{"id":"prj","worktree":"/repo","name":"Repo"}}
        ]"""
        mock.sessionStatuses = """{
            "ses_1": {"type":"busy","attempt":0,"message":"running","next":0,"requestID":""},
            "ses_other": {"type":"idle","attempt":0,"message":"","next":0,"requestID":""}
        }"""
        val app = setup()
        ready(app)

        val result = app.sessions.recent("/repo", 5)

        assertEquals(setOf("ses_1"), result.statuses.keys)
        assertEquals("busy", result.statuses["ses_1"]?.type)
        assertEquals("running", result.statuses["ses_1"]?.message)
    }

    @Test
    fun `recent throws when not started`() = runBlocking {
        val app = setup()

        assertFailsWith<IllegalStateException> {
            app.sessions.recent("/test", 5)
        }
    }

    @Test
    fun `cloudSessions returns cloud sessions from server`() = runBlocking {
        mock.cloudSessions = """{
            "cliSessions": [
                {"session_id":"cloud_1","title":"Cloud One","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-02T00:00:00Z","version":2}
            ],
            "nextCursor": "next_1"
        }"""
        val app = setup()
        ready(app)

        val result = app.sessions.cloudSessions("/repo", null, 50, null)

        assertEquals(1, result.sessions.size)
        assertEquals("cloud_1", result.sessions[0].id)
        assertEquals("Cloud One", result.sessions[0].title)
        assertEquals("next_1", result.nextCursor)
    }

    @Test
    fun `cloudSessions passes filters and cursor`() = runBlocking {
        val app = setup()
        ready(app)

        app.sessions.cloudSessions("/repo path", "cur 1", 25, "git@github.com:Kilo-Org/kilo.git")

        val path = mock.lastCloudSessionsPath ?: error("missing cloud sessions request")
        assertTrue(path.startsWith("/kilo/cloud-sessions?"))
        val decoded = URLDecoder.decode(path, "UTF-8")
        assertTrue(decoded.contains("directory=/repo path"), path)
        assertTrue(decoded.contains("cursor=cur 1"), path)
        assertTrue(decoded.contains("limit=25"), path)
        assertTrue(decoded.contains("gitUrl=git@github.com:Kilo-Org/kilo.git"), path)
    }

    @Test
    fun `cloudSessions throws when not started`() = runBlocking {
        val app = setup()

        assertFailsWith<IllegalStateException> {
            app.sessions.cloudSessions("/test", null, 50, null)
        }
    }

    @Test
    fun `cloudSessions surfaces server failure`() = runBlocking {
        mock.cloudSessionsStatus = 500
        mock.cloudSessions = """{"error":"boom"}"""
        val app = setup()
        ready(app)

        val err = assertFailsWith<RuntimeException> {
            app.sessions.cloudSessions("/test", null, 50, null)
        }

        assertTrue(err.message.orEmpty().contains("HTTP 500"))
        assertTrue(err.message.orEmpty().contains("boom"))
    }

    @Test
    fun `importCloudSession posts cloud id and returns local session`() = runBlocking {
        mock.cloudSessionImport = """{
            "id":"ses_imported",
            "slug":"imported",
            "projectID":"prj_test",
            "directory":"/repo",
            "title":"Imported Cloud",
            "version":"1.0.0",
            "time":{"created":1000,"updated":2000}
        }"""
        val app = setup()
        ready(app)

        val session = app.sessions.importCloudSession("cloud_1", "/repo path")

        assertEquals("ses_imported", session.id)
        assertEquals("Imported Cloud", session.title)
        val path = mock.lastCloudSessionImportPath ?: error("missing cloud import request")
        assertTrue(path.startsWith("/kilo/cloud/session/import?"))
        assertTrue(URLDecoder.decode(path, "UTF-8").contains("directory=/repo path"), path)
        assertEquals("""{"sessionId":"cloud_1"}""", mock.lastCloudSessionImportBody)
    }

    @Test
    fun `importCloudSession surfaces server failure`() = runBlocking {
        mock.cloudSessionImportStatus = 500
        mock.cloudSessionImport = """{"error":"boom"}"""
        val app = setup()
        ready(app)

        val err = assertFailsWith<RuntimeException> {
            app.sessions.importCloudSession("cloud_1", "/test")
        }

        assertTrue(err.message.orEmpty().contains("HTTP 500"))
        assertTrue(err.message.orEmpty().contains("boom"))
    }

    // ------ Session create ------

    @Test
    fun `create returns new session`() = runBlocking {
        mock.sessionCreate = """{
            "id": "ses_new",
            "slug": "new",
            "projectID": "prj_test",
            "directory": "/test",
            "title": "New Session",
            "version": "1.0.0",
            "time": {"created": 5000, "updated": 5000}
        }"""
        val app = setup()
        ready(app)

        val session = app.sessions.create("/test")
        assertEquals("ses_new", session.id)
        assertEquals("New Session", session.title)
        assertEquals("/test", session.directory)
    }

    // ------ Session delete ------

    @Test
    fun `delete removes directory override`() = runBlocking {
        val app = setup()
        ready(app)

        app.sessions.setDirectory("ses_1", "/worktree/path")
        assertEquals("/worktree/path", app.sessions.getDirectory("ses_1", "/default"))

        app.sessions.delete("ses_1", "/test")
        assertEquals("/default", app.sessions.getDirectory("ses_1", "/default"))
    }

    // ------ Worktree directory management ------

    @Test
    fun `directory override returns worktree path`() = runBlocking {
        val app = setup()
        app.sessions.setDirectory("ses_abc", "/worktree/feature")
        assertEquals("/worktree/feature", app.sessions.getDirectory("ses_abc", "/workspace"))
    }

    @Test
    fun `directory without override returns fallback`() = runBlocking {
        val app = setup()
        assertEquals("/workspace", app.sessions.getDirectory("ses_unknown", "/workspace"))
    }

    // ------ SSE status tracking ------

    @Test
    fun `SSE session status events update status map`() = runBlocking {
        val app = setup()
        ready(app)

        mock.awaitSseConnection()
        mock.pushEvent(
            "session.status",
            """{"type":"session.status","properties":{"sessionID":"ses_live","status":{"type":"busy","attempt":0,"message":"processing","next":0,"requestID":""}}}""",
        )

        withTimeout(5_000) {
            app.sessions.statuses.first { it.containsKey("ses_live") }
        }

        val status = app.sessions.statuses.value["ses_live"]
        assertNotNull(status)
        assertEquals("busy", status.type)
    }

    @Test
    fun `SSE status updates replace previous status`() = runBlocking {
        val app = setup()
        ready(app)

        mock.awaitSseConnection()
        mock.pushEvent(
            "session.status",
            """{"type":"session.status","properties":{"sessionID":"ses_x","status":{"type":"busy"}}}""",
        )

        withTimeout(5_000) {
            app.sessions.statuses.first { it["ses_x"]?.type == "busy" }
        }

        mock.pushEvent(
            "session.status",
            """{"type":"session.status","properties":{"sessionID":"ses_x","status":{"type":"idle"}}}""",
        )

        withTimeout(5_000) {
            app.sessions.statuses.first { it["ses_x"]?.type == "idle" }
        }

        assertEquals("idle", app.sessions.statuses.value["ses_x"]?.type)
    }

    @Test
    fun `seed populates status map from server`() = runBlocking {
        mock.sessionStatuses = """{
            "ses_a": {"type":"idle","attempt":0,"message":"","next":0,"requestID":""},
            "ses_b": {"type":"busy","attempt":0,"message":"","next":0,"requestID":""}
        }"""
        val app = setup()
        ready(app)

        app.sessions.seed("/test")
        assertEquals("idle", app.sessions.statuses.value["ses_a"]?.type)
        assertEquals("busy", app.sessions.statuses.value["ses_b"]?.type)
    }

    @Test
    fun `statuses cleared on stop`() = runBlocking {
        mock.sessionStatuses = """{"ses_1":{"type":"busy","attempt":0,"message":"","next":0,"requestID":""}}"""
        val app = setup()
        ready(app)

        app.sessions.seed("/test")
        assertTrue(app.sessions.statuses.value.isNotEmpty())

        app.sessions.stop()
        assertTrue(app.sessions.statuses.value.isEmpty())
    }

    // ------ Concurrency ------

    @Test
    fun `concurrent status updates are not lost`() = runBlocking {
        mock.sessionStatuses = "{}"
        val app = setup()
        ready(app)

        // Seed statuses from multiple coroutines while SSE events arrive
        val ids = (1..20).map { "ses_concurrent_$it" }
        val half = ids.size / 2

        // First half: seed via SSE events
        mock.awaitSseConnection()
        ids.take(half).forEach { id ->
            mock.pushEvent(
                "session.status",
                """{"type":"session.status","properties":{"sessionID":"$id","status":{"type":"busy"}}}""",
            )
        }

        // Second half: seed via server-side status endpoint
        val statusJson = ids.drop(half).joinToString(",") { id ->
            """"$id":{"type":"idle","attempt":0,"message":"","next":0,"requestID":""}"""
        }
        mock.sessionStatuses = "{$statusJson}"
        app.sessions.seed("/test")

        // Wait for all statuses to be present
        withTimeout(10_000) {
            while (true) {
                val statuses = app.sessions.statuses.value
                val found = ids.count { it in statuses }
                if (found == ids.size) break
                delay(100)
            }
        }

        val statuses = app.sessions.statuses.value
        ids.forEach { id -> assertTrue(id in statuses, "Missing status for $id") }
    }

    @Test
    fun `start after stop re-activates`() = runBlocking {
        val app = setup()
        ready(app)

        // Verify it works
        app.sessions.list("/test")

        // Stop and restart
        app.sessions.stop()
        assertFailsWith<IllegalStateException> { app.sessions.list("/test") }

        // Re-start (simulate what app service does on reconnect)
        app.sessions.start(app.api!!, app.http!!, app.port, app.events)

        // CRUD should work again
        val result = app.sessions.list("/test")
        assertNotNull(result)
    }

    // ------ Session rename ------

    @Test
    fun `rename patches session title and returns updated session`() = runBlocking {
        mock.sessionRenameResponse = """{
            "id": "ses_1",
            "slug": "s1",
            "projectID": "prj_test",
            "directory": "/test",
            "title": "New Name",
            "version": "1.0.0",
            "time": {"created": 1000, "updated": 2000}
        }"""
        val app = setup()
        ready(app)

        val session = app.sessions.rename("ses_1", "/test", "New Name")

        assertEquals("ses_1", session.id)
        assertEquals("New Name", session.title)
        val path = mock.lastSessionRenamePath ?: error("missing rename request")
        assertTrue(path.startsWith("/session/ses_1?"), "Expected /session/ses_1?... got $path")
        assertTrue(path.contains("directory=%2Ftest"), "Expected directory=/test in $path")
        assertEquals("PATCH", mock.lastSessionRenameMethod)
        assertEquals("""{"title":"New Name"}""", mock.lastSessionRenameBody)
    }

    @Test
    fun `rename response preserves directory parentId summary and timestamps`() = runBlocking {
        mock.sessionRenameResponse = """{
            "id": "ses_1",
            "slug": "s1",
            "projectID": "prj_test",
            "directory": "/worktree/path",
            "title": "Renamed",
            "version": "2.0.0",
            "time": {"created": 1000, "updated": 9999},
            "parentID": "ses_parent",
            "summary": {"additions": 5, "deletions": 3, "files": 2}
        }"""
        val app = setup()
        ready(app)

        val session = app.sessions.rename("ses_1", "/test", "Renamed")

        assertEquals("/worktree/path", session.directory)
        assertEquals("ses_parent", session.parentID)
        assertEquals(1000.0, session.time.created)
        assertEquals(9999.0, session.time.updated)
        assertNotNull(session.summary)
        assertEquals(5, session.summary!!.additions)
        assertEquals(3, session.summary!!.deletions)
        assertEquals(2, session.summary!!.files)
    }

    @Test
    fun `rename url-encodes session id and directory for special characters`() = runBlocking {
        // Session IDs/directories may contain spaces, slashes, plus signs, and ampersands
        val app = setup()
        ready(app)

        app.sessions.rename("ses_a/b c", "/my dir/project", "New Name")

        val path = mock.lastSessionRenamePath ?: error("missing rename request")
        assertTrue(path.startsWith("/session/ses_a%2Fb%20c?"), "Expected encoded session path in $path")
        assertTrue(path.contains("directory=%2Fmy%20dir%2Fproject"), "Expected encoded directory in $path")
    }

    @Test
    fun `rename url-encodes ampersand plus and query separators`() = runBlocking {
        val app = setup()
        ready(app)

        app.sessions.rename("ses_a+b&c?d", "/path?a=1&b=2", "Title")

        val path: String = mock.lastSessionRenamePath ?: error("missing rename request")
        val bare = path.substringBefore("?")
        val query = path.substringAfter("?", "")
        assertTrue(path.contains("/session/ses_a+b&c%3Fd?"), "Unexpected encoded session id: $path")
        assertFalse(query.contains("/path?a=1&b=2"), "Directory must be encoded as one query value: $query")
        assertTrue(query.contains("directory=%2Fpath%3Fa%3D1%26b%3D2"), "Unexpected encoded directory: $query")
    }

    @Test
    fun `rename encodes title in json body`() = runBlocking {
        val app = setup()
        ready(app)

        app.sessions.rename("ses_1", "/test", "Has \"quotes\" and \\ backslash")

        assertEquals("""{"title":"Has \"quotes\" and \\ backslash"}""", mock.lastSessionRenameBody)
    }

    @Test
    fun `rename encodes title control characters in json body`() = runBlocking {
        val app = setup()
        ready(app)

        app.sessions.rename("ses_1", "/test", "Line\nTab\tReturn\rBell\u0007")

        assertEquals("""{"title":"Line\nTab\tReturn\rBell\u0007"}""", mock.lastSessionRenameBody)
    }

    @Test
    fun `rename surfaces server failure`() = runBlocking {
        mock.sessionRenameStatus = 500
        mock.sessionRenameResponse = """{"error":"boom"}"""
        val app = setup()
        ready(app)

        val err = assertFailsWith<RuntimeException> {
            app.sessions.rename("ses_1", "/test", "New Name")
        }

        assertTrue(err.message.orEmpty().contains("HTTP 500"))
        assertTrue(err.message.orEmpty().contains("boom"))
    }

    @Test
    fun `rename throws before start`() = runBlocking {
        val app = setup()
        // Don't connect — manager is not started

        assertFailsWith<IllegalStateException> {
            app.sessions.rename("ses_1", "/test", "Title")
        }
    }

    // ------ Session with summary ------

    @Test
    fun `session summary maps correctly`() = runBlocking {
        mock.sessions = """[{
            "id": "ses_sum",
            "slug": "sum",
            "projectID": "prj",
            "directory": "/d",
            "title": "With Summary",
            "version": "1",
            "time": {"created": 1, "updated": 1},
            "summary": {"additions": 42, "deletions": 7, "files": 3}
        }]"""
        val app = setup()
        ready(app)

        val result = app.sessions.list("/d")
        val session = result.sessions[0]
        assertNotNull(session.summary)
        assertEquals(42, session.summary!!.additions)
        assertEquals(7, session.summary!!.deletions)
        assertEquals(3, session.summary!!.files)
    }

    @Test
    fun `status and summary long values clamp to shared dto int range`() = runBlocking {
        mock.sessions = """[{
            "id": "ses_big",
            "slug": "big",
            "projectID": "prj",
            "directory": "/d",
            "title": "Big",
            "version": "1",
            "time": {"created": 1, "updated": 1},
            "summary": {"additions": 2147483648, "deletions": 9223372036854775807, "files": 3}
        }]"""
        mock.sessionStatuses = """{
            "ses_big": {"type":"retry","attempt":2147483648,"message":"retrying","next":9223372036854775807,"requestID":"req"}
        }"""
        val app = setup()
        ready(app)

        val result = app.sessions.list("/d")
        val session = result.sessions[0]
        val status = result.statuses["ses_big"] ?: error("missing status")

        assertEquals(Int.MAX_VALUE, session.summary?.additions)
        assertEquals(Int.MAX_VALUE, session.summary?.deletions)
        assertEquals(Int.MAX_VALUE, status.attempt)
        assertEquals(Long.MAX_VALUE, status.next)
    }
}
