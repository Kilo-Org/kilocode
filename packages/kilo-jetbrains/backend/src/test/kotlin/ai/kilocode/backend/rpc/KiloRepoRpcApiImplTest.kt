package ai.kilocode.backend.rpc

import ai.kilocode.rpc.dto.RepoSource
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Real git repositories and a directly constructed [WorktreeStateStore]. No IDE project is open in unit
 * tests, so inference degrades to an empty result and the pinned/added paths are exercised on their own —
 * which is exactly what [ai.kilocode.backend.repo.RepoInferenceTest] does not cover.
 */
class KiloRepoRpcApiImplTest {
    private val base: Path = Files.createTempDirectory("kilo-repo-rpc")
    private val states = WorktreeStateStore()
    private val api = KiloRepoRpcApiImpl(states)

    private lateinit var ws: Path
    private lateinit var first: Path
    private lateinit var second: Path

    @BeforeTest
    fun setUp() {
        ws = initRepo("ws")
        first = initRepo("first")
        second = initRepo("second")
    }

    @AfterTest
    fun tearDown() {
        delete(base)
    }

    @Test
    fun `add rejects a path that is not a directory`() = runBlocking {
        assertEquals("Not a directory.", api.add(ws.toString(), base.resolve("missing").toString()).error)
    }

    @Test
    fun `add rejects a directory that is not a git repository`() = runBlocking {
        val plain = Files.createDirectories(base.resolve("plain"))
        assertEquals("Not a git repository.", api.add(ws.toString(), plain.toString()).error)
    }

    @Test
    fun `add rejects the pinned project itself`() = runBlocking {
        assertEquals("That repository is already the current project.", api.add(ws.toString(), ws.toString()).error)
    }

    @Test
    fun `add rejects a managed worktree`() = runBlocking {
        val managed = initRepo("ws/.kilo/worktrees/feature")
        assertEquals("Managed worktrees cannot be added as projects.", api.add(ws.toString(), managed.toString()).error)
    }

    @Test
    fun `add registers a repo and returns it`() = runBlocking {
        val result = api.add(ws.toString(), first.toString(), "First")
        val repo = assertNotNull(result.repo, "add failed: ${result.error}")
        assertEquals(RepoSource.ADDED, repo.source)
        assertEquals("First", repo.label)
        assertEquals(first.toRealPath().toString(), repo.root)
        assertNull(result.error)
    }

    @Test
    fun `adding a linked worktree of an added repo returns the existing entry, not a duplicate`() = runBlocking {
        api.add(ws.toString(), first.toString())
        val worktree = base.resolve("first-wt")
        git(first, "worktree", "add", "-b", "feature", worktree.toString())

        val result = api.add(ws.toString(), worktree.toString())

        assertEquals(first.toRealPath().toString(), assertNotNull(result.repo).root, "a worktree resolves to its main repo")
        assertEquals(1, readWorktreeState(worktreeStateFile(ws.toRealPath())).repos.size)
    }

    @Test
    fun `list orders the pinned project first, then added repos in insertion order`() = runBlocking {
        api.add(ws.toString(), first.toString())
        api.add(ws.toString(), second.toString())

        val repos = api.list(null, ws.toString()).repos

        assertEquals(listOf(RepoSource.PINNED, RepoSource.ADDED, RepoSource.ADDED), repos.map { it.source })
        assertEquals(ws.toRealPath().toString(), repos.first().root)
        assertEquals(listOf(first.toRealPath().toString(), second.toRealPath().toString()), repos.drop(1).map { it.root })
    }

    @Test
    fun `remove forgets an added repo`() = runBlocking {
        val repo = assertNotNull(api.add(ws.toString(), first.toString()).repo)
        val after = api.remove(null, ws.toString(), repo.id)
        assertTrue(after.repos.none { it.root == repo.root }, "the removed repo must be gone from the list")
        assertTrue(after.repos.any { it.source == RepoSource.PINNED })
    }

    @Test
    fun `remove of the pinned project is ignored`() = runBlocking {
        val pinned = api.list(null, ws.toString()).repos.first()
        val after = api.remove(null, ws.toString(), pinned.id)
        assertEquals(1, after.repos.size)
        assertEquals(RepoSource.PINNED, after.repos.single().source)
    }

    @Test
    fun `resolve returns the main root for a worktree path`() = runBlocking {
        val worktree = base.resolve("resolve-wt")
        git(first, "worktree", "add", "-b", "feature", worktree.toString())
        assertEquals(first.toRealPath().toString(), api.resolve(worktree.toString()))
    }

    @Test
    fun `resolve returns null for a non-repository`() = runBlocking {
        assertNull(api.resolve(base.resolve("plain").toString()))
    }

    @Test
    fun `nested inference is off by default`() = runBlocking {
        assertFalse(api.includeNested())
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
