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

        api.remove(repo.toString(), created.path, created.branch)

        assertFalse(Files.exists(dir), "worktree directory should be removed")
        val after = api.list(repo.toString()).worktrees
        assertFalse(after.any { it.branch == "feature/x" }, "removed worktree should be gone")
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
