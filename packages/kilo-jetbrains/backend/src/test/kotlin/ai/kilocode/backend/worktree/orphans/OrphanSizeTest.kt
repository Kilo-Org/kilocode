package ai.kilocode.backend.worktree.orphans

import java.nio.file.Files
import java.nio.file.Path
import kotlinx.coroutines.Job
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class OrphanSizeTest {
    private val root: Path = Files.createTempDirectory("kilo-orphan-size")

    @AfterTest
    fun tearDown() {
        delete(root)
    }

    @Test
    fun `walkSize stops at the entry where the probe reports the walk was cancelled`() {
        val dir = root.resolve("big").also { Files.createDirectories(it) }
        repeat(200) { i -> Files.write(dir.resolve("f$i.bin"), ByteArray(1)) }
        val job = Job()
        var visited = 0

        val size = walkSize(dir) {
            if (++visited == 10) job.cancel()
            job.isActive
        }

        assertNull(size, "a cancelled walk must not answer with a partial size")
        assertEquals(10, visited, "the walk kept visiting entries after cancellation")
    }

    private fun delete(path: Path) {
        if (!Files.exists(path)) return
        Files.walk(path).use { stream ->
            stream.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }
}
