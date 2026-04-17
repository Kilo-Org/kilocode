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
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
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
}
