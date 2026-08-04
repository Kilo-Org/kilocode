package ai.kilocode.backend.rpc

import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.DiffFileDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class KiloSessionRpcApiImplTest {

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

            val diff = KiloSessionRpcApiImpl().diffSides(dir.toString(), DiffFileDto(file, 1, 1, patch, "modified"))

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

            assertNull(KiloSessionRpcApiImpl().diffSides(dir.toString(), DiffFileDto(file, 1, 1, patch, "modified")))
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

            assertNull(KiloSessionRpcApiImpl().diffSides(dir.toString(), DiffFileDto("new.kt", 1, 0, added, "added")))
            assertNull(KiloSessionRpcApiImpl().diffSides(dir.toString(), DiffFileDto("new.kt", 1, 0, null, "added")))
        } finally {
            delete(dir)
        }
    }

    private fun delete(dir: java.nio.file.Path) {
        Files.walk(dir).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }
}
