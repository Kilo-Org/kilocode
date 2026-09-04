package ai.kilocode.backend.rpc

import ai.kilocode.backend.diff.GitComparison
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BranchLocalDiffTest {
    private val root = Files.createTempDirectory("kilo-branch-local-diff").toRealPath()
    private val repo = Files.createDirectory(root.resolve("repo"))
    private val config = Files.createFile(root.resolve("empty.config"))
    private val hooks = Files.createDirectory(root.resolve("hooks"))
    private val api = KiloWorkspaceRpcApiImpl()
    private val trees = KiloWorktreeRpcApiImpl()
    private val timeout = 30_000

    @AfterTest
    fun tearDown() {
        Files.walk(root).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }

    @Test
    fun `mixed committed and net local changes match their summaries and patches`() = runBlocking {
        init()
        val dir = worktree()
        Files.writeString(dir.resolve("tracked.txt"), "one\ncommitted\nthree\n")
        Files.writeString(dir.resolve("committed.txt"), "committed only\n")
        git(dir, "rm", "deleted.txt")
        commit(dir)
        Files.writeString(dir.resolve("tracked.txt"), "one\nstaged\nthree\n")
        Files.writeString(dir.resolve("staged.txt"), "index\n")
        Files.writeString(dir.resolve("net.txt"), "temporary\n")
        git(dir, "add", "tracked.txt", "staged.txt", "net.txt")
        Files.writeString(dir.resolve("tracked.txt"), "one\nunstaged\nthree\nextra\n")
        Files.writeString(dir.resolve("staged.txt"), "index\nworktree\n")
        Files.writeString(dir.resolve("net.txt"), "same\n")
        Files.delete(dir.resolve("committed.txt"))
        Files.writeString(dir.resolve("untracked.txt"), "untracked\nlast")
        Files.writeString(dir.resolve("ignored.txt"), "ignored\n")
        val status = git(dir, "status", "--porcelain", "-z")

        val (base, local) = parity(dir)

        assertEquals(setOf("tracked.txt", "committed.txt", "deleted.txt"), base.map { it.file }.toSet())
        assertEquals(2, base.sumOf { it.additions })
        assertEquals(2, base.sumOf { it.deletions })
        assertEquals(setOf("tracked.txt", "committed.txt", "staged.txt", "untracked.txt"), local.map { it.file }.toSet())
        assertEquals(6, local.sumOf { it.additions })
        assertEquals(2, local.sumOf { it.deletions })
        val patch = base.single { it.file == "tracked.txt" }.patch.orEmpty()
        assertTrue(patch.contains(" one\n") && patch.contains("+committed\n") && patch.contains(" three\n"), patch)
        assertFalse(patch.contains("staged"), patch)
        assertEquals(status, git(dir, "status", "--porcelain", "-z"))
    }

    @Test
    fun `fully pushed branch keeps base changes and retains unpushed metadata separately`() = runBlocking {
        init()
        val origin = Files.createDirectory(root.resolve("origin"))
        git(origin, "init", "--bare", "--initial-branch=main")
        git(repo, "remote", "add", "origin", origin.toString())
        git(repo, "push", "-u", "origin", "main")
        git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
        val dir = worktree()
        Files.writeString(dir.resolve("feature.txt"), "one\n")
        commit(dir)
        git(dir, "push", "-u", "origin", "feature")

        assertEquals(listOf("feature.txt"), parity(dir).first.map { it.file })
        assertEquals(0, unpushed(dir))
        Files.writeString(dir.resolve("feature.txt"), "one\ntwo\n")
        commit(dir)
        assertEquals(2, parity(dir).first.single().additions)
        assertEquals(1, unpushed(dir))
    }

    @Test
    fun `diverged base reports ahead and behind in the correct direction`() = runBlocking {
        init()
        val dir = worktree()
        Files.writeString(dir.resolve("feature.txt"), "feature\n")
        commit(dir)
        Files.writeString(repo.resolve("main.txt"), "main one\n")
        commit(repo)
        Files.writeString(repo.resolve("main.txt"), "main one\nmain two\n")
        commit(repo)

        assertEquals(listOf("feature.txt"), parity(dir).first.map { it.file })
        val stats = trees.stats(repo.toString()).items.single()
        assertEquals(1, stats.ahead)
        assertEquals(2, stats.behind)
        assertEquals("main", stats.base)
    }

    @Test
    fun `subdirectory comparisons stay relative and exclude changes outside their scope`() = runBlocking {
        init()
        Files.createDirectories(repo.resolve("module"))
        Files.writeString(repo.resolve("module/old name[1].txt"), "rename contents\n")
        commit(repo)
        val dir = worktree()
        git(dir, "mv", "module/old name[1].txt", "module/new name[2].txt")
        Files.writeString(dir.resolve("outside.txt"), "outside\n")
        commit(dir)
        Files.writeString(dir.resolve("module/new name[2].txt"), "rename contents\nlocal\n")
        Files.writeString(dir.resolve("module/untracked.txt"), "untracked\n")
        Files.writeString(dir.resolve("outside.txt"), "outside\nlocal\n")
        Files.writeString(dir.resolve("untracked.txt"), "outside untracked\n")

        val (base, local) = parity(dir)
        val subdir = dir.resolve("module").toString()
        val committed = api.branchDiff(subdir, true)
        val working = api.localDiff(subdir, true)
        assertEquals(base.filter { it.file.startsWith("module/") }.map { it.copy(file = it.file.removePrefix("module/"), patch = "") }, committed.map { it.copy(patch = "") })
        assertEquals(local.filter { it.file.startsWith("module/") }.map { it.copy(file = it.file.removePrefix("module/"), patch = "") }, working.map { it.copy(patch = "") })
        assertEquals("rename contents\n", committed.single().before)
        assertEquals("rename contents\n", committed.single().after)
        assertTrue(committed.single().patch.orEmpty().contains("rename from old name[1].txt"))
        assertEquals(setOf("new name[2].txt", "untracked.txt"), working.map { it.file }.toSet())
    }

    @Test
    fun `rename binary and empty files remain counted in both comparisons`() = runBlocking {
        init()
        val dir = worktree()
        git(dir, "mv", "rename.txt", "renamed.txt")
        Files.write(dir.resolve("binary.bin"), byteArrayOf(0, 1, 2))
        Files.writeString(dir.resolve("empty.txt"), "")
        commit(dir)
        git(dir, "mv", "local.txt", "local-renamed.txt")
        Files.write(dir.resolve("binary.bin"), byteArrayOf(0, 3, 4))
        Files.writeString(dir.resolve("local-empty.txt"), "")
        Files.write(dir.resolve("untracked.bin"), byteArrayOf(0, 5))
        Files.writeString(dir.resolve("renamed.txt"), "local drift\n")

        val (base, local) = parity(dir)

        assertEquals(3, base.size)
        assertEquals(0, base.sumOf { it.additions + it.deletions })
        val renamed = base.single { it.file == "renamed.txt" }
        assertEquals("renamed", renamed.status)
        assertEquals("rename contents\n", renamed.before)
        assertEquals("rename contents\n", renamed.after)
        assertTrue(renamed.patch.orEmpty().contains("rename from rename.txt"))
        val moved = local.single { it.file == "local-renamed.txt" }
        assertEquals("renamed", moved.status)
        assertEquals(0, moved.additions + moved.deletions)
        assertEquals("local contents\n", moved.before)
        assertEquals("local contents\n", moved.after)
        assertEquals(5, local.size)
        assertNull(base.single { it.file == "binary.bin" }.before)
        assertTrue(local.single { it.file == "untracked.bin" }.patch.isNullOrEmpty())
        assertEquals("", base.single { it.file == "empty.txt" }.after)
    }

    @Test
    fun `committed full context and renamed contents survive working file modifications and deletions`() = runBlocking {
        init()
        val text = (1..30).joinToString("\n", postfix = "\n") { "context $it" }
        Files.writeString(repo.resolve("edited.txt"), text)
        Files.writeString(repo.resolve("removed.txt"), text)
        commit(repo)
        val dir = worktree()
        val committed = text.replace("context 15", "committed line")
        Files.writeString(dir.resolve("edited.txt"), committed)
        Files.writeString(dir.resolve("removed.txt"), committed)
        git(dir, "mv", "rename.txt", "renamed.txt")
        commit(dir)
        Files.writeString(dir.resolve("edited.txt"), "DRIFTED\n")
        Files.delete(dir.resolve("removed.txt"))
        Files.delete(dir.resolve("renamed.txt"))

        val base = parity(dir).first

        for (name in listOf("edited.txt", "removed.txt")) {
            val patch = base.single { it.file == name }.patch.orEmpty()
            assertTrue(patch.contains(" context 1\n"), patch)
            assertTrue(patch.contains(" context 30\n"), patch)
            assertTrue(patch.contains("-context 15\n+committed line\n"), patch)
            assertFalse(patch.contains("DRIFTED"), patch)
        }
        val renamed = base.single { it.file == "renamed.txt" }
        assertEquals("rename contents\n", renamed.before)
        assertEquals("rename contents\n", renamed.after)
    }

    @Test
    fun `default selection follows declared origin remote local and primary fallbacks without caching`() = runBlocking {
        init()
        git(repo, "branch", "-m", "trunk")
        val dir = worktree()
        val refs = listOf("refs/remotes/origin/develop", "refs/remotes/origin/main", "refs/remotes/origin/master", "refs/heads/main", "refs/heads/master")
        refs.forEach { git(repo, "update-ref", it, "HEAD") }
        git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", refs.first())
        Files.writeString(dir.resolve("feature.txt"), "feature\n")
        commit(dir)
        git(dir, "tag", "main")
        git(dir, "tag", "master")
        git(dir, "branch", "shadow")
        git(dir, "branch", "--set-upstream-to=shadow", "feature")

        for (ref in refs) {
            assertEquals(listOf("feature.txt"), parity(dir).first.map { it.file })
            assertEquals(ref.removePrefix("refs/remotes/").removePrefix("refs/heads/"), trees.stats(repo.toString()).items.single().base)
            git(repo, "update-ref", "-d", ref)
        }
        assertEquals(listOf("feature.txt"), parity(dir).first.map { it.file })
        assertEquals("trunk", trees.stats(repo.toString()).items.single().base)
        git(repo, "checkout", "--detach")
        assertTrue(parity(dir).first.isEmpty())
        assertEquals("HEAD", trees.stats(repo.toString()).items.single().base)
    }

    @Test
    fun `unrelated base falls back to its committed tip without mixing local changes`() = runBlocking {
        init()
        val dir = worktree()
        Files.writeString(dir.resolve("feature.txt"), "feature\n")
        commit(dir)
        git(repo, "checkout", "--orphan", "isolated")
        git(repo, "rm", "-rf", ".")
        Files.writeString(repo.resolve("unrelated.txt"), "unrelated\n")
        git(repo, "add", "unrelated.txt")
        git(repo, "commit", "-m", "unrelated")
        git(repo, "branch", "-f", "main", "HEAD")
        Files.writeString(dir.resolve("feature.txt"), "local drift\n")
        Files.writeString(dir.resolve("untracked.txt"), "untracked\n")

        val base = parity(dir).first

        assertEquals("deleted", base.single { it.file == "unrelated.txt" }.status)
        assertTrue(base.single { it.file == "feature.txt" }.patch.orEmpty().contains("+feature\n"))
        assertFalse(base.any { it.file == "untracked.txt" })
        assertEquals("main", trees.stats(repo.toString()).items.single().base)
    }

    @Test
    fun `comparison freezes both committed revisions and local HEAD before loading files`() {
        init()
        val dir = worktree()
        Files.writeString(dir.resolve("feature.txt"), "first\n")
        commit(dir)
        val base = assertNotNull(GitComparison.open(dir, GitComparison.Mode.Base))
        val local = assertNotNull(GitComparison.open(dir, GitComparison.Mode.Local))
        Files.writeString(dir.resolve("feature.txt"), "second\n")
        commit(dir)
        git(repo, "update-ref", "refs/heads/main", git(dir, "rev-parse", "HEAD").trim())

        assertEquals(0 to 1, base.counts())
        assertTrue(base.files(true).single().patch.orEmpty().contains("+first\n"))
        assertEquals(1, local.files(false).single().additions)
        assertTrue(local.files(true).single().patch.orEmpty().contains("-first\n+second\n"))
        assertTrue(assertNotNull(GitComparison.open(dir, GitComparison.Mode.Base)).files(true).isEmpty())
    }

    @Test
    fun `large renamed contents and untracked guards retain stats while limiting payloads`() = runBlocking {
        init()
        Files.writeString(repo.resolve("large.txt"), "line\n".repeat(900_000))
        commit(repo)
        val dir = worktree()
        git(dir, "mv", "large.txt", "a-large.txt")
        Files.writeString(dir.resolve("z-small.txt"), "small\n")
        commit(dir)
        Files.writeString(dir.resolve("oversized.txt"), "x".repeat(2 * 1024 * 1024 + 1))
        Files.write(dir.resolve("untracked.bin"), byteArrayOf(1, 0, 2))
        Files.writeString(dir.resolve("untracked-empty.txt"), "")
        Files.writeString(dir.resolve("untracked-text.txt"), "one\ntwo")

        val (base, local) = parity(dir)

        val large = base.single { it.file == "a-large.txt" }
        assertEquals(0, large.additions + large.deletions)
        assertTrue(large.patch.isNullOrEmpty())
        assertNull(large.before)
        assertNull(large.after)
        assertTrue(base.single { it.file == "z-small.txt" }.patch.orEmpty().contains("+small"))
        assertEquals(4, local.size)
        assertEquals(2, local.sumOf { it.additions })
        assertTrue(local.single { it.file == "oversized.txt" }.patch.isNullOrEmpty())
        assertTrue((base + local).sumOf { it.patch.orEmpty().length + it.before.orEmpty().length + it.after.orEmpty().length } < 8 * 1024 * 1024)
    }

    @Test
    fun `bulk stats and dirty retain managed-only scope`() = runBlocking {
        init()
        val dir = worktree()
        val outside = root.resolve("outside")
        git(repo, "worktree", "add", "-b", "outside", outside.toString())
        Files.writeString(repo.resolve("primary.txt"), "primary\n")
        Files.writeString(outside.resolve("outside.txt"), "outside\n")
        Files.writeString(dir.resolve("managed.txt"), "managed\n")

        // The primary checkout holds the branch the worktrees are compared against, so it has no base
        // stats of its own but does have uncommitted counts, which its session editor tab reports. A
        // worktree nobody manages stays out of both.
        assertEquals(listOf(dir.toString()), trees.stats(outside.toString()).items.map { it.path })
        assertEquals(listOf(repo.toString(), dir.toString()), trees.dirty(outside.toString()).items.map { it.path })
        assertEquals(1, trees.dirty(outside.toString()).items.single { it.path == repo.toString() }.untracked)
        assertEquals(listOf("managed.txt"), parity(dir).second.map { it.file })
        assertEquals(listOf("outside.txt"), api.localDiff(outside.toString(), false).map { it.file })
    }

    @Test
    fun `clean missing nonGit and noHEAD comparisons are empty`() = runBlocking {
        for (dir in listOf(repo, repo.resolve("missing"))) {
            assertTrue(api.branchDiff(dir.toString(), true).isEmpty())
            assertTrue(api.localDiff(dir.toString(), true).isEmpty())
        }
        git(repo, "init", "--initial-branch=main")
        Files.writeString(repo.resolve("untracked.txt"), "unborn\n")
        assertTrue(api.branchDiff(repo.toString(), true).isEmpty())
        assertTrue(api.localDiff(repo.toString(), true).isEmpty())
        Files.delete(repo.resolve("untracked.txt"))
        init()
        val dir = worktree()
        val (base, local) = parity(dir)
        assertTrue(base.isEmpty())
        assertTrue(local.isEmpty())
    }

    @Test
    fun `unexpected Git comparison failures propagate instead of appearing clean`() = runBlocking {
        init()
        val dir = worktree()
        git(repo, "config", "diff.algorithm", "invalid-algorithm")

        assertFailsWith<IllegalStateException> { api.branchDiff(dir.toString(), false) }
        assertFailsWith<IllegalStateException> { api.localDiff(dir.toString(), true) }
        assertFailsWith<IllegalStateException> { trees.stats(repo.toString()) }
        assertFailsWith<IllegalStateException> { trees.dirty(repo.toString()) }
    }

    private suspend fun parity(dir: Path): Pair<List<DiffFileDto>, List<DiffFileDto>> {
        val base = api.branchDiff(dir.toString(), true)
        val local = api.localDiff(dir.toString(), true)
        assertEquals(api.branchDiff(dir.toString(), false), base.map { it.copy(patch = "", before = null, after = null) })
        assertEquals(api.localDiff(dir.toString(), false), local.map { it.copy(patch = "", before = null, after = null) })
        val stats = trees.stats(repo.toString()).items.single { it.path == dir.toString() }
        val dirty = trees.dirty(repo.toString()).items.single { it.path == dir.toString() }
        assertEquals(base.size, stats.files)
        assertEquals(base.sumOf { it.additions }, stats.additions)
        assertEquals(base.sumOf { it.deletions }, stats.deletions)
        assertEquals(local.size, dirty.files)
        assertEquals(local.sumOf { it.additions }, dirty.additions)
        assertEquals(local.sumOf { it.deletions }, dirty.deletions)
        assertEquals(local.count { it.status == "untracked" }, dirty.untracked)
        return base to local
    }

    private fun init() {
        git(repo, "init", "--initial-branch=main")
        git(repo, "config", "user.email", "test@kilo.ai")
        git(repo, "config", "user.name", "Kilo Test")
        git(repo, "config", "core.autocrlf", "false")
        Files.writeString(repo.resolve(".gitignore"), ".kilo/\nignored.txt\n")
        Files.writeString(repo.resolve("tracked.txt"), "one\ntwo\nthree\n")
        Files.writeString(repo.resolve("deleted.txt"), "remove\n")
        Files.writeString(repo.resolve("rename.txt"), "rename contents\n")
        Files.writeString(repo.resolve("local.txt"), "local contents\n")
        Files.writeString(repo.resolve("net.txt"), "same\n")
        commit(repo)
    }

    private suspend fun unpushed(dir: Path): Int =
        trees.dirty(repo.toString()).items.single { it.path == dir.toString() }.unpushed

    private fun worktree(): Path {
        val dir = repo.resolve(".kilo/worktrees/feature")
        git(repo, "worktree", "add", "-b", "feature", dir.toString())
        return dir.toRealPath()
    }

    private fun commit(dir: Path) {
        git(dir, "add", "-A")
        git(dir, "commit", "-m", "fixture")
    }

    private fun git(dir: Path, vararg args: String): String {
        val cmd = GeneralCommandLine(listOf("git", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=$hooks") + args)
            .withWorkDirectory(dir.toFile())
            .withEnvironment("GIT_CONFIG_NOSYSTEM", "1")
            .withEnvironment("GIT_CONFIG_GLOBAL", config.toString())
            .withEnvironment("GIT_AUTHOR_DATE", "2026-01-01T00:00:00Z")
            .withEnvironment("GIT_COMMITTER_DATE", "2026-01-01T00:00:00Z")
        val out = CapturingProcessHandler(cmd).runProcess(timeout)
        assertFalse(out.isTimeout, "git ${args.joinToString(" ")} timed out: ${out.stderr}")
        assertEquals(0, out.exitCode, "git ${args.joinToString(" ")} failed: ${out.stderr}")
        return out.stdout
    }
}
