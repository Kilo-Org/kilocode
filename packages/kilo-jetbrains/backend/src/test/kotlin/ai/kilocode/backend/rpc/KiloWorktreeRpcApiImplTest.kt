package ai.kilocode.backend.rpc

import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
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

class KiloWorktreeRpcApiImplTest {
    private val repo: Path = Files.createTempDirectory("kilo-worktree")
    private val api = KiloWorktreeRpcApiImpl()

    @AfterTest
    fun tearDown() {
        delete(repo)
    }

    @Test
    fun `parseWorktreeList reads porcelain output and flags the main tree`() {
        val raw = """
            worktree /repo
            HEAD 1111111111111111111111111111111111111111
            branch refs/heads/main

            worktree /repo/.kilo/worktrees/feature-x
            HEAD 2222222222222222222222222222222222222222
            branch refs/heads/feature/x

        """.trimIndent()

        val list = parseWorktreeList(raw)

        assertEquals(2, list.size)
        assertEquals("/repo", list[0].path)
        assertEquals("main", list[0].branch)
        assertTrue(list[0].main)
        assertEquals("/repo/.kilo/worktrees/feature-x", list[1].path)
        assertEquals("feature-x", list[1].name)
        assertEquals("feature/x", list[1].branch)
        assertFalse(list[1].main)
    }

    @Test
    fun `parseWorktreeList captures the lock flag and reason`() {
        val raw = """
            worktree /repo
            HEAD 1111111111111111111111111111111111111111
            branch refs/heads/main

            worktree /repo/.kilo/worktrees/hyper-video
            HEAD 2222222222222222222222222222222222222222
            branch refs/heads/hyper-video
            locked Air Agent worktree

        """.trimIndent()

        val list = parseWorktreeList(raw)

        assertFalse(list[0].locked, "main tree is not locked")
        assertTrue(list[1].locked, "second tree should be flagged locked")
        assertEquals("Air Agent worktree", list[1].lockReason)
    }

    @Test
    fun `remove reports locked and force removes a locked worktree`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        git(repo, "worktree", "lock", "--reason", "held by test", created.path)

        // list should surface the lock so the UI can show it in advance.
        val locked = api.list(repo.toString()).worktrees.first { it.branch == "feature/x" }
        assertTrue(locked.locked, "locked worktree should be flagged in the list")
        assertEquals("held by test", locked.lockReason)

        // a plain remove is blocked and reports the lock.
        val blocked = api.remove(repo.toString(), created.path, created.branch, force = false)
        assertFalse(blocked.ok)
        assertTrue(blocked.locked, "blocked removal should report locked=true: ${blocked.error}")
        assertTrue(Files.exists(Path.of(created.path)), "locked worktree must survive a non-force remove")

        // force unlocks then removes.
        val forced = api.remove(repo.toString(), created.path, created.branch, force = true)
        assertTrue(forced.ok, "force remove should succeed: ${forced.error}")
        assertFalse(Files.exists(Path.of(created.path)), "force remove should delete the worktree")
    }

    @Test
    fun `create adds a worktree that list reports and remove deletes it`() = runBlocking {
        initRepo()

        val result = api.create(repo.toString(), CreateWorktreeRequestDto("feature/x"))
        val created = assertNotNull(result.worktree, "create failed: ${result.error}")
        assertNull(result.error)

        val dir = Path.of(created.path)
        assertTrue(Files.isDirectory(dir), "worktree directory should exist")
        assertEquals("feature/x", created.branch)

        val listed = api.list(repo.toString()).worktrees
        assertTrue(listed.any { it.branch == "feature/x" }, "list should contain the new worktree")
        assertTrue(listed.any { it.main }, "list should include the main working tree")

        val removed = api.remove(repo.toString(), created.path, created.branch)
        assertTrue(removed.ok, "remove should report success: ${removed.error}")
        assertNull(removed.error)

        assertFalse(Files.exists(dir), "worktree directory should be removed")
        val after = api.list(repo.toString()).worktrees
        assertFalse(after.any { it.branch == "feature/x" }, "removed worktree should be gone")
    }

    @Test
    fun `remove reports failure when git cannot remove the worktree`() = runBlocking {
        initRepo()

        val result = api.remove(repo.toString(), repo.resolve("does-not-exist").toString(), null)

        assertFalse(result.ok, "remove of a missing worktree should not report success")
        assertNotNull(result.error, "failure should carry an error message")
    }

    @Test
    fun `listBranches returns local branches and the current one`() = runBlocking {
        initRepo()
        git(repo, "branch", "feature/x")

        val result = api.listBranches(repo.toString())

        assertTrue(result.branches.contains("feature/x"), "should list feature/x: ${result.branches}")
        assertNotNull(result.current, "current branch should be reported")
        assertTrue(result.branches.contains(result.current), "current should be among branches")
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

    private fun delete(dir: Path) {
        if (!Files.exists(dir)) return
        Files.walk(dir).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }
}
