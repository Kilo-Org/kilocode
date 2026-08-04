package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.DiffFileDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import java.nio.file.Files
import kotlin.io.path.createTempDirectory
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class KiloSessionRpcApiImplTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val apps = mutableListOf<KiloBackendAppService>()

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
    fun `diffSides rebuilds full before by reverse-applying the patch to the working tree`() = runBlocking(Dispatchers.Default) {
        val dir = createTempDirectory("kilo-diff")
        try {
            val file = "src/Main.kt"
            Files.createDirectories(dir.resolve("src"))
            Files.writeString(dir.resolve(file), "a\nB2\nc\n")
            val patch = "--- a/$file\n+++ b/$file\n@@ -1,3 +1,3 @@\n a\n-b2\n+B2\n c\n"

            val diff = KiloSessionRpcApiImpl().diffSides(null, dir.toString(), DiffFileDto(file, 1, 1, patch, "modified"), null)

            assertNotNull(diff)
            assertEquals("a\nb2\nc\n", diff.before)
            assertEquals("a\nB2\nc\n", diff.after)
        } finally {
            delete(dir)
        }
    }

    @Test
    fun `diffSides returns null when the working tree drifted from the patch`() = runBlocking(Dispatchers.Default) {
        val dir = createTempDirectory("kilo-diff")
        try {
            val file = "src/Main.kt"
            Files.createDirectories(dir.resolve("src"))
            Files.writeString(dir.resolve(file), "a\nUNRELATED\nc\n")
            val patch = "--- a/$file\n+++ b/$file\n@@ -1,3 +1,3 @@\n a\n-b2\n+B2\n c\n"

            assertNull(KiloSessionRpcApiImpl().diffSides(null, dir.toString(), DiffFileDto(file, 1, 1, patch, "modified"), null))
        } finally {
            delete(dir)
        }
    }

    @Test
    fun `diffSides returns null for added files and missing patches`() = runBlocking(Dispatchers.Default) {
        val dir = createTempDirectory("kilo-diff")
        try {
            Files.writeString(dir.resolve("new.kt"), "hello\n")
            val added = "--- /dev/null\n+++ b/new.kt\n@@ -0,0 +1 @@\n+hello\n"

            assertNull(KiloSessionRpcApiImpl().diffSides(null, dir.toString(), DiffFileDto("new.kt", 1, 0, added, "added"), null))
            assertNull(KiloSessionRpcApiImpl().diffSides(null, dir.toString(), DiffFileDto("new.kt", 1, 0, null, "added"), null))
        } finally {
            delete(dir)
        }
    }

    @Test
    fun `diffSides prefers authoritative CLI content over local reconstruction`() = runBlocking(Dispatchers.Default) {
        val mock = MockCliServer()
        try {
            mock.sessionDiff =
                """[{"file":"src/Main.kt","additions":1,"deletions":1,"status":"modified","patch":"p","before":"OLD\n","after":"NEW\n"}]"""
            val api = KiloSessionRpcApiImpl(app(mock))

            // No working-tree file exists here, so a non-null result can only come from the CLI path.
            val diff = api.diffSides("ses_test", "/does-not-exist", DiffFileDto("src/Main.kt", 1, 1, "p", "modified"), "msg1")

            assertNotNull(diff)
            assertEquals("OLD\n", diff.before)
            assertEquals("NEW\n", diff.after)
            val path = assertNotNull(mock.lastSessionDiffPath)
            assertTrue(path.contains("full=true"), path)
            assertTrue(path.contains("file=src%2FMain.kt"), path)
            assertTrue(path.contains("messageID=msg1"), path)
        } finally {
            mock.close()
        }
    }

    @Test
    fun `diffSides falls back to local reconstruction when the CLI omits full content`() = runBlocking(Dispatchers.Default) {
        val mock = MockCliServer()
        val dir = createTempDirectory("kilo-diff")
        try {
            // A CLI without full/file support returns the file entry but no before/after.
            mock.sessionDiff = """[{"file":"src/Main.kt","additions":1,"deletions":1,"status":"modified","patch":"p"}]"""
            Files.createDirectories(dir.resolve("src"))
            Files.writeString(dir.resolve("src/Main.kt"), "a\nB2\nc\n")
            val patch = "--- a/src/Main.kt\n+++ b/src/Main.kt\n@@ -1,3 +1,3 @@\n a\n-b2\n+B2\n c\n"
            val api = KiloSessionRpcApiImpl(app(mock))

            val diff = api.diffSides("ses_test", dir.toString(), DiffFileDto("src/Main.kt", 1, 1, patch, "modified"), "msg1")

            assertNotNull(diff)
            assertEquals("a\nb2\nc\n", diff.before)
            assertEquals("a\nB2\nc\n", diff.after)
        } finally {
            delete(dir)
            mock.close()
        }
    }

    private suspend fun app(mock: MockCliServer): KiloBackendAppService {
        val app = KiloBackendAppService.create(scope, FakeCliServer(mock), TestLog()).also { apps.add(it) }
        app.connect()
        val state = assertNotNull(
            withTimeoutOrNull(35_000) {
                app.appState.first {
                    it is KiloAppState.Ready || it is KiloAppState.Error || it is KiloAppState.MigrationRequired
                }
            },
            "App startup timed out in ${app.appState.value}",
        )
        assertIs<KiloAppState.Ready>(state, "App startup failed")
        return app
    }

    private fun delete(dir: java.nio.file.Path) {
        Files.walk(dir).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }
}
