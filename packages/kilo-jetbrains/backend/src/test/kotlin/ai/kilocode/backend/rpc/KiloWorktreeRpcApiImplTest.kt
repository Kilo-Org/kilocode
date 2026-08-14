package ai.kilocode.backend.rpc

import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreeDto
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
    fun `open returns false when the directory does not exist`() = runBlocking {
        assertFalse(api.open(repo.resolve("missing").toString()))
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
    fun `managedWorktrees keeps only agent manager worktrees`() {
        val raw = """
            worktree /repo
            HEAD 1111111111111111111111111111111111111111
            branch refs/heads/main

            worktree /repo/.kilo/worktrees/feature-x
            HEAD 2222222222222222222222222222222222222222
            branch refs/heads/feature/x

            worktree /Users/kirillk/Library/Caches/JetBrains/Air/agents/air/task/repo
            HEAD 3333333333333333333333333333333333333333
            branch refs/heads/air/task

            worktree /repo/sibling
            HEAD 4444444444444444444444444444444444444444
            branch refs/heads/sibling

        """.trimIndent()

        val list = managedWorktrees(parseWorktreeList(raw))

        assertEquals(listOf("/repo", "/repo/.kilo/worktrees/feature-x"), list.map { it.path })
    }

    @Test
    fun `managedWorktrees rejects the storage root itself`() {
        val raw = """
            worktree /repo
            HEAD 1111111111111111111111111111111111111111
            branch refs/heads/main

            worktree /repo/.kilo/worktrees
            HEAD 2222222222222222222222222222222222222222
            branch refs/heads/bad

        """.trimIndent()

        val list = managedWorktrees(parseWorktreeList(raw))

        assertEquals(listOf("/repo"), list.map { it.path })
    }

    @Test
    fun `classifyGhError detects missing and unauthorized gh states`() {
        assertEquals(GhAvailability.UNAUTH, classifyGhError("You are not logged into any GitHub hosts. Run gh auth login to authenticate."))
        assertEquals(GhAvailability.UNAUTH, classifyGhError("authentication required"))
        assertEquals(GhAvailability.MISSING, classifyGhError("Cannot run program \"gh\": No such file or directory"))
        assertEquals(GhAvailability.MISSING, classifyGhError("gh: command not found"))
        assertEquals(GhAvailability.OK, classifyGhError("temporary network failure"))
    }

    @Test
    fun `overlayWorktreeNames applies labels only to non-main worktrees`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val child = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")

        val out = overlayWorktreeNames(listOf(main, child), mapOf(main.path to "Main Label", child.path to "Feature Label"))

        assertEquals("repo", out[0].name)
        assertEquals("Feature Label", out[1].name)
    }

    @Test
    fun `worktree names store round trips and tolerates missing or corrupt files`() {
        val file = repo.resolve(".kilo").resolve("worktree-names.json")

        assertTrue(readWorktreeNames(file).isEmpty())
        writeWorktreeNames(file, mapOf("/repo/.kilo/worktrees/feature-x" to "Feature Label", "/blank" to ""))

        assertEquals(mapOf("/repo/.kilo/worktrees/feature-x" to "Feature Label"), readWorktreeNames(file))
        assertEquals(emptyList(), readWorktreeState(file).worktreeOrder)

        Files.writeString(file, "not json")
        assertTrue(readWorktreeNames(file).isEmpty())
    }

    @Test
    fun `worktree state round trips and migrates legacy names`() {
        val file = repo.resolve(".kilo").resolve("worktree-names.json")
        val first = "/repo/.kilo/worktrees/zebra"
        val second = "/repo/.kilo/worktrees/alpha"

        writeWorktreeState(file, WorktreeState(mapOf(first to "Zebra", second to "Alpha"), listOf(first, second)))

        assertEquals(WorktreeState(mapOf(first to "Zebra", second to "Alpha"), listOf(first, second)), readWorktreeState(file))

        Files.writeString(file, """{"$second":"Alpha","$first":"Zebra","/blank":""}""")
        assertEquals(WorktreeState(mapOf(second to "Alpha", first to "Zebra"), listOf(second, first)), readWorktreeState(file))
    }

    @Test
    fun `orderWorktrees keeps main first and sorts worktrees by persisted order`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val first = WorktreeDto("/repo/.kilo/worktrees/zebra", "zebra", "zebra", "/repo/.kilo/worktrees/zebra")
        val second = WorktreeDto("/repo/.kilo/worktrees/alpha", "alpha", "alpha", "/repo/.kilo/worktrees/alpha")
        val third = WorktreeDto("/repo/.kilo/worktrees/beta", "beta", "beta", "/repo/.kilo/worktrees/beta")

        val out = orderWorktrees(listOf(main, second, third, first), listOf(first.path, second.path))

        assertEquals(listOf(main.path, first.path, second.path, third.path), out.map { it.path })
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
    fun `create records order so reload keeps creation order`() = runBlocking {
        initRepo()

        val first = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("zebra")).worktree)
        val second = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("alpha")).worktree)

        val listed = api.list(repo.toString()).worktrees.filter { !it.main }
        assertEquals(listOf(first.path, second.path), listed.map { it.path })
        assertEquals(listOf(first.path, second.path), readWorktreeState(repo.resolve(".kilo").resolve("worktree-names.json")).worktreeOrder)
    }

    @Test
    fun `remove prunes names and order from worktree state`() = runBlocking {
        initRepo()
        val first = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("zebra")).worktree)
        val second = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("alpha")).worktree)
        assertNotNull(api.rename(repo.toString(), first.path, "First").worktree)
        assertNotNull(api.rename(repo.toString(), second.path, "Second").worktree)

        val removed = api.remove(repo.toString(), first.path, first.branch)

        assertTrue(removed.ok, "remove should report success: ${removed.error}")
        val state = readWorktreeState(repo.resolve(".kilo").resolve("worktree-names.json"))
        assertEquals(mapOf(second.path to "Second"), state.names)
        assertEquals(listOf(second.path), state.worktreeOrder)
    }

    @Test
    fun `rename persists a custom worktree name and list overlays it`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)

        val renamed = api.rename(repo.toString(), created.path, "Feature Label")

        assertNull(renamed.error)
        assertEquals("Feature Label", assertNotNull(renamed.worktree).name)
        val listed = api.list(repo.toString()).worktrees.single { it.path == created.path }
        assertEquals("Feature Label", listed.name)
        assertEquals(mapOf(created.path to "Feature Label"), readWorktreeNames(repo.resolve(".kilo").resolve("worktree-names.json")))
    }

    @Test
    fun `adopt names a default worktree and list overlays the adopted name`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)

        val adopted = api.adopt(repo.toString(), created.path, "Fix login bug")

        assertNull(adopted.error)
        assertEquals("Fix login bug", assertNotNull(adopted.worktree).name)
        val listed = api.list(repo.toString()).worktrees.single { it.path == created.path }
        assertEquals("Fix login bug", listed.name)
        assertEquals(mapOf(created.path to "Fix login bug"), readWorktreeNames(repo.resolve(".kilo").resolve("worktree-names.json")))
    }

    @Test
    fun `adopt leaves a worktree that already has a custom name untouched`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        assertNotNull(api.rename(repo.toString(), created.path, "Chosen Name").worktree)

        val adopted = api.adopt(repo.toString(), created.path, "Agent Title")

        assertNull(adopted.error, "a skipped adopt is a no-op, not a failure")
        assertNull(adopted.worktree, "a worktree with a custom name should not be adopted")
        val listed = api.list(repo.toString()).worktrees.single { it.path == created.path }
        assertEquals("Chosen Name", listed.name, "the user's name must be preserved")
    }

    @Test
    fun `adopt works when addressed from within the worktree directory`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)

        // The session editor only knows the worktree path, so it passes that as both directory and path.
        val adopted = api.adopt(created.path, created.path, "Fix login bug")

        assertNull(adopted.error)
        assertEquals("Fix login bug", assertNotNull(adopted.worktree).name)
        val listed = api.list(repo.toString()).worktrees.single { it.path == created.path }
        assertEquals("Fix login bug", listed.name)
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

    @Test
    fun `stats reports managed worktree diff and ahead counts`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        val dir = Path.of(created.path)
        Files.writeString(dir.resolve("tracked.txt"), "one\n")
        git(dir, "add", "tracked.txt")
        git(dir, "commit", "-m", "feature")
        Files.writeString(dir.resolve("notes.txt"), "two\nthree\n")

        val item = api.stats(repo.toString()).items.single { it.path == created.path }

        assertEquals(3, item.additions)
        assertEquals(0, item.deletions)
        assertEquals(1, item.ahead)
        assertEquals(0, item.behind)
        // tracked.txt (committed ahead of base) + notes.txt (untracked) = 2 changed files.
        assertEquals(2, item.files)
    }

    @Test
    fun `create with existingBranch checks out an existing branch without creating one`() = runBlocking {
        initRepo()
        git(repo, "branch", "feature/x")

        val result = api.create(repo.toString(), CreateWorktreeRequestDto("feature/x", existingBranch = true))
        val created = assertNotNull(result.worktree, "existing-branch create failed: ${result.error}")

        assertEquals("feature/x", created.branch)
        assertTrue(Files.isDirectory(Path.of(created.path)))
        val listed = api.list(repo.toString()).worktrees
        assertTrue(listed.any { it.branch == "feature/x" }, "list should contain the imported branch")
    }

    @Test
    fun `create with existingBranch fails for an unknown branch`() = runBlocking {
        initRepo()

        val result = api.create(repo.toString(), CreateWorktreeRequestDto("no-such-branch", existingBranch = true))

        assertNull(result.worktree, "unknown branch should not create a worktree")
        assertNotNull(result.error)
    }

    @Test
    fun `parsePrUrl reads owner repo and number and rejects non-PR urls`() {
        val ref = assertNotNull(parsePrUrl("https://github.com/Kilo-Org/kilocode/pull/12714"))
        assertEquals("Kilo-Org", ref.owner)
        assertEquals("kilocode", ref.repo)
        assertEquals(12714, ref.number)

        assertNull(parsePrUrl("https://github.com/Kilo-Org/kilocode/issues/1"))
        assertNull(parsePrUrl("not a url"))
    }

    @Test
    fun `parsePrHeadRef reads headRefName`() {
        assertEquals("feature/login", parsePrHeadRef("""{"headRefName":"feature/login","title":"x"}"""))
        assertEquals("", parsePrHeadRef("not json"))
    }

    @Test
    fun `parsePr reads title from gh output`() {
        val pull = assertNotNull(parsePr("/repo/.kilo/worktrees/feature-x", """
            {"number":12,"state":"OPEN","isDraft":false,"url":"https://example.test/pr/12","title":"  Fix login bug  "}
        """.trimIndent()))

        assertEquals("/repo/.kilo/worktrees/feature-x", pull.path)
        assertEquals(12, pull.number)
        assertEquals(GhState.OPEN, pull.state)
        assertEquals("https://example.test/pr/12", pull.url)
        assertEquals("Fix login bug", pull.title)
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
