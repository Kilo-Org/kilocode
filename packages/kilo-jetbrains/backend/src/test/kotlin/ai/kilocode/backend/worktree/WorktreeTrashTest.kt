package ai.kilocode.backend.worktree

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WorktreeTrashTest {
    private val root: Path = Files.createTempDirectory("kilo-worktree-trash")
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val trash = WorktreeTrash(scope)

    @AfterTest
    fun tearDown() {
        scope.cancel()
        delete(root)
    }

    @Test
    fun `mark and unmark toggle doomed for the exact path`() {
        val dir = root.resolve("wt").also { Files.createDirectories(it) }
        assertFalse(trash.doomed(dir.toString()))
        trash.mark(dir.toString())
        assertTrue(trash.doomed(dir.toString()))
        trash.unmark(dir.toString())
        assertFalse(trash.doomed(dir.toString()))
    }

    @Test
    fun `doomed matches a path resolved through a symlink the same as its real target`() {
        val real = root.resolve("real").also { Files.createDirectories(it) }
        val link = root.resolve("link")
        try {
            Files.createSymbolicLink(link, real)
        } catch (e: Exception) {
            return // symlinks unsupported (e.g. some Windows CI configs without privilege) — skip
        }
        trash.mark(link.toString())
        assertTrue(trash.doomed(real.toString()))
    }

    @Test
    fun `unmark clears the entry even though the directory disappeared after mark`() {
        // The real removal sequence: mark while the checkout exists, stage it away, then unmark in a
        // finally block. Anything derived from toRealPath() is no longer reproducible by then, so an
        // entry keyed on it would leak and keep the slug invisible to every poll until the IDE
        // restarts — including for a worktree later recreated at the same path.
        val dir = root.resolve("wt").also { Files.createDirectories(it) }
        trash.mark(dir.toString())
        assertNotNull(trash.stage(dir))
        trash.unmark(dir.toString())

        assertFalse(trash.doomed(dir.toString()), "unmark must clear the entry mark() created")
        Files.createDirectories(dir)
        assertFalse(trash.doomed(dir.toString()), "a worktree recreated at the path must not stay doomed")
    }

    @Test
    fun `doomed still matches the forms captured at mark time once nothing resolves any more`() {
        val real = root.resolve("real").also { Files.createDirectories(it) }
        val link = root.resolve("link")
        try {
            Files.createSymbolicLink(link, real)
        } catch (e: Exception) {
            return // symlinks unsupported (e.g. some Windows CI configs without privilege) — skip
        }
        val resolved = link.toRealPath() // the identity mark() records, captured while still resolvable

        trash.mark(link.toString())
        delete(real)
        Files.deleteIfExists(link)

        // Recording both forms up front is what keeps this matching: a removal renames the checkout
        // away immediately, and once nothing resolves, a query can only be compared against whatever
        // was captured while it still did.
        assertTrue(trash.doomed(link.toString()), "the name used to mark must keep matching")
        assertTrue(trash.doomed(resolved.toString()), "the resolved form recorded at mark time must keep matching")
    }

    @Test
    fun `doomed is true for any path whose name carries the delete prefix`() {
        val staged = root.resolve("${WorktreeTrash.PREFIX}abc-123")
        assertTrue(trash.doomed(staged.toString()))
    }

    @Test
    fun `stage renames the directory to a delete-prefixed sibling`() = runBlocking {
        val dir = root.resolve("wt").also { Files.createDirectories(it) }
        Files.writeString(dir.resolve("file.txt"), "content")

        val temp = trash.stage(dir)

        assertNotNull(temp)
        assertFalse(Files.exists(dir))
        assertTrue(Files.exists(temp))
        assertTrue(temp.fileName.toString().startsWith(WorktreeTrash.PREFIX))
        assertEquals("content", Files.readString(temp.resolve("file.txt")))
    }

    @Test
    fun `stage returns null without throwing when the source does not exist`() = runBlocking {
        val missing = root.resolve("missing")
        assertNull(trash.stage(missing))
    }

    @Test
    fun `reap deletes a populated tree`() = runBlocking {
        val dir = root.resolve("${WorktreeTrash.PREFIX}reap-me")
        Files.createDirectories(dir.resolve("nested"))
        Files.writeString(dir.resolve("nested").resolve("file.txt"), "x")

        trash.reap(dir)
        trash.drain()

        assertFalse(Files.exists(dir))
    }

    @Test
    fun `reap of an already-gone directory is a no-op`() = runBlocking {
        trash.reap(root.resolve("${WorktreeTrash.PREFIX}never-existed"))
        trash.drain() // must not throw
    }

    @Test
    fun `sweep reaps every delete-prefixed directory and ignores ordinary ones`() = runBlocking {
        val orphanA = root.resolve("${WorktreeTrash.PREFIX}a").also { Files.createDirectories(it) }
        val orphanB = root.resolve("${WorktreeTrash.PREFIX}b").also { Files.createDirectories(it) }
        val kept = root.resolve("kept-worktree").also { Files.createDirectories(it) }

        trash.sweep(root)
        trash.drain()

        assertFalse(Files.exists(orphanA))
        assertFalse(Files.exists(orphanB))
        assertTrue(Files.exists(kept))
    }

    @Test
    fun `sweep on a missing storage directory does not throw`() = runBlocking {
        trash.sweep(root.resolve("missing"))
        trash.drain()
    }

    @Test
    fun `concurrent reaps and sweeps over the same tree still delete it without failing`() = runBlocking {
        // sweep() runs on every list() poll while a reap of the same staged tree may already be in
        // flight. Two walkers over one tree would otherwise abort each other as each deletes files the
        // other is about to visit, leaving the tree behind.
        val dir = root.resolve("${WorktreeTrash.PREFIX}contended")
        repeat(40) { i ->
            val nested = dir.resolve("nested-$i")
            Files.createDirectories(nested)
            repeat(10) { j -> Files.writeString(nested.resolve("file-$j.txt"), "x".repeat(64)) }
        }

        repeat(4) { trash.reap(dir) }
        repeat(4) { trash.sweep(root) }
        trash.drain()

        assertFalse(Files.exists(dir), "the tree must be gone despite contending walkers")
    }

    @Test
    fun `repeated sweeps and reaps do not accumulate jobs`() = runBlocking {
        // jobs exists only so drain() can await in-flight work; if completed entries were never
        // removed it would grow for the whole IDE session, since sweep() is called from every poll.
        repeat(30) {
            trash.sweep(root)
            trash.reap(root.resolve("${WorktreeTrash.PREFIX}absent-$it"))
        }
        trash.drain()

        assertEquals(0, trash.pending(), "every finished reap/sweep must drop out of the job list")
    }

    private fun delete(path: Path) {
        if (!Files.exists(path)) return
        Files.walk(path).use { stream ->
            stream.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }
}
