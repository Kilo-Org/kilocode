package ai.kilocode.backend.rpc

import ai.kilocode.backend.worktree.WorktreeTrash
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Exercises [KiloWorktreeRpcApiImpl.remove] and the read paths with a real [WorktreeTrash] wired
 * in, unlike [KiloWorktreeRpcApiImplTest] where every `api` runs with `trash = null` (there is no
 * IntelliJ Application in that plain-unit-test environment, so the default constructor argument's
 * `ApplicationManager.getApplication() == null` guard resolves to null there — see
 * [KiloWorktreeRpcApiImpl]'s `defaultTrash()`). Constructing [WorktreeTrash] directly, the same way
 * [WorktreeTrashTest] does, sidesteps that guard entirely.
 */
class KiloWorktreeRpcApiImplTrashTest {
    private val repo: Path = Files.createTempDirectory("kilo-worktree-trash-rpc")
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val trash = WorktreeTrash(scope)
    private val api = KiloWorktreeRpcApiImpl(trash)

    @AfterTest
    fun tearDown() {
        scope.cancel()
        delete(repo)
    }

    @Test
    fun `remove stages the directory and prunes without waiting for the recursive delete`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)

        val result = api.remove(repo.toString(), created.path, created.branch)

        assertTrue(result.ok, "remove should report success: ${result.error}")
        // The original path is gone immediately -- moved, not deleted synchronously.
        assertFalse(Files.exists(Path.of(created.path)))
        val listed = output(repo, "worktree", "list", "--porcelain")
        assertFalse(listed.contains(created.path), "git must no longer track the removed worktree: $listed")
        assertEquals(
            "",
            output(repo, "for-each-ref", "--format=%(refname)", "refs/heads/feature/x"),
            "remove must delete the branch too",
        )

        trash.drain()
        val storage = repo.resolve(".kilo").resolve("worktrees")
        val orphans = Files.newDirectoryStream(storage).use { stream ->
            stream.filter { it.fileName.toString().startsWith(WorktreeTrash.PREFIX) }.toList()
        }
        assertTrue(orphans.isEmpty(), "the staged directory must be fully reaped: $orphans")
    }

    @Test
    fun `remove succeeds when the checkout was already deleted outside the IDE`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        delete(Path.of(created.path))

        val result = api.remove(repo.toString(), created.path, created.branch)

        assertTrue(result.ok, "remove should still succeed via the prune-only path: ${result.error}")
        val listed = output(repo, "worktree", "list", "--porcelain")
        assertFalse(listed.contains(created.path), "the worktree must be unregistered: $listed")
        // This arm reports success without running any git removal of its own, so the shared prune has
        // to unregister the worktree before `branch -D` runs: git refuses to delete a branch a
        // registered worktree still has checked out, and the default prune expiry is three months, so
        // a just-vanished checkout would not be pruned at all without `--expire now`.
        assertEquals(
            "",
            output(repo, "for-each-ref", "--format=%(refname)", "refs/heads/feature/x"),
            "the branch must be deleted on the prune-only path too",
        )
    }

    @Test
    fun `remove falls back to a synchronous git remove when locked without force, even with staging available`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        git(repo, "worktree", "lock", "--reason", "held by test", created.path)

        val blocked = api.remove(repo.toString(), created.path, created.branch, force = false)

        assertFalse(blocked.ok)
        assertTrue(blocked.locked, "blocked removal should report locked=true: ${blocked.error}")
        // Not renamed away: a filesystem rename cannot see or honor git's lock, so staging must be
        // skipped entirely rather than left half-done.
        assertTrue(Files.exists(Path.of(created.path)), "locked worktree must survive a non-force remove")

        val forced = api.remove(repo.toString(), created.path, created.branch, force = true)
        assertTrue(forced.ok, "force remove should succeed: ${forced.error}")
        assertFalse(Files.exists(Path.of(created.path)))
    }

    @Test
    fun `stats and dirty skip a worktree that WorktreeTrash reports as doomed`() = runBlocking {
        initRepo()
        val kept = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("kept")).worktree)
        val deleting = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("deleting")).worktree)

        trash.mark(deleting.path)
        val stats = api.stats(repo.toString())
        val dirty = api.dirty(repo.toString())
        assertTrue(stats.items.any { it.path == kept.path })
        assertTrue(stats.items.none { it.path == deleting.path }, "a doomed worktree must not be polled by stats")
        assertTrue(dirty.items.any { it.path == kept.path })
        assertTrue(dirty.items.none { it.path == deleting.path }, "a doomed worktree must not be polled by dirty")

        trash.unmark(deleting.path)
        assertTrue(api.stats(repo.toString()).items.any { it.path == deleting.path }, "unmarking must restore polling")
    }

    @Test
    fun `branchStatus skips a directory being deleted without caching the empty answer`() = runBlocking {
        initRepo()
        val worktree = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        // Primes the real cache entry for this key.
        assertEquals("feature/x", api.branchStatus(worktree.path).branch)

        trash.mark(worktree.path)
        // maxAge = 0 forces past any cached entry so this call actually reaches the doomed check.
        assertEquals("", api.branchStatus(worktree.path, maxAge = 0).branch)
        trash.unmark(worktree.path)

        // If the doomed-skip path had wrongly written its empty answer into the cache, this default
        // (TTL-based) lookup would still see it; it must instead find the real cached branch,
        // meaning the skip path never touched the cache at all.
        assertEquals("feature/x", api.branchStatus(worktree.path).branch)
    }

    @Test
    fun `concurrent removes all succeed and leave consistent state`() = runBlocking {
        initRepo()
        val worktrees = (1..4).map { assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("branch-$it")).worktree) }

        val results = coroutineScope {
            worktrees.map { async { api.remove(repo.toString(), it.path, it.branch) } }.map { it.await() }
        }

        results.forEachIndexed { i, result -> assertTrue(result.ok, "removal $i should succeed: ${result.error}") }
        val listed = output(repo, "worktree", "list", "--porcelain")
        worktrees.forEach { assertFalse(listed.contains(it.path), "git must no longer track ${it.path}: $listed") }
        val state = readWorktreeState(repo.resolve(".kilo").resolve("jetbrains.json"))
        worktrees.forEach { wt ->
            assertTrue(wt.path !in state.worktreeOrder, "order must not reference removed worktree ${wt.path}")
            assertTrue(wt.path !in state.names, "names must not reference removed worktree ${wt.path}")
        }
    }

    private fun initRepo() {
        git(repo, "init")
        git(repo, "config", "user.email", "test@kilo.ai")
        git(repo, "config", "user.name", "Kilo Test")
        Files.writeString(repo.resolve("README.md"), "hello")
        git(repo, "add", "README.md")
        git(repo, "commit", "-m", "init")
    }

    private fun git(dir: Path, vararg args: String) {
        val cmd = GeneralCommandLine(listOf("git") + args).withWorkDirectory(dir.toFile())
        val out = CapturingProcessHandler(cmd).runProcess(30_000)
        assertEquals(0, out.exitCode, "git ${args.joinToString(" ")} failed: ${out.stderr}")
    }

    private fun output(dir: Path, vararg args: String): String {
        val cmd = GeneralCommandLine(listOf("git") + args).withWorkDirectory(dir.toFile())
        val out = CapturingProcessHandler(cmd).runProcess(30_000)
        assertEquals(0, out.exitCode, "git ${args.joinToString(" ")} failed: ${out.stderr}")
        return out.stdout
    }

    private fun delete(dir: Path) {
        if (!Files.exists(dir)) return
        Files.walk(dir).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }
}
