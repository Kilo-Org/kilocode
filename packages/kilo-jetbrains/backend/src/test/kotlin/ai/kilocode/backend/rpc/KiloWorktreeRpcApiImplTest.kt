package ai.kilocode.backend.rpc

import ai.kilocode.rpc.parsePrUrl
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.MoveStage
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class KiloWorktreeRpcApiImplTest {
    private val repo: Path = Files.createTempDirectory("kilo-worktree")
    private val remote: Path = Files.createTempDirectory("kilo-origin")
    private val api = KiloWorktreeRpcApiImpl()

    @AfterTest
    fun tearDown() {
        delete(repo)
        delete(remote)
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
    fun `parseWorktreeList captures the prunable flag`() {
        val raw = """
            worktree /repo
            HEAD 1111111111111111111111111111111111111111
            branch refs/heads/main

            worktree /repo/.kilo/worktrees/hyper-video
            HEAD 2222222222222222222222222222222222222222
            branch refs/heads/hyper-video
            prunable gitdir file points to non-existent location

        """.trimIndent()

        val list = parseWorktreeList(raw)

        assertFalse(list[0].prunable, "main tree is not prunable")
        assertTrue(list[1].prunable, "second tree should be flagged prunable")
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
    fun `managedWorktrees rejects nested and prunable worktrees`() {
        val raw = """
            worktree /repo
            HEAD 1111111111111111111111111111111111111111
            branch refs/heads/main

            worktree /repo/.kilo/worktrees/feature-x
            HEAD 2222222222222222222222222222222222222222
            branch refs/heads/feature/x

            worktree /repo/.kilo/worktrees/feature-x/.kilo/worktrees/nested
            HEAD 3333333333333333333333333333333333333333
            branch refs/heads/nested

            worktree /repo/.kilo/worktrees/dead
            HEAD 4444444444444444444444444444444444444444
            branch refs/heads/dead
            prunable gitdir file points to non-existent location

        """.trimIndent()

        val list = managedWorktrees(parseWorktreeList(raw))

        assertEquals(listOf("/repo", "/repo/.kilo/worktrees/feature-x"), list.map { it.path })
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
        val file = repo.resolve(".kilo").resolve("jetbrains.json")

        assertTrue(readWorktreeNames(file).isEmpty())
        writeWorktreeNames(file, mapOf("/repo/.kilo/worktrees/feature-x" to "Feature Label", "/blank" to ""))

        assertEquals(mapOf("/repo/.kilo/worktrees/feature-x" to "Feature Label"), readWorktreeNames(file))
        assertEquals(emptyList(), readWorktreeState(file).worktreeOrder)

        Files.writeString(file, "not json")
        assertTrue(readWorktreeNames(file).isEmpty())
    }

    @Test
    fun `worktree state round trips and migrates legacy names`() {
        val file = repo.resolve(".kilo").resolve("jetbrains.json")
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
    fun `create from inside linked worktree uses main worktree storage`() = runBlocking {
        initRepo()
        val first = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)

        val result = api.create(first.path, CreateWorktreeRequestDto("feature/y"))
        val created = assertNotNull(result.worktree, "create failed: ${result.error}")

        assertEquals(repo.resolve(".kilo").resolve("worktrees").resolve("feature-y").toRealPath().toString(), created.path)
        assertFalse(
            Files.exists(Path.of(first.path).resolve(".kilo").resolve("worktrees").resolve("feature-y")),
            "creating from a linked worktree must not nest storage inside it",
        )
    }

    @Test
    fun `create rejects a branch slug that escapes storage`() = runBlocking {
        initRepo()

        val result = api.create(repo.toString(), CreateWorktreeRequestDto("../escape"))

        assertNull(result.worktree)
        assertEquals("Invalid branch name", result.error)
        assertFalse(Files.exists(repo.resolve(".kilo").resolve("escape")))
    }

    @Test
    fun `create succeeds after pruning a deleted checked out branch`() = runBlocking {
        initRepo()
        val first = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        delete(Path.of(first.path))

        val result = api.create(repo.toString(), CreateWorktreeRequestDto("feature/x", existingBranch = true))

        val created = assertNotNull(result.worktree, "create should prune stale metadata and retry: ${result.error}")
        assertTrue(Files.isDirectory(Path.of(created.path)))
    }

    @Test
    fun `create records newest worktree first so reload keeps it on top`() = runBlocking {
        initRepo()

        val first = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("zebra")).worktree)
        val second = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("alpha")).worktree)

        val listed = api.list(repo.toString()).worktrees.filter { !it.main }
        assertEquals(listOf(second.path, first.path), listed.map { it.path })
        assertEquals(
            listOf(second.path, first.path),
            readWorktreeState(repo.resolve(".kilo").resolve("jetbrains.json")).worktreeOrder,
        )
    }

    @Test
    fun `reorder persists a new order that a later list returns`() = runBlocking {
        initRepo()
        val first = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("zebra")).worktree)
        val second = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("alpha")).worktree)

        assertTrue(api.reorder(repo.toString(), listOf(second.path, first.path)))

        val listed = api.list(repo.toString()).worktrees.filter { !it.main }
        assertEquals(listOf(second.path, first.path), listed.map { it.path })
        assertEquals(
            listOf(second.path, first.path),
            readWorktreeState(repo.resolve(".kilo").resolve("jetbrains.json")).worktreeOrder,
        )
    }

    @Test
    fun `reorder drops unknown paths and appends omitted worktrees`() = runBlocking {
        initRepo()
        val first = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("zebra")).worktree)
        val second = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("alpha")).worktree)

        assertTrue(api.reorder(repo.toString(), listOf("/does/not/exist", second.path)))

        val order = readWorktreeState(repo.resolve(".kilo").resolve("jetbrains.json")).worktreeOrder
        assertEquals(listOf(second.path, first.path), order)
    }

    @Test
    fun `reorder returns false when the repo has no worktrees`() = runBlocking {
        assertFalse(api.reorder(repo.toString(), listOf("/repo/.kilo/worktrees/x")))
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
        val state = readWorktreeState(repo.resolve(".kilo").resolve("jetbrains.json"))
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
        assertEquals(mapOf(created.path to "Feature Label"), readWorktreeNames(repo.resolve(".kilo").resolve("jetbrains.json")))
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
        assertEquals(mapOf(created.path to "Fix login bug"), readWorktreeNames(repo.resolve(".kilo").resolve("jetbrains.json")))
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
        assertTrue(result.error != null, "failure should carry an error message")
    }

    @Test
    fun `remove refuses a path outside managed storage`() = runBlocking {
        initRepo()
        val outside = repo.resolve("outside")
        Files.createDirectories(outside)

        val result = api.remove(repo.toString(), outside.toString(), null)

        assertFalse(result.ok)
        assertTrue(result.error?.contains("Refusing") == true)
        assertTrue(Files.isDirectory(outside), "unmanaged directory must not be touched")
    }

    @Test
    fun `remove refuses a worktree containing a live nested worktree`() = runBlocking {
        initRepo()
        val parent = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        val nested = assertNotNull(api.create(parent.path, CreateWorktreeRequestDto("feature/y")).worktree)
        val old = Path.of(parent.path).resolve(".kilo").resolve("worktrees").resolve("nested")
        Files.createDirectories(old.parent)
        git(parent.path, "worktree", "move", nested.path, old.toString())

        val result = api.remove(repo.toString(), parent.path, parent.branch)

        assertFalse(result.ok)
        assertTrue(result.error?.contains(old.toString()) == true, "error should name the blocker: ${result.error}")
        assertTrue(Files.isDirectory(Path.of(parent.path)))
        assertTrue(Files.isDirectory(old))
    }

    @Test
    fun `remove succeeds when nested worktree directory is already gone`() = runBlocking {
        initRepo()
        val parent = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        val nested = assertNotNull(api.create(parent.path, CreateWorktreeRequestDto("feature/y")).worktree)
        val old = Path.of(parent.path).resolve(".kilo").resolve("worktrees").resolve("nested")
        Files.createDirectories(old.parent)
        git(parent.path, "worktree", "move", nested.path, old.toString())
        delete(old)

        val result = api.remove(repo.toString(), parent.path, parent.branch)

        assertTrue(result.ok, "remove should succeed despite dead nested metadata: ${result.error}")
        assertFalse(Files.exists(Path.of(parent.path)))
    }

    @Test
    fun `remove prunes dangling metadata on success`() = runBlocking {
        initRepo()
        val dead = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("dead")).worktree)
        delete(Path.of(dead.path))
        val live = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("live")).worktree)

        val result = api.remove(repo.toString(), live.path, live.branch)

        assertTrue(result.ok, "remove should succeed: ${result.error}")
        val out = output(repo, "worktree", "list", "--porcelain")
        assertFalse(out.contains(dead.path), "remove should prune unrelated dangling worktree metadata")
    }

    @Test
    fun `list drops missing worktrees and reconciles stored state`() = runBlocking {
        initRepo()
        val live = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("live")).worktree)
        val dead = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("dead")).worktree)
        assertNotNull(api.rename(repo.toString(), live.path, "Live").worktree)
        assertNotNull(api.rename(repo.toString(), dead.path, "Dead").worktree)
        delete(Path.of(dead.path))

        val listed = api.list(repo.toString()).worktrees

        assertTrue(listed.any { it.path == live.path })
        assertFalse(listed.any { it.path == dead.path })
        val state = readWorktreeState(repo.resolve(".kilo").resolve("jetbrains.json"))
        assertEquals(mapOf(live.path to "Live"), state.names)
        assertEquals(listOf(live.path), state.worktreeOrder)
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
        assertTrue(result.error != null, "failure should carry an error message")
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
    fun `parsePrHead reads head branch and repository`() {
        val same = parsePrHead("""{"headRefName":"feature/login","title":"x","isCrossRepository":false}""")
        assertEquals("feature/login", same.ref)
        assertFalse(same.cross)

        val fork = parsePrHead(
            """{"headRefName":"patch-1","isCrossRepository":true,"headRepositoryOwner":{"login":"Contributor"}}""",
        )
        assertEquals("patch-1", fork.ref)
        assertTrue(fork.cross)
        assertEquals("Contributor", fork.owner)

        assertEquals(PrHead(), parsePrHead("not json"))
    }

    @Test
    fun `prBranchName prefixes fork heads and falls back to the pr number`() {
        assertEquals("feature/login", prBranchName(PrHead("feature/login"), 7))
        assertEquals("contributor/patch-1", prBranchName(PrHead("patch-1", cross = true, owner = "Contributor"), 7))
        // A cross-repo PR whose owner gh did not report still needs a usable branch name.
        assertEquals("patch-1", prBranchName(PrHead("patch-1", cross = true), 7))
        assertEquals("pr-7", prBranchName(PrHead(), 7))
    }

    @Test
    fun `prTargets keeps the main tree and drops detached and prunable entries`() {
        val items = listOf(
            WorktreeDto("/repo", "repo", "main", "/repo", main = true),
            WorktreeDto("/repo/.kilo/worktrees/a", "a", "feature/a", "/repo/.kilo/worktrees/a"),
            WorktreeDto("/repo/.kilo/worktrees/detached", "detached", "(detached)", "/repo/.kilo/worktrees/detached"),
            WorktreeDto("/repo/.kilo/worktrees/gone", "gone", "feature/gone", "/repo/.kilo/worktrees/gone", prunable = true),
        )

        assertEquals(listOf("/repo", "/repo/.kilo/worktrees/a"), prTargets(items).map { it.path })
    }

    @Test
    fun `baseBranch reads the main tree branch and ignores a detached one`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val linked = WorktreeDto("/repo/.kilo/worktrees/a", "a", "feature/a", "/repo/.kilo/worktrees/a")

        assertEquals("main", baseBranch(listOf(main, linked)))
        assertNull(baseBranch(listOf(main.copy(branch = "(detached)"), linked)))
        assertNull(baseBranch(listOf(linked)))
    }

    @Test
    fun `fetchPrBranch tracks the head branch for a same-repo pull request`() {
        initRepo()
        val origin = originWith(pull = 7, head = "feature/login")

        val failure = fetchPrBranch(runner(repo), 7, PrHead("feature/login"), "feature/login")

        assertNull(failure, "same-repo import should succeed")
        assertEquals("origin", config("branch.feature/login.remote"))
        assertEquals("refs/heads/feature/login", config("branch.feature/login.merge"))
        assertEquals(
            head(origin, "refs/heads/feature/login"),
            head(repo, "refs/heads/feature/login"),
            "local branch should point at the fetched head",
        )
    }

    @Test
    fun `fetchPrBranch falls back to the pull ref when the head branch is gone`() {
        initRepo()
        val origin = originWith(pull = 7, head = "feature/login")
        git(origin, "update-ref", "-d", "refs/heads/feature/login")

        val failure = fetchPrBranch(runner(repo), 7, PrHead("feature/login"), "feature/login")

        assertNull(failure, "import should fall back to the pull ref")
        assertEquals("refs/pull/7/head", config("branch.feature/login.merge"))
        assertEquals(head(origin, "refs/pull/7/head"), head(repo, "refs/heads/feature/login"))
    }

    @Test
    fun `fetchPrBranch tracks the pull ref for a fork pull request`() {
        initRepo()
        val origin = originWith(pull = 7, head = "patch-1")
        // A fork head is not on origin at all; only the pull ref can reach it.
        git(origin, "update-ref", "-d", "refs/heads/patch-1")
        val fork = PrHead("patch-1", cross = true, owner = "contributor")

        val failure = fetchPrBranch(runner(repo), 7, fork, prBranchName(fork, 7))

        assertNull(failure, "fork import should succeed")
        assertEquals("origin", config("branch.contributor/patch-1.remote"))
        assertEquals("refs/pull/7/head", config("branch.contributor/patch-1.merge"))
        assertEquals(head(origin, "refs/pull/7/head"), head(repo, "refs/heads/contributor/patch-1"))
    }

    @Test
    fun `fetchPrBranch force updates a branch left by an earlier import`() {
        initRepo()
        val origin = originWith(pull = 7, head = "feature/login")
        git(repo, "branch", "feature/login")

        val failure = fetchPrBranch(runner(repo), 7, PrHead("feature/login"), "feature/login")

        assertNull(failure, "re-import should refresh the stale branch")
        assertEquals(head(origin, "refs/heads/feature/login"), head(repo, "refs/heads/feature/login"))
    }

    @Test
    fun `fetchPrBranch reports the failing command`() {
        initRepo()

        val failure = fetchPrBranch(runner(repo), 7, PrHead("feature/login"), "feature/login")

        assertNotNull(failure, "a repo without origin cannot fetch a pull request")
        assertFalse(failure.ok)
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

    @Test
    fun `branchStatus reports plain checkout and linked worktree`() = runBlocking {
        initRepo()

        val main = api.branchStatus(repo.toString())
        assertFalse(main.worktree, "main checkout is not a linked worktree")
        assertTrue(main.branch.isNotBlank(), "main checkout should report a branch")

        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        val wt = api.branchStatus(created.path)
        assertTrue(wt.worktree, "a linked worktree should be detected")
        assertEquals("feature/x", wt.branch)
    }

    @Test
    fun `worktree transfer round trips changes without touching the source`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("tracked.txt"), "original\n")
        git(repo, "add", "tracked.txt")
        git(repo, "commit", "-m", "add tracked")
        // Staged new file, an unstaged modification to a tracked file, an untracked text file,
        // and an untracked binary file.
        Files.writeString(repo.resolve("staged.txt"), "staged content\n")
        git(repo, "add", "staged.txt")
        Files.writeString(repo.resolve("tracked.txt"), "modified\n")
        Files.writeString(repo.resolve("untracked.txt"), "brand new\n")
        val binary = byteArrayOf(0, 1, 2, 3, 0, 5, 127, -1)
        Files.write(repo.resolve("blob.bin"), binary)

        val snapshot = WorktreeTransfer.capture(repo)
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        val target = Path.of(created.path)
        // Baseline the source status after worktree creation (which adds .kilo bookkeeping) so the
        // assertion isolates the effect of apply, which must not touch the source tree.
        val before = statusOf(repo)

        val result = WorktreeTransfer.apply(snapshot, repo, target)
        assertTrue(result.ok, "apply should succeed: ${result.error}")

        assertEquals("modified\n", Files.readString(target.resolve("tracked.txt")))
        assertEquals("staged content\n", Files.readString(target.resolve("staged.txt")))
        assertEquals("brand new\n", Files.readString(target.resolve("untracked.txt")))
        assertTrue(binary.contentEquals(Files.readAllBytes(target.resolve("blob.bin"))), "binary file should round-trip")

        // The source working tree must be untouched by capture + apply.
        assertEquals(before, statusOf(repo), "source working tree must be unchanged")
        WorktreeTransfer.cleanup(snapshot)
    }

    @Test
    fun `worktree transfer reports failure when a staged patch cannot apply`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("staged.txt"), "staged content\n")
        git(repo, "add", "staged.txt")

        val snapshot = WorktreeTransfer.capture(repo)
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        val target = Path.of(created.path)
        // Pre-create the staged file in the target so the new-file patch cannot apply cleanly.
        Files.writeString(target.resolve("staged.txt"), "conflicting\n")

        val result = WorktreeTransfer.apply(snapshot, repo, target)

        assertFalse(result.ok, "apply should fail when the patch conflicts")
        assertNotNull(result.error)
        WorktreeTransfer.cleanup(snapshot)
    }

    @Test
    fun `capture fails instead of reporting a clean tree when git cannot run`() {
        // No git repository: a failed capture must throw rather than look like "nothing to move".
        val err = assertFails { WorktreeTransfer.capture(repo) }

        assertTrue(err.message.orEmpty().isNotBlank(), "capture failure should explain itself")
    }

    @Test
    fun `moveToWorktree emits ERROR when capture fails`() = runBlocking {
        val events = api.moveToWorktree(repo.toString(), "ses_1", "feature/x").toList()

        assertEquals(MoveStage.CAPTURING, events.first().stage)
        val last = events.last()
        assertEquals(MoveStage.ERROR, last.stage)
        assertTrue(last.error != null, "the error event should explain the failure")
    }

    @Test
    fun `moveToWorktree rolls back the created worktree when a later stage throws`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("untracked.txt"), "brand new\n")

        // The fork resolves a project-level service that no plain unit test provides, so this move
        // throws after the worktree exists — exactly the case that used to end the flow silently.
        val events = api.moveToWorktree(repo.toString(), "ses_1", "feature/x").toList()

        assertEquals(MoveStage.ERROR, events.last().stage)
        assertTrue(events.map { it.stage }.containsAll(listOf(MoveStage.CREATING, MoveStage.TRANSFERRING)))
        assertFalse(
            Files.exists(repo.resolve(".kilo").resolve("worktrees").resolve("feature-x")),
            "a failed move must not leave its worktree behind",
        )
        assertTrue(api.list(repo.toString()).worktrees.none { it.branch == "feature/x" }, "git must not track the worktree")
    }

    @Test
    fun `moveToWorktree without a session copies changes and skips forking`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("README.md"), "hello edited\n")
        Files.writeString(repo.resolve("untracked.txt"), "brand new\n")

        // No session to fork, so the flow must run to DONE instead of throwing in the fork stage.
        val events = api.moveToWorktree(repo.toString(), null, "feature/x").toList()

        assertEquals(
            listOf(MoveStage.CAPTURING, MoveStage.CREATING, MoveStage.TRANSFERRING, MoveStage.DONE),
            events.map { it.stage },
        )
        val done = events.last()
        assertNull(done.session, "a session-less move must not report a forked session")
        val worktree = assertNotNull(done.worktree)
        val target = Path.of(worktree.path)
        assertEquals("hello edited\n", Files.readString(target.resolve("README.md")))
        assertEquals("brand new\n", Files.readString(target.resolve("untracked.txt")))
        // The transfer is a copy: the source keeps its work.
        assertEquals("hello edited\n", Files.readString(repo.resolve("README.md")))
    }

    private fun statusOf(dir: Path): String {
        val cmd = GeneralCommandLine(listOf("git", "status", "--porcelain")).withWorkDirectory(dir.toFile())
        return CapturingProcessHandler(cmd).runProcess(30_000).stdout
    }

    private fun initRepo() {
        git(repo, "init")
        git(repo, "config", "user.email", "test@kilo.ai")
        git(repo, "config", "user.name", "Kilo Test")
        Files.writeString(repo.resolve("README.md"), "hello")
        git(repo, "add", "README.md")
        git(repo, "commit", "-m", "init")
    }

    /**
     * Builds an "origin" repository holding [head] plus a `refs/pull/<pull>/head` ref pointing at it,
     * the shape GitHub exposes for a pull request, and registers it as [repo]'s origin.
     */
    private fun originWith(pull: Int, head: String): Path {
        git(remote, "init")
        git(remote, "config", "user.email", "test@kilo.ai")
        git(remote, "config", "user.name", "Kilo Test")
        Files.writeString(remote.resolve("README.md"), "origin")
        git(remote, "add", "README.md")
        git(remote, "commit", "-m", "init")
        val base = output(remote, "branch", "--show-current").trim()
        git(remote, "checkout", "-b", head)
        Files.writeString(remote.resolve("pr.txt"), "pr work\n")
        git(remote, "add", "pr.txt")
        git(remote, "commit", "-m", "pr work")
        git(remote, "update-ref", "refs/pull/$pull/head", "refs/heads/$head")
        // Leave the PR head unchecked out so tests can delete it to emulate a deleted branch.
        git(remote, "checkout", base)
        git(repo, "remote", "add", "origin", remote.toString())
        return remote
    }

    private fun runner(dir: Path): (List<String>) -> CmdOut = { args ->
        val cmd = GeneralCommandLine(listOf("git") + args).withWorkDirectory(dir.toFile())
        val out = CapturingProcessHandler(cmd).runProcess(30_000)
        CmdOut(if (out.isTimeout) -1 else out.exitCode, out.stdout, out.stderr)
    }

    private fun config(key: String): String = output(repo, "config", "--get", key).trim()

    private fun head(dir: Path, ref: String): String = output(dir, "rev-parse", ref).trim()

    private fun git(dir: Path, vararg args: String) {
        val cmd = GeneralCommandLine(listOf("git") + args).withWorkDirectory(dir.toFile())
        val out = CapturingProcessHandler(cmd).runProcess(30_000)
        assertEquals(0, out.exitCode, "git ${args.joinToString(" ")} failed: ${out.stderr}")
    }

    private fun git(dir: String, vararg args: String) {
        git(Path.of(dir), *args)
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
