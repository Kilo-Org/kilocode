package ai.kilocode.backend.app

import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.net.URLDecoder
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class KiloBackendSessionManagerBoardTest {

    private val mock = MockCliServer()
    private val log = TestLog()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val apps = mutableListOf<KiloBackendAppService>()

    @AfterTest
    fun tearDown() {
        apps.forEach { it.dispose() }
        apps.clear()
        scope.cancel()
        mock.close()
    }

    private fun setup(): KiloBackendAppService =
        KiloBackendAppService.create(scope, FakeCliServer(mock), log).also { apps.add(it) }

    private suspend fun ready(app: KiloBackendAppService) {
        app.connect()
        withTimeout(10_000) {
            app.appState.first { it is KiloAppState.Ready }
        }
    }

    @Test
    fun `sessionBoard loads messages from the kilocode board endpoint`() = runBlocking {
        mock.sessionBoard = """{"ownerSessionID":"ses_root","revision":3,"hasMore":true,"cursor":"m2",""" +
            """"messages":[""" +
            """{"id":"m1","timestamp":1000,"from":"main","to":"ALL","type":"INFO","body":"first"},""" +
            """{"id":"m2","timestamp":2000,"from":"ses_a","to":"main","fromLabel":"Explorer","type":"RESULT","body":"second","reply_to":"m1"}""" +
            """]}"""
        val app = setup()
        ready(app)

        val board = app.sessions.sessionBoard("ses_root", "/repo", before = null, limit = 20)

        assertEquals("ses_root", board.ownerSessionID)
        assertEquals(3, board.revision)
        assertTrue(board.hasMore)
        assertEquals("m2", board.cursor)
        assertEquals(2, board.messages.size)
        assertEquals("first", board.messages[0].body)
        assertEquals("Explorer", board.messages[1].fromLabel)
        assertEquals("m1", board.messages[1].reply_to)
        val path = mock.lastSessionBoardPath ?: error("missing board request")
        assertTrue(path.startsWith("/kilocode/session/ses_root/board?"), "Expected board path, got $path")
        val decoded = URLDecoder.decode(path, "UTF-8")
        assertTrue(decoded.contains("directory=/repo"), decoded)
        assertTrue(decoded.contains("limit=20"), decoded)
    }

    @Test
    fun `sessionBoard omits before and limit when absent`() = runBlocking {
        val app = setup()
        ready(app)

        app.sessions.sessionBoard("ses_root", "/repo", before = null, limit = null)

        val path = mock.lastSessionBoardPath ?: error("missing board request")
        val decoded = URLDecoder.decode(path, "UTF-8")
        assertTrue(!decoded.contains("before="), decoded)
        assertTrue(!decoded.contains("limit="), decoded)
    }

    @Test
    fun `sessionBoard forwards the before cursor for backward paging`() = runBlocking {
        val app = setup()
        ready(app)

        app.sessions.sessionBoard("ses_root", "/repo", before = "m5", limit = 10)

        val decoded = URLDecoder.decode(mock.lastSessionBoardPath!!, "UTF-8")
        assertTrue(decoded.contains("before=m5"), decoded)
    }

    @Test
    fun `sessionBoard throws on an ownership mismatch`() = runBlocking {
        mock.sessionBoard = """{"ownerSessionID":"ses_other","revision":1,"hasMore":false,"messages":[]}"""
        val app = setup()
        ready(app)

        assertFailsWith<IllegalStateException> {
            app.sessions.sessionBoard("ses_root", "/repo", before = null, limit = null)
        }
    }

    @Test
    fun `sessionBoard surfaces server failure`() = runBlocking {
        mock.sessionBoardStatus = 500
        mock.sessionBoard = """{"error":"boom"}"""
        val app = setup()
        ready(app)

        val err = assertFailsWith<RuntimeException> {
            app.sessions.sessionBoard("ses_root", "/repo", before = null, limit = null)
        }
        assertTrue(err.message.orEmpty().contains("HTTP 500"))
    }

    @Test
    fun `resetSessionBoard posts the revision and returns the cleared board`() = runBlocking {
        mock.resetSessionBoardResponse = """{"ownerSessionID":"ses_root","revision":4,"hasMore":false,"messages":[]}"""
        val app = setup()
        ready(app)

        val board = app.sessions.resetSessionBoard("ses_root", "/repo", 3)

        assertEquals(4, board?.revision)
        assertEquals(emptyList(), board?.messages)
        val path = mock.lastResetSessionBoardPath ?: error("missing reset request")
        assertTrue(path.startsWith("/kilocode/session/ses_root/board/reset?"), "Expected reset path, got $path")
        assertTrue(URLDecoder.decode(path, "UTF-8").contains("directory=/repo"), path)
        assertEquals("""{"revision":3}""", mock.lastResetSessionBoardBody)
    }

    @Test
    fun `resetSessionBoard returns null on a revision conflict`() = runBlocking {
        mock.resetSessionBoardStatus = 409
        val app = setup()
        ready(app)

        val board = app.sessions.resetSessionBoard("ses_root", "/repo", 1)

        assertNull(board)
    }

    @Test
    fun `resetSessionBoard throws on an ownership mismatch`() = runBlocking {
        mock.resetSessionBoardResponse = """{"ownerSessionID":"ses_other","revision":1,"hasMore":false,"messages":[]}"""
        val app = setup()
        ready(app)

        assertFailsWith<IllegalStateException> {
            app.sessions.resetSessionBoard("ses_root", "/repo", 1)
        }
    }

    @Test
    fun `resetSessionBoard surfaces non-conflict server failure`() = runBlocking {
        mock.resetSessionBoardStatus = 500
        mock.resetSessionBoardResponse = """{"error":"boom"}"""
        val app = setup()
        ready(app)

        val err = assertFailsWith<RuntimeException> {
            app.sessions.resetSessionBoard("ses_root", "/repo", 1)
        }
        assertTrue(err.message.orEmpty().contains("HTTP 500"))
    }
}
