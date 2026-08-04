package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.ChatEventDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class KiloSessionRpcApiImplTest {
    private val apps = mutableListOf<KiloBackendAppService>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @AfterTest
    fun tearDown() = runBlocking {
        apps.forEach { it.dispose() }
        apps.clear()
        scope.cancel()
    }

    @Test
    fun `events logs normal completion`() = runBlocking(Dispatchers.Default) {
        val log = TestLog()
        val api = KiloSessionRpcApiImpl(log = log, source = flowOf(ChatEventDto.TurnOpen("ses_test")))

        api.events("ses_test", "/test").toList()

        assertTrue(log.messages.any { it.contains("route=rpc-events start=true") }, log.messages.joinToString("\n"))
        assertTrue(log.messages.any { it.contains("route=rpc-events stop=true cancelled=false") }, log.messages.joinToString("\n"))
    }

    @Test
    fun `events logs cancelled completion`() = runBlocking(Dispatchers.Default) {
        val log = TestLog()
        val api = KiloSessionRpcApiImpl(log = log, source = flow { kotlinx.coroutines.awaitCancellation() })
        val job = launch { api.events("ses_test", "/test").collect {} }
        assertTrue(log.awaitMessage { it.contains("route=rpc-events start=true") })

        job.cancelAndJoin()

        assertTrue(log.messages.any { it.contains("route=rpc-events stop=true cancelled=true") }, log.messages.joinToString("\n"))
    }

    @Test
    fun `events logs failed completion`() = runBlocking(Dispatchers.Default) {
        val log = TestLog()
        val api = KiloSessionRpcApiImpl(log = log, source = flow { throw IllegalStateException("stream failed") })

        assertFailsWith<IllegalStateException> {
            api.events("ses_test", "/test").toList()
        }

        assertTrue(log.messages.any { it.contains("route=rpc-events stop=true failed message=stream failed") }, log.messages.joinToString("\n"))
    }

    @Test
    fun `diffFile loads full detail with message scope`() = runBlocking(Dispatchers.Default) {
        val mock = MockCliServer()
        try {
            mock.sessionDiff = """
                [{"file":"src/Main.kt","additions":1,"deletions":1,"status":"modified","patch":"@@ -1 +1 @@\n-old\n+new\n","before":"old\nkeep\n","after":"new\nkeep\n"}]
            """.trimIndent()
            val api = KiloSessionRpcApiImpl(app(mock))

            val diff = api.diffFile("ses_test", "/work", "src/Main.kt", "msg1")

            assertNotNull(diff)
            assertEquals("old\nkeep\n", diff.before)
            assertEquals("new\nkeep\n", diff.after)
            val path = assertNotNull(mock.lastSessionDiffPath)
            assertTrue(path.contains("full=true"), path)
            assertTrue(path.contains("file=src%2FMain.kt"), path)
            assertTrue(path.contains("messageID=msg1"), path)
        } finally {
            mock.close()
        }
    }

    @Test
    fun `diffFile matches the requested file when server returns the whole diff`() = runBlocking(Dispatchers.Default) {
        val mock = MockCliServer()
        try {
            // A CLI without full/file support ignores the params and returns every changed file;
            // diffFile must select the requested path, not the first entry.
            mock.sessionDiff = """
                [{"file":"src/A.kt","additions":1,"deletions":0,"status":"modified","patch":"a"},
                 {"file":"src/B.kt","additions":2,"deletions":0,"status":"modified","patch":"b"}]
            """.trimIndent()
            val api = KiloSessionRpcApiImpl(app(mock))

            val diff = api.diffFile("ses_test", "/work", "src/B.kt", null)

            assertNotNull(diff)
            assertEquals("src/B.kt", diff.file)
            assertEquals(2, diff.additions)
        } finally {
            mock.close()
        }
    }

    private suspend fun app(mock: MockCliServer): KiloBackendAppService {
        val log = TestLog()
        val app = KiloBackendAppService.create(scope, FakeCliServer(mock), log).also { apps.add(it) }
        app.connect()
        val state = assertNotNull(
            withTimeoutOrNull(35_000) {
                app.appState.first {
                    it is KiloAppState.Ready || it is KiloAppState.Error || it is KiloAppState.MigrationRequired
                }
            },
            "App startup timed out in ${app.appState.value}; logs=${log.messages}",
        )
        assertIs<KiloAppState.Ready>(state, "App startup failed; logs=${log.messages}")
        return app
    }
}
