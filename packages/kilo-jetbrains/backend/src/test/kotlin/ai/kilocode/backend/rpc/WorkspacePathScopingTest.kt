package ai.kilocode.backend.rpc

import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WorkspacePathScopingTest {
    // Derive an absolute, OS-portable base from the real home dir so the test runs identically on
    // Windows, macOS, and Linux (no hardcoded POSIX "/home/..." literals).
    private val base: Path = Path.of(System.getProperty("user.home")).resolve("kilo-scope-test").normalize()

    private fun at(vararg segments: String): Path = segments.fold(base) { acc, s -> acc.resolve(s) }

    @Test
    fun `in-base file returns forward-slash relative path`() {
        assertEquals("src/A.kt", relativeWithinBase(base, at("src", "A.kt")))
    }

    @Test
    fun `nested file returns nested relative path`() {
        assertEquals("a/b/c.kt", relativeWithinBase(base, at("a", "b", "c.kt")))
    }

    @Test
    fun `base itself is rejected as blank`() {
        assertNull(relativeWithinBase(base, base))
    }

    @Test
    fun `sibling directory outside base is rejected`() {
        assertNull(relativeWithinBase(base, base.resolveSibling("other").resolve("A.kt")))
    }

    @Test
    fun `parent directory is rejected`() {
        assertNull(relativeWithinBase(base, base.parent))
    }

    @Test
    fun `traversal that escapes base is rejected after normalization`() {
        assertNull(relativeWithinBase(base, base.resolve("..").resolve("secret").resolve("A.kt")))
    }

    @Test
    fun `traversal that stays inside base is kept after normalization`() {
        assertEquals("src/A.kt", relativeWithinBase(base, base.resolve("x").resolve("..").resolve("src").resolve("A.kt")))
    }

    @Test
    fun `prefix sibling is not treated as inside base`() {
        val sibling = base.resolveSibling(base.fileName.toString() + "-2")
        assertNull(relativeWithinBase(base, sibling.resolve("A.kt")))
    }

    @Test
    fun `workspace scope keeps normal project and kilo plan files`() {
        assertEquals("backend/src/Main.java", relativeWithinWorkspace(base, at("backend", "src", "Main.java")))
        assertEquals(".kilo/plans/x.md", relativeWithinWorkspace(base, at(".kilo", "plans", "x.md")))
    }

    @Test
    fun `workspace scope rejects managed worktree storage from main checkout`() {
        assertNull(relativeWithinWorkspace(base, at(".kilo", "worktrees")))
        assertNull(relativeWithinWorkspace(base, at(".kilo", "worktrees", "foo", "backend", "src", "Main.java")))
    }

    @Test
    fun `workspace scope allows files inside the active worktree`() {
        val root = at(".kilo", "worktrees", "foo")

        assertEquals("backend/src/Main.java", relativeWithinWorkspace(root, root.resolve("backend/src/Main.java")))
    }

    @Test
    fun `workspace scope rejects sibling worktrees from active worktree`() {
        val root = at(".kilo", "worktrees", "foo")
        val sibling = at(".kilo", "worktrees", "bar", "backend", "src", "Main.java")

        assertNull(relativeWithinWorkspace(root, sibling))
    }

    @Test
    fun `workspace scope rejects nested managed worktree storage`() {
        val root = at(".kilo", "worktrees", "foo")

        assertNull(relativeWithinWorkspace(root, root.resolve(".kilo/worktrees/bar/backend/src/Main.java")))
    }

    @Test
    fun `normalizes encoded file URLs`() {
        val path = base.resolve("dir with spaces").resolve("A.kt")
        val url = path.toUri().toString() + "?query#fragment"

        assertEquals(path.normalize().toString(), normalizeWorkspacePath(url))
    }

    @Test
    fun `normalizes escaped relative paths`() {
        assertEquals("src/A.kt", normalizeWorkspacePath("src%2Ftmp%2F..%2FA.kt"))
    }

    @Test
    fun `rejects blank and invalid paths`() {
        assertNull(normalizeWorkspacePath("   "))
        assertNull(normalizeWorkspacePath("file://%"))
    }

    @Test
    fun `project directory hint matches second open project`() {
        assertEquals(
            "/repo/wt-b",
            resolveProjectDirectoryHint("/repo/wt-b", listOf("/repo/wt-a", "/repo/wt-b")),
        )
    }

    @Test
    fun `unmatched project directory hint is preserved`() {
        assertEquals(
            "/repo/wt-c",
            resolveProjectDirectoryHint("/repo/wt-c", listOf("/repo/wt-a", "/repo/wt-b")),
        )
    }

    @Test
    fun `blank project directory hint falls back to first project`() {
        assertEquals("/repo/wt-a", resolveProjectDirectoryHint("", listOf("/repo/wt-a", "/repo/wt-b")))
    }

    @Test
    fun `blank project directory hint without projects stays blank`() {
        assertEquals("", resolveProjectDirectoryHint("", emptyList()))
    }

    @Test
    fun `project directory hint comparison normalizes paths`() {
        assertEquals(
            "/repo/wt-b",
            resolveProjectDirectoryHint("/repo/wt-b/./", listOf("/repo/wt-a", "/repo/wt-b")),
        )
    }

    @Test
    fun `git availability detects temp repository`() {
        val dir = repo() ?: return
        try {
            assertTrue(workspaceGitAvailable(dir))
        } finally {
            delete(dir)
        }
    }

    @Test
    fun `git changes returns capped large diff without blocking`() = runBlocking {
        val dir = repo() ?: return@runBlocking
        try {
            val file = dir.resolve("large.txt")
            file.writeText("base\n")
            git(dir, "add", "large.txt")
            git(dir, "commit", "-m", "base")
            file.writeText((1..40_000).joinToString("\n") { "line-$it" } + "\n")

            val diff = assertNotNull(KiloWorkspaceRpcApiImpl().gitChanges(dir.toString()))
            assertTrue(diff.startsWith("diff --git"))
            assertEquals(200_000, diff.length)
        } finally {
            delete(dir)
        }
    }

    @Test
    fun `git changes returns null outside git repositories`() = runBlocking {
        val dir = Files.createTempDirectory("kilo-non-git")
        try {
            assertNull(KiloWorkspaceRpcApiImpl().gitChanges(dir.toString()))
        } finally {
            delete(dir)
        }
    }

    private fun repo(): Path? {
        if (!gitInstalled()) return null
        val dir = Files.createTempDirectory("kilo-git")
        git(dir, "init")
        git(dir, "config", "user.email", "test@example.com")
        git(dir, "config", "user.name", "Test User")
        return dir
    }

    private fun gitInstalled(): Boolean {
        return try {
            ProcessBuilder("git", "--version").start().waitFor() == 0
        } catch (_: Exception) {
            false
        }
    }

    private fun git(dir: Path, vararg args: String) {
        val proc = ProcessBuilder(listOf("git") + args)
            .directory(dir.toFile())
            .redirectErrorStream(true)
            .start()
        val out = proc.inputStream.bufferedReader().readText()
        val code = proc.waitFor()
        assertEquals(0, code, out)
    }

    private fun delete(dir: Path) {
        Files.walk(dir).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }
}
