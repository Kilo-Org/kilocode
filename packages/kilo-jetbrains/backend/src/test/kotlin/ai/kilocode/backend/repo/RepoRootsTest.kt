package ai.kilocode.backend.repo

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Real git repositories in temp dirs — no mocks. [RepoRoots] shells out to `git`, so anything less
 * would test the mock rather than the resolution.
 */
class RepoRootsTest {
    private val base: Path = Files.createTempDirectory("kilo-repo-roots")

    @AfterTest
    fun tearDown() {
        delete(base)
    }

    @Test
    fun `a subdirectory resolves to the repository root`() {
        val repo = initRepo("repo")
        val sub = Files.createDirectories(repo.resolve("packages/app/src"))
        assertEquals(repo.toRealPath(), RepoRoots.resolve(sub))
    }

    @Test
    fun `a linked worktree resolves to the main root, not itself`() {
        val repo = initRepo("repo")
        val worktree = base.resolve("wt")
        git(repo, "worktree", "add", "-b", "feature", worktree.toString())
        val nested = Files.createDirectories(worktree.resolve("nested"))

        assertEquals(repo.toRealPath(), RepoRoots.resolve(worktree), "a worktree must not read as a second repo")
        assertEquals(repo.toRealPath(), RepoRoots.resolve(nested))
    }

    @Test
    fun `a repository nested inside another resolves to itself`() {
        val parent = initRepo("parent")
        val inner = initRepo("parent/vendor/inner")

        assertEquals(parent.toRealPath(), RepoRoots.resolve(parent))
        assertEquals(inner.toRealPath(), RepoRoots.resolve(inner), "a nested repo is its own root, not the outer one")
    }

    @Test
    fun `a directory that is not a git repository resolves to null`() {
        val plain = Files.createDirectories(base.resolve("plain"))
        assertNull(RepoRoots.resolve(plain))
    }

    @Test
    fun `a missing directory resolves to null`() {
        assertNull(RepoRoots.resolve(base.resolve("gone")))
    }

    @Test
    fun `id is stable across calls and differs between roots`() {
        val first = Files.createDirectories(base.resolve("a")).toRealPath()
        val second = Files.createDirectories(base.resolve("b")).toRealPath()
        assertEquals(RepoRoots.id(first), RepoRoots.id(first))
        assertTrue(RepoRoots.id(first) != RepoRoots.id(second))
        assertTrue(RepoRoots.id(first).length == 16)
    }

    @Test
    fun `invalidate clears a cached negative answer`() {
        val dir = Files.createDirectories(base.resolve("becomes-a-repo"))
        assertNull(RepoRoots.resolve(dir))
        initRepo("becomes-a-repo")
        RepoRoots.invalidate()
        assertEquals(dir.toRealPath(), RepoRoots.resolve(dir))
    }

    private fun initRepo(name: String): Path {
        val dir = Files.createDirectories(base.resolve(name))
        git(dir, "init")
        git(dir, "config", "user.email", "test@kilo.ai")
        git(dir, "config", "user.name", "Kilo Test")
        Files.writeString(dir.resolve("README.md"), "hello")
        git(dir, "add", "README.md")
        git(dir, "commit", "-m", "init")
        return dir
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
