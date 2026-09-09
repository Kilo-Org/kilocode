package ai.kilocode.backend.rpc

import ai.kilocode.backend.worktree.WorktreeTrash
import ai.kilocode.rpc.parsePrUrl
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhCommentsDto
import ai.kilocode.rpc.dto.GhMerge
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.MoveStage
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreeDto
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.util.SystemInfo
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assumptions.assumeFalse
import org.junit.jupiter.api.Assumptions.assumeTrue
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
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
    fun `ghStatus does not report git missing for a removed directory`() = runBlocking {
        assertEquals(GhAvailability.OK, api.ghStatus(repo.resolve("missing").toString()))
    }

    @Test
    fun `prStatus does not report git missing for a removed directory`() = runBlocking {
        assertEquals(GhAvailability.OK, api.prStatus(repo.resolve("missing").toString()).availability)
    }

    @Test
    fun `a cache entry is usable only within both the ttl and the caller ceiling`() {
        assertTrue(usable(time = 0, now = 89_999, ttl = 90_000, maxAge = null))
        assertFalse(usable(time = 0, now = 90_000, ttl = 90_000, maxAge = null))

        // A ceiling tightens: an entry the TTL alone would have served can be rejected, which is the
        // only way a caller returning to the IDE can get past a cache filled before it left.
        assertTrue(usable(time = 0, now = 9_999, ttl = 90_000, maxAge = 10_000))
        assertFalse(usable(time = 0, now = 10_000, ttl = 90_000, maxAge = 10_000))

        // ...and never extends, so no caller can pin stale data beyond the TTL.
        assertFalse(usable(time = 0, now = 120_000, ttl = 90_000, maxAge = Long.MAX_VALUE))

        // Zero forces the work to run, and a negative value is clamped to that rather than inverting
        // the comparison into "always fresh".
        assertFalse(usable(time = 0, now = 0, ttl = 90_000, maxAge = 0))
        assertFalse(usable(time = 0, now = 0, ttl = 90_000, maxAge = -1))
    }

    @Test
    fun `reason reports a timeout instead of falling through to the fallback text`() {
        assertEquals("timed out", api.reason(CmdOut(-1, "", "", timeout = true), "git worktree remove failed"))
        assertEquals("boom", api.reason(CmdOut(1, "", "boom"), "git worktree remove failed"))
        assertEquals("git worktree remove failed", api.reason(CmdOut(1, "", ""), "git worktree remove failed"))
    }

    @Test
    fun `cancellation checks in the poll wrappers also cover ProcessCanceledException`() {
        // statsSafe/dirtySafe/prStatus isolate per-worktree failures behind runCatching and rethrow
        // only CancellationException. That is enough to honor IntelliJ's "never swallow a PCE" rule
        // solely because PCE extends java.util.concurrent.CancellationException, which is also what
        // kotlinx.coroutines.CancellationException aliases on the JVM. Locked down here so a platform
        // change that decoupled the two would fail this test instead of silently turning a cancelled
        // progress indicator into a fake empty poll result.
        assertTrue(ProcessCanceledException() is CancellationException)
    }

    @Test
    fun `branch status serves its cache until a caller demands a fresher answer`() = runBlocking {
        initRepo()
        val dir = repo.resolve(".kilo").resolve("worktrees").resolve("cached")
        git(repo, "worktree", "add", "-b", "feature/cached", dir.toString())
        assertEquals("feature/cached", api.branchStatus(dir.toString()).branch)

        git(dir, "checkout", "-b", "feature/moved")

        // The default ceiling accepts the entry written above, so a change made meanwhile is invisible
        // for as long as it lives — the staleness a returning caller has to be able to reject.
        assertEquals("feature/cached", api.branchStatus(dir.toString()).branch)
        assertEquals("feature/moved", api.branchStatus(dir.toString(), maxAge = 0).branch)
    }

    @Test
    fun `branch status keeps serving the cache for a ceiling wider than the entry age`() = runBlocking {
        initRepo()
        val dir = repo.resolve(".kilo").resolve("worktrees").resolve("wide")
        git(repo, "worktree", "add", "-b", "feature/wide", dir.toString())
        assertEquals("feature/wide", api.branchStatus(dir.toString()).branch)

        git(dir, "checkout", "-b", "feature/other")

        // A returning caller passes the length of its absence, not zero: work that happened while it
        // was away is still current, so a ceiling the entry fits inside must reuse it.
        assertEquals("feature/wide", api.branchStatus(dir.toString(), maxAge = 60_000).branch)
    }

    @Test
    fun `branch status skips a missing directory without caching the empty result`() = runBlocking {
        initRepo()
        val dir = repo.resolve(".kilo").resolve("worktrees").resolve("late")
        assertEquals("", api.branchStatus(dir.toString()).branch)

        git(repo, "worktree", "add", "-b", "feature/x", dir.toString())

        assertEquals("feature/x", api.branchStatus(dir.toString()).branch)
    }

    @Test
    fun `ghStatus reports git only when the github integration is off`() = runBlocking {
        initRepo()
        assertEquals(GhAvailability.OK, api.ghStatus(repo.toString(), github = false))
    }

    @Test
    fun `branch status resolves git state without a pull request when the github integration is off`() = runBlocking {
        initRepo()
        val dir = repo.resolve(".kilo").resolve("worktrees").resolve("off")
        git(repo, "worktree", "add", "-b", "feature/off", dir.toString())

        val status = api.branchStatus(dir.toString(), github = false)

        assertEquals("feature/off", status.branch)
        assertTrue(status.worktree)
        assertEquals(GhAvailability.OK, status.availability)
        assertNull(status.pr)
    }

    @Test
    fun `stats syncs away a worktree deleted from disk`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        assertTrue(api.stats(repo.toString()).items.any { it.path == created.path })

        delete(Path.of(created.path))

        assertTrue(api.stats(repo.toString()).items.none { it.path == created.path })
        // The stale entry is pruned from git metadata, so later probes never target the gone directory.
        val listed = output(repo, "worktree", "list", "--porcelain")
        assertFalse(listed.contains(created.path), "stale worktree should be pruned during sync: $listed")
    }

    @Test
    fun `stats leaves a gone worktree outside the kilo storage registered`() = runBlocking {
        initRepo()
        val outside = remote.resolve("elsewhere")
        git(repo, "worktree", "add", "-b", "feature/outside", outside.toString())
        delete(outside)

        // The gone entry is excluded from the probe targets, but pruning someone else's worktree
        // metadata is not the plugin's business, so git's bookkeeping is left untouched.
        assertTrue(api.stats(repo.toString()).items.none { it.path == outside.toString() })
        val listed = output(repo, "worktree", "list", "--porcelain")
        assertTrue(listed.contains(outside.toString()), "unmanaged worktree must not be pruned: $listed")
    }

    @Test
    fun `staleWorktrees only reports gone worktrees inside the kilo storage`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val managed = WorktreeDto(
            "/repo/.kilo/worktrees/gone",
            "gone",
            "feature/gone",
            "/repo/.kilo/worktrees/gone",
            prunable = true,
        )
        val outside = WorktreeDto("/elsewhere/gone", "gone", "feature/other", "/elsewhere/gone", prunable = true)

        assertEquals(listOf(managed.path), staleWorktrees(listOf(main, managed, outside)).map { it.path })
        assertTrue(staleWorktrees(listOf(main, outside)).isEmpty())
    }

    @Test
    fun `badDir detects a missing working directory spawn failure`() {
        assertTrue(badDir("Cannot start a process, the working directory '/tmp/gone' does not exist"))
        assertFalse(badDir("Cannot run program \"git\": error=2, No such file or directory"))
        // git's own message for the same race once the process has already started: the working
        // directory disappeared before git called getcwd(), rather than before it was even spawned.
        assertTrue(badDir("fatal: Unable to read current working directory: No such file or directory"))
        assertFalse(badDir("fatal: index file corrupt"))
        assertFalse(badDir("fatal: not a git repository (or any of the parent directories): .git"))
    }

    @Test
    fun `staleWorktrees excludes a worktree already marked doomed in WorktreeTrash`() {
        val trash = WorktreeTrash(CoroutineScope(Dispatchers.Default + SupervisorJob()))
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val gone = WorktreeDto("/repo/.kilo/worktrees/gone", "gone", "feature/gone", "/repo/.kilo/worktrees/gone", prunable = true)

        assertEquals(listOf(gone.path), staleWorktrees(listOf(main, gone), trash).map { it.path })

        trash.mark(gone.path)
        // A worktree WorktreeTrash already knows is being removed is about to become stale by
        // design (the removal renamed its directory away and will prune it itself); a concurrent
        // poll's own prune must not race that in-flight removal.
        assertTrue(staleWorktrees(listOf(main, gone), trash).isEmpty())
    }

    @Test
    fun `managedWorktrees excludes a directory staged for delete even while git still lists it`() {
        val main = WorktreeDto("/repo", "repo", "main", "/repo", main = true)
        val staged = WorktreeDto(
            "/repo/.kilo/worktrees/${WorktreeTrash.PREFIX}abc",
            "${WorktreeTrash.PREFIX}abc",
            "feature/x",
            "/repo/.kilo/worktrees/${WorktreeTrash.PREFIX}abc",
        )
        val real = WorktreeDto("/repo/.kilo/worktrees/feature-x", "feature-x", "feature/x", "/repo/.kilo/worktrees/feature-x")

        assertEquals(listOf(real.path), managedWorktrees(listOf(main, staged, real)).filter { !it.main }.map { it.path })
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
    fun `classifyGhError detects a spent api budget without calling it an auth problem`() {
        // `gh auth status` validates the token against the API, so it is usually the first to be told.
        assertEquals(GhAvailability.RATE_LIMITED, classifyGhError("HTTP 403: API rate limit exceeded for user ID 1."))
        assertEquals(GhAvailability.RATE_LIMITED, classifyGhError("You have exceeded a secondary rate limit."))
        assertEquals(GhAvailability.RATE_LIMITED, classifyGhError("HTTP 429: Too Many Requests"))
        // A revoked token also mentions authentication; that reading has to win, because the answer is
        // "log in again" rather than "wait".
        assertEquals(GhAvailability.UNAUTH, classifyGhError("authentication failed, and rate limit remaining is 0"))
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
    fun `session list visibility round trips beside names and order`() {
        val file = repo.resolve(".kilo").resolve("jetbrains.json")
        val path = "/repo/.kilo/worktrees/feature-x"

        writeWorktreeState(file, WorktreeState(mapOf(path to "Feature"), listOf(path), mapOf(path to true, "/repo" to false)))

        val state = readWorktreeState(file)
        assertEquals(mapOf(path to true, "/repo" to false), state.sessionList)
        assertEquals(mapOf(path to "Feature"), state.names)
        assertEquals(listOf(path), state.worktreeOrder)

        // A file that only ever recorded visibility must not be mistaken for the legacy name map.
        Files.writeString(file, """{"sessionList":{"$path":true}}""")
        assertEquals(mapOf(path to true), readWorktreeState(file).sessionList)
        assertTrue(readWorktreeState(file).names.isEmpty())
    }

    @Test
    fun `reconcile drops visibility for vanished worktrees but keeps the main tree`() {
        val main = "/repo"
        val live = "/repo/.kilo/worktrees/live"
        val dead = "/repo/.kilo/worktrees/dead"
        val state = WorktreeState(sessionList = mapOf(main to true, live to false, dead to true))

        val next = state.reconcile(listOf(live), listOf(main, live))

        assertEquals(mapOf(main to true, live to false), next.sessionList)
    }

    @Test
    fun `session list visibility is unknown until set and then persists per worktree`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        val main = api.list(repo.toString()).worktrees.single { it.main }

        assertNull(api.sessionList(created.path), "a fresh worktree has no stored choice")
        assertNull(api.sessionList(main.path))

        assertTrue(api.setSessionList(created.path, true))
        assertTrue(api.setSessionList(main.path, false))

        assertEquals(true, api.sessionList(created.path))
        assertEquals(false, api.sessionList(main.path))
        // The main working tree keeps its entry across a list, which reconciles the file.
        api.list(repo.toString())
        assertEquals(false, api.sessionList(main.path))
    }

    @Test
    fun `create and list never record session list visibility`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)

        api.list(repo.toString())

        assertTrue(readWorktreeState(repo.resolve(".kilo").resolve("jetbrains.json")).sessionList.isEmpty())
        assertNull(api.sessionList(created.path))
    }

    @Test
    fun `remove prunes session list visibility`() = runBlocking {
        initRepo()
        val first = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("zebra")).worktree)
        val second = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("alpha")).worktree)
        assertTrue(api.setSessionList(first.path, true))
        assertTrue(api.setSessionList(second.path, true))

        assertTrue(api.remove(repo.toString(), first.path, first.branch).ok)

        assertEquals(
            mapOf(second.path to true),
            readWorktreeState(repo.resolve(".kilo").resolve("jetbrains.json")).sessionList,
        )
    }

    @Test
    fun `session list visibility reports nothing outside a repo`() = runBlocking {
        assertNull(api.sessionList(repo.toString()))
        assertFalse(api.setSessionList(repo.toString(), true))
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
    fun `stats reports committed diff against the base branch`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        val dir = Path.of(created.path)
        Files.writeString(dir.resolve("tracked.txt"), "one\n")
        git(dir, "add", "tracked.txt")
        git(dir, "commit", "-m", "feature")
        // Working-tree noise a pull request would not contain.
        Files.writeString(dir.resolve("notes.txt"), "two\nthree\n")

        val item = api.stats(repo.toString()).items.single { it.path == created.path }

        assertEquals(1, item.additions, "only the committed line belongs in the PR number")
        assertEquals(0, item.deletions)
        assertEquals(1, item.files, "untracked notes.txt must not count")
        assertEquals(1, item.ahead)
        assertEquals(0, item.behind)
    }

    @Test
    fun `stats ignores the branch upstream and uses the base branch`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        val dir = Path.of(created.path)
        Files.writeString(dir.resolve("tracked.txt"), "one\n")
        git(dir, "add", "tracked.txt")
        git(dir, "commit", "-m", "feature")
        // Emulate a fully pushed branch: an upstream that already contains the commit.
        git(repo, "branch", "shadow", "feature/x")
        git(dir, "branch", "--set-upstream-to=shadow", "feature/x")

        val item = api.stats(repo.toString()).items.single { it.path == created.path }

        assertEquals(1, item.additions, "an in-sync upstream must not zero out the diff")
        assertEquals(1, item.ahead)
    }

    @Test
    fun `stats is unchanged by uncommitted edits`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        val dir = Path.of(created.path)
        Files.writeString(dir.resolve("tracked.txt"), "one\n")
        git(dir, "add", "tracked.txt")
        git(dir, "commit", "-m", "feature")
        val before = api.stats(repo.toString()).items.single { it.path == created.path }

        Files.writeString(dir.resolve("tracked.txt"), "one\ntwo\n")
        Files.writeString(dir.resolve("untracked.txt"), "three\n")

        val after = api.stats(repo.toString()).items.single { it.path == created.path }

        assertEquals(before.additions, after.additions)
        assertEquals(before.files, after.files)
    }

    @Test
    fun `dirty reports staged unstaged and untracked changes`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        val dir = Path.of(created.path)
        Files.writeString(dir.resolve("tracked.txt"), "one\n")
        git(dir, "add", "tracked.txt")
        git(dir, "commit", "-m", "feature")
        // Staged edit, unstaged edit, and an untracked file.
        Files.writeString(dir.resolve("staged.txt"), "s\n")
        git(dir, "add", "staged.txt")
        Files.writeString(dir.resolve("tracked.txt"), "one\ntwo\n")
        Files.writeString(dir.resolve("untracked.txt"), "u\n")

        val item = api.dirty(repo.toString()).items.single { it.path == created.path }

        assertEquals(3, item.additions, "staged + unstaged + untracked lines")
        assertEquals(0, item.deletions)
        assertEquals(3, item.files)
        assertEquals(1, item.untracked)
    }

    @Test
    fun `dirty reports zero for a clean worktree`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)

        val item = api.dirty(repo.toString()).items.single { it.path == created.path }

        assertEquals(0, item.files)
        assertEquals(0, item.unpushed, "no upstream means no unpushed count")
    }

    @Test
    fun `dirty reports the main checkout too`() = runBlocking {
        initRepo()
        api.create(repo.toString(), CreateWorktreeRequestDto("feature/x"))
        val root = repo.toRealPath()
        // Creating a worktree leaves its own traces in the main checkout, so the edits below are
        // measured as a delta rather than against an assumed-clean starting point.
        val items = api.dirty(repo.toString()).items
        val before = assertNotNull(items.singleOrNull { Path.of(it.path) == root }, "main checkout missing from $items")

        Files.writeString(repo.resolve("README.md"), "hello there\n")
        Files.writeString(repo.resolve("untracked.txt"), "u\n")
        val after = assertNotNull(api.dirty(repo.toString()).items.singleOrNull { Path.of(it.path) == root })

        assertEquals(before.files + 2, after.files, "the README edit plus the untracked file")
        assertEquals(before.untracked + 1, after.untracked)
    }

    @Test
    fun `stats leaves the main checkout out`() = runBlocking {
        initRepo()
        api.create(repo.toString(), CreateWorktreeRequestDto("feature/x"))
        val root = repo.toRealPath()

        // The main checkout holds the branch the others are compared against, so it has no base stats
        // to report -- only its uncommitted counts, which dirty() answers for.
        assertTrue(api.stats(repo.toString()).items.none { Path.of(it.path) == root })
    }

    @Test
    fun `dirty counts commits missing from the upstream`() = runBlocking {
        initRepo()
        val created = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("feature/x")).worktree)
        val dir = Path.of(created.path)
        git(repo, "branch", "shadow", "feature/x")
        git(dir, "branch", "--set-upstream-to=shadow", "feature/x")
        Files.writeString(dir.resolve("tracked.txt"), "one\n")
        git(dir, "add", "tracked.txt")
        git(dir, "commit", "-m", "feature")

        val item = api.dirty(repo.toString()).items.single { it.path == created.path }

        assertEquals(1, item.unpushed)
        assertEquals(0, item.files, "committed work is not uncommitted")
    }

    /**
     * [dirty] and [statsSafe]/[dirtySafe] via [api.dirty] and [api.stats] share the exact same
     * `runCatching` isolation wrapper (see [statsSafe]/[dirtySafe] in the implementation), so proving
     * it here for [dirty] covers the mechanism for both. [stats]'s own git calls compare two fully
     * resolved commits (`GitComparison`'s two-revision form), which is why the same index corruption
     * cannot be reused to force a throw there: a tree-to-tree diff never reads the index at all,
     * unlike [dirty]'s working-tree comparison used below.
     */
    @Test
    fun `dirty reports a neutral entry for a worktree whose index is corrupted instead of failing the whole call`() = runBlocking {
        initRepo()
        val healthy = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("healthy")).worktree)
        val broken = assertNotNull(api.create(repo.toString(), CreateWorktreeRequestDto("broken")).worktree)
        Files.writeString(Path.of(healthy.path).resolve("tracked.txt"), "edit\n")
        corruptIndex(Path.of(broken.path))

        // GitComparison.open() succeeds for `broken` (HEAD resolves fine); the corrupted index only
        // breaks the later `git diff`/`ls-files` calls inside files() -- exactly the "open succeeded,
        // a later command threw" shape a real fault takes, as opposed to a directory that is simply
        // gone (which open() already returns null for, no throw involved).
        val dto = api.dirty(repo.toString())

        val healthyItem = assertNotNull(dto.items.singleOrNull { it.path == healthy.path })
        assertEquals(1, healthyItem.files, "a healthy sibling must still be reported correctly")
        val brokenItem = assertNotNull(dto.items.singleOrNull { it.path == broken.path })
        assertEquals(WorktreeDirtyDto(broken.path), brokenItem, "a broken worktree gets a neutral entry, not an exception")
    }

    /** Overwrites [dir]'s own worktree index with garbage so `git diff`/`ls-files` fail well after
     * `rev-parse --is-inside-work-tree` and `rev-parse HEAD` (which don't read the index) already
     * succeeded. */
    private fun corruptIndex(dir: Path) {
        val gitDir = Path.of(output(dir, "rev-parse", "--path-format=absolute", "--git-dir").trim())
        Files.write(gitDir.resolve("index"), "not an index".toByteArray())
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
    fun `parsePr defaults review and checks when gh did not report them`() {
        val pull = assertNotNull(parsePr("/repo", """{"number":1,"state":"OPEN","url":"https://pr/1"}"""))

        // The scalar fallback and repositories with no review or CI land here, so "nothing to show"
        // has to be the default rather than an optimistic pass.
        assertEquals(GhReview.NONE, pull.review)
        assertEquals(GhChecks.NONE, pull.checks.state)
        assertEquals(GhChecksDto(), pull.checks)
        assertEquals(GhMerge.UNKNOWN, pull.merge, "a merge verdict nobody gave is not a clean merge")
    }

    @Test
    fun `parsePr carries the merge verdict gh reported`() {
        val pull = assertNotNull(
            parsePr("/repo", """{"number":1,"state":"OPEN","url":"https://pr/1","mergeable":"CONFLICTING"}"""),
        )

        assertEquals(GhMerge.CONFLICTING, pull.merge)
    }

    @Test
    fun `parseMerge maps every github mergeable answer`() {
        assertEquals(GhMerge.CONFLICTING, parseMerge(obj("""{"mergeable":"CONFLICTING"}""")))
        assertEquals(GhMerge.CLEAN, parseMerge(obj("""{"mergeable":"MERGEABLE"}""")))
        // GitHub recomputes mergeability after every push and answers UNKNOWN until it finishes, so an
        // unsettled or missing verdict must not read as a clean merge.
        assertEquals(GhMerge.UNKNOWN, parseMerge(obj("""{"mergeable":"UNKNOWN"}""")))
        assertEquals(GhMerge.UNKNOWN, parseMerge(obj("""{"mergeable":null}""")))
        assertEquals(GhMerge.UNKNOWN, parseMerge(obj("{}")))
    }

    @Test
    fun `parseReview maps every github review decision`() {
        assertEquals(GhReview.APPROVED, parseReview(obj("""{"reviewDecision":"APPROVED"}""")))
        assertEquals(GhReview.CHANGES_REQUESTED, parseReview(obj("""{"reviewDecision":"CHANGES_REQUESTED"}""")))
        assertEquals(GhReview.PENDING, parseReview(obj("""{"reviewDecision":"REVIEW_REQUIRED"}""")))
        // A repository that requires no review reports an empty decision rather than omitting it.
        assertEquals(GhReview.NONE, parseReview(obj("""{"reviewDecision":""}""")))
        assertEquals(GhReview.NONE, parseReview(obj("""{"reviewDecision":null}""")))
        assertEquals(GhReview.NONE, parseReview(obj("{}")))
    }

    @Test
    fun `parseChecks counts a mixed rollup and lets failure win`() {
        val checks = parseChecks(
            obj(
                """
                {"statusCheckRollup":[
                  {"conclusion":"SUCCESS"},
                  {"conclusion":"SUCCESS"},
                  {"conclusion":"FAILURE"},
                  {"conclusion":"","status":"IN_PROGRESS"},
                  {"conclusion":"SKIPPED"}
                ]}
                """.trimIndent(),
            ),
        )

        // A red build stays red however many jobs are still queued behind it.
        assertEquals(GhChecks.FAILED, checks.state)
        assertEquals(4, checks.total, "skipped checks are excluded, matching GitHub's own count")
        assertEquals(2, checks.passed)
        assertEquals(1, checks.failed)
        assertEquals(1, checks.pending)
    }

    @Test
    fun `parseChecks reads a running check from status when conclusion is still empty`() {
        val checks = parseChecks(obj("""{"statusCheckRollup":[{"conclusion":"","status":"IN_PROGRESS"}]}"""))

        assertEquals(GhChecks.PENDING, checks.state)
        assertEquals(1, checks.pending)
    }

    @Test
    fun `parseChecks reads a legacy commit status from state`() {
        // Commit statuses carry `state` and never `conclusion`, unlike check runs.
        assertEquals(GhChecks.PASSED, parseChecks(obj("""{"statusCheckRollup":[{"state":"SUCCESS"}]}""")).state)
        assertEquals(GhChecks.FAILED, parseChecks(obj("""{"statusCheckRollup":[{"state":"ERROR"}]}""")).state)
    }

    @Test
    fun `parseChecks reports none for an absent or empty rollup`() {
        assertEquals(GhChecks.NONE, parseChecks(obj("{}")).state)
        assertEquals(GhChecks.NONE, parseChecks(obj("""{"statusCheckRollup":[]}""")).state)
        // Every check skipped is still nothing to report, not a pass.
        assertEquals(GhChecks.NONE, parseChecks(obj("""{"statusCheckRollup":[{"conclusion":"SKIPPED"}]}""")).state)
    }

    @Test
    fun `parsePrNodeId reads the node id and tolerates gh answering without one`() {
        assertEquals("PR_kwDOAbCdEf", parsePrNodeId("""{"id":"  PR_kwDOAbCdEf  ","number":1}"""))
        assertEquals("", parsePrNodeId("""{"number":1}"""))
        assertEquals("", parsePrNodeId("""{"id":null}"""))
        assertEquals("", parsePrNodeId("not json"))
    }

    @Test
    fun `parseThreads counts unresolved conversations`() {
        val comments = parseThreads(
            """
            {"data":{"node":{"reviewThreads":{"totalCount":4,"nodes":[
              {"isResolved":false},
              {"isResolved":true},
              {"isResolved":false},
              {"isResolved":true}
            ]}}}}
            """.trimIndent(),
        )

        assertEquals(2, comments.unresolved)
        assertEquals(4, comments.total)
    }

    @Test
    fun `parseThreads counts an outdated conversation nobody resolved`() {
        // GitHub's own unresolved-conversation number includes threads whose lines have moved on, and a
        // reviewer still expects a reply to one.
        val comments = parseThreads(
            """{"data":{"node":{"reviewThreads":{"totalCount":1,"nodes":[{"isResolved":false,"isOutdated":true}]}}}}""",
        )

        assertEquals(1, comments.unresolved)
    }

    @Test
    fun `parseThreads treats a missing flag as unresolved`() {
        // The flag is only absent when GitHub omitted it, which is not evidence anyone resolved the thread.
        val comments = parseThreads("""{"data":{"node":{"reviewThreads":{"nodes":[{},{"isResolved":true}]}}}}""")

        assertEquals(1, comments.unresolved)
        assertEquals(2, comments.total, "the node count stands in for an absent totalCount")
    }

    @Test
    fun `parseThreads reports nothing for an absent, empty, or malformed payload`() {
        assertEquals(GhCommentsDto(), parseThreads("""{"data":{"node":{"reviewThreads":{"totalCount":0,"nodes":[]}}}}"""))
        assertEquals(GhCommentsDto(), parseThreads("""{"data":{"node":null}}"""))
        assertEquals(GhCommentsDto(), parseThreads("""{"data":{}}"""))
        assertEquals(GhCommentsDto(), parseThreads("{}"))
        assertEquals(GhCommentsDto(), parseThreads(""))
        assertEquals(GhCommentsDto(), parseThreads("not json"))
    }

    @Test
    fun `parseThreads keeps a total past the query page while the unresolved count cannot`() {
        // The query asks for the first 100 threads, so `totalCount` is the only honest total past that.
        val nodes = List(100) { """{"isResolved":false}""" }.joinToString(",")
        val comments = parseThreads("""{"data":{"node":{"reviewThreads":{"totalCount":137,"nodes":[$nodes]}}}}""")

        assertEquals(100, comments.unresolved)
        assertEquals(137, comments.total)
    }

    @Test
    fun `checkState treats an unrecognised verdict as pending`() {
        assertEquals(CheckState.PASSED, checkState("NEUTRAL"))
        assertEquals(CheckState.FAILED, checkState("TIMED_OUT"))
        assertEquals(CheckState.FAILED, checkState("CANCELLED"))
        assertEquals(CheckState.SKIPPED, checkState("SKIPPED"))
        // A name nobody recognises has not reported success; calling it a failure would paint rows red
        // the next time GitHub adds a status.
        assertEquals(CheckState.PENDING, checkState("SOMETHING_NEW"))
        assertEquals(CheckState.PENDING, checkState(null))
    }

    private fun obj(raw: String) = Json.parseToJsonElement(raw) as JsonObject

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

        preserved {
            captured { snapshot ->
                val target = target()
                val result = WorktreeTransfer.apply(snapshot, target)
                assertTrue(result.ok, "apply should succeed: ${result.error}")

                assertEquals("modified\n", Files.readString(target.resolve("tracked.txt")))
                assertEquals("original\n", output(target, "show", ":tracked.txt"))
                assertEquals("staged content\n", Files.readString(target.resolve("staged.txt")))
                assertEquals("staged content\n", output(target, "show", ":staged.txt"))
                assertEquals("brand new\n", Files.readString(target.resolve("untracked.txt")))
                assertContentEquals(binary, Files.readAllBytes(target.resolve("blob.bin")))
            }
        }
    }

    @Test
    fun `worktree transfer reports failure when a staged patch cannot apply`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("staged.txt"), "staged content\n")
        git(repo, "add", "staged.txt")

        preserved {
            captured { snapshot ->
                val target = target()
                Files.writeString(target.resolve("staged.txt"), "conflicting\n")

                preserved(target) {
                    val result = WorktreeTransfer.apply(snapshot, target)

                    assertFalse(result.ok, "apply should fail when the patch conflicts")
                    assertTrue(assertNotNull(result.error).contains("staged.txt"), result.error)
                }
            }
        }
    }

    @Test
    fun `capture fails instead of reporting a clean tree when git cannot run`() {
        // No git repository: a failed capture must throw rather than look like "nothing to move".
        val err = failure(repo)

        assertTrue(err.message.orEmpty().contains("git rev-parse"), "capture failure should explain itself: $err")
    }

    @Test
    fun `moveToWorktree rejects unresolved merge conflicts before creating a worktree`() = runBlocking {
        initRepo()
        diverge("README.md")

        conflicted("README.md")
    }

    @Test
    fun `moveToWorktree emits ERROR when capture fails`() = runBlocking {
        val events = api.moveToWorktree(repo.toString(), "ses_1", "feature/x").toList()

        assertEquals(listOf(MoveStage.CAPTURING, MoveStage.ERROR), events.map { it.stage })
        assertTrue(assertNotNull(events.last().error).isNotBlank(), "the error event should explain the failure")
        assertFalse(Files.exists(repo.resolve(".kilo/worktrees/feature-x")))
    }

    @Test
    fun `moveToWorktree rolls back the created worktree when a later stage throws`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("untracked.txt"), "brand new\n")

        // The fork resolves a project-level service that no plain unit test provides, so this move
        // throws after the worktree exists — exactly the case that used to end the flow silently.
        preserved {
            val events = api.moveToWorktree(repo.toString(), "ses_1", "feature/x").toList()

            assertEquals(
                listOf(MoveStage.CAPTURING, MoveStage.CREATING, MoveStage.TRANSFERRING, MoveStage.FORKING, MoveStage.ERROR),
                events.map { it.stage },
            )
            assertTrue(assertNotNull(events.last().error).isNotBlank())
            absent()
        }
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

    @Test
    fun `moveToWorktree rejects unresolved conflicts left by a stash pop without a MERGE_HEAD marker`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("README.md"), "stashed\n")
        git(repo, "stash", "push")
        Files.writeString(repo.resolve("README.md"), "advanced\n")
        git(repo, "commit", "-am", "advance")
        val popped = runner(repo)(listOf("stash", "pop"))
        assertFalse(popped.ok, "the fixture must produce an unresolved stash conflict")
        assertFalse(
            Files.exists(metadata(repo, "MERGE_HEAD")),
            "this fixture must reproduce a conflict with no MERGE_HEAD marker",
        )

        conflicted("README.md")
    }

    @Test
    fun `moveToWorktree rejects merge conflicts even alongside unrelated staged and unstaged edits`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("other.txt"), "line\n")
        git(repo, "add", "other.txt")
        git(repo, "commit", "-m", "add other")
        diverge("README.md")
        Files.writeString(repo.resolve("other.txt"), "staged change\n")
        git(repo, "add", "other.txt")
        Files.writeString(repo.resolve("other.txt"), "unstaged change\n")
        Files.write(repo.resolve("untracked.bin"), byteArrayOf(0, 1, -1, 127))
        assertEquals("staged change\n", output(repo, "show", ":other.txt"))
        assertEquals("MM other.txt\u0000", output(repo, "status", "--porcelain=v1", "-z", "--", "other.txt"))

        conflicted("README.md")
    }

    @Test
    fun `moveToWorktree rejects an add-add conflict with no common ancestor stage`() = runBlocking {
        initRepo()
        diverge("new.txt")

        conflicted("new.txt", stages = listOf("2", "3"))
    }

    @Test
    fun `moveToWorktree lists every conflicted path exactly once when multiple files conflict`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("b.txt"), "base\n")
        git(repo, "add", "b.txt")
        git(repo, "commit", "-m", "add b")
        diverge("README.md", "b.txt")

        conflicted("README.md", "b.txt")
    }

    @Test
    fun `moveToWorktree reports conflicted filenames without quoting or splitting control characters`() = runBlocking {
        assumeFalse(SystemInfo.isWindows, "Windows forbids quotes and control characters in filenames")
        initRepo()
        val name = "my \"文件\"\tname\n.md"
        Files.writeString(repo.resolve(name), "hello\n")
        git(repo, "add", name)
        git(repo, "commit", "-m", "add unusual filename")
        diverge(name)

        conflicted(name)
    }

    @Test
    fun `moveToWorktree rejects a merge conflict outside the given subdirectory`() = runBlocking {
        initRepo()
        Files.createDirectories(repo.resolve("sub"))
        Files.writeString(repo.resolve("sub/file.txt"), "hello\n")
        git(repo, "add", "sub/file.txt")
        git(repo, "commit", "-m", "add sub file")
        diverge("README.md")

        conflicted("README.md", dir = repo.resolve("sub"))
    }

    @Test
    fun `moveToWorktree from a subdirectory transfers root nested and sibling paths without flattening`() = runBlocking {
        initRepo()
        val tracked = listOf("README.md", "sub/nested/tracked.txt", "sibling/tracked.txt")
        tracked.forEach { name ->
            Files.createDirectories(repo.resolve(name).parent)
            Files.writeString(repo.resolve(name), "base $name\n")
        }
        git(repo, "add", "--", *tracked.toTypedArray())
        git(repo, "commit", "-m", "add nested files")
        tracked.forEach { Files.writeString(repo.resolve(it), "staged $it\n") }
        git(repo, "add", "--", *tracked.toTypedArray())
        tracked.forEach { Files.writeString(repo.resolve(it), "unstaged $it\n") }
        val untracked = listOf("notes.txt", "sub/nested/notes.txt", "sibling/notes.txt")
        untracked.forEach { Files.writeString(repo.resolve(it), "untracked $it\n") }
        val rev = head(repo, "HEAD")

        preserved {
            val events = api.moveToWorktree(repo.resolve("sub").toString(), null, "feature/x").toList()

            assertEquals(
                listOf(MoveStage.CAPTURING, MoveStage.CREATING, MoveStage.TRANSFERRING, MoveStage.DONE),
                events.map { it.stage },
                events.last().error,
            )
            val target = Path.of(assertNotNull(events.last().worktree).path)
            assertEquals(rev, head(target, "HEAD"))
            tracked.forEach { name ->
                assertEquals("staged $name\n", output(target, "show", ":$name"))
                assertEquals("unstaged $name\n", Files.readString(target.resolve(name)))
                assertEquals("MM $name\u0000", output(target, "status", "--porcelain=v1", "-z", "--", name))
            }
            untracked.forEach { name ->
                assertEquals("untracked $name\n", Files.readString(target.resolve(name)))
            }
            assertEquals(
                untracked.toSet(),
                output(target, "ls-files", "--others", "--exclude-standard", "-z").split('\u0000').filter { it.isNotEmpty() }.toSet(),
            )
            assertFalse(Files.exists(target.resolve("tracked.txt")))
            assertFalse(Files.exists(target.resolve("nested")))
        }
    }

    @Test
    fun `moveToWorktree from a linked checkout captures its own HEAD index and files instead of the main checkout`() = runBlocking {
        initRepo()
        val source = remote.resolve("source")
        git(repo, "worktree", "add", "-b", "source", source.toString())
        Files.writeString(source.resolve("README.md"), "linked base\n")
        git(source, "commit", "-am", "advance linked checkout")
        val rev = head(source, "HEAD")
        assertFalse(rev == head(repo, "HEAD"), "linked and main fixtures must have different commits")
        Files.writeString(repo.resolve("README.md"), "main staged\n")
        git(repo, "add", "README.md")
        Files.writeString(repo.resolve("README.md"), "main unstaged\n")
        Files.writeString(repo.resolve("notes.txt"), "main notes\n")
        Files.writeString(repo.resolve("main-only.txt"), "main only\n")
        Files.writeString(source.resolve("README.md"), "linked staged\n")
        git(source, "add", "README.md")
        Files.writeString(source.resolve("README.md"), "linked unstaged\n")
        Files.writeString(source.resolve("notes.txt"), "linked notes\n")
        Files.createDirectories(source.resolve("sub"))

        preserved {
            preserved(source) {
                val events = api.moveToWorktree(source.resolve("sub").toString(), null, "feature/x").toList()

                assertEquals(
                    listOf(MoveStage.CAPTURING, MoveStage.CREATING, MoveStage.TRANSFERRING, MoveStage.DONE),
                    events.map { it.stage },
                    events.last().error,
                )
                val target = Path.of(assertNotNull(events.last().worktree).path)
                assertEquals(repo.resolve(".kilo/worktrees/feature-x").toRealPath(), target.toRealPath())
                assertEquals(rev, head(target, "HEAD"))
                assertEquals("linked staged\n", output(target, "show", ":README.md"))
                assertEquals("linked unstaged\n", Files.readString(target.resolve("README.md")))
                assertEquals("MM README.md\u0000", output(target, "status", "--porcelain=v1", "-z", "--", "README.md"))
                assertEquals("linked notes\n", Files.readString(target.resolve("notes.txt")))
                assertFalse(Files.exists(target.resolve("main-only.txt")))
                assertFalse(Files.exists(source.resolve(".kilo/worktrees/feature-x")))
            }
        }
    }

    @Test
    fun `worktree transfer preserves staged and unstaged edits to the same file`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("README.md"), "staged version\n")
        git(repo, "add", "README.md")
        Files.writeString(repo.resolve("README.md"), "unstaged version\n")

        preserved {
            captured { snapshot ->
                assertEquals(head(repo, "HEAD"), snapshot.head)
                val target = target()
                val result = WorktreeTransfer.apply(snapshot, target)

                assertTrue(result.ok, "apply should succeed: ${result.error}")
                assertEquals("staged version\n", output(target, "show", ":README.md"))
                assertEquals("unstaged version\n", Files.readString(target.resolve("README.md")))
                assertEquals("MM README.md\u0000", output(target, "status", "--porcelain=v1", "-z", "--", "README.md"))
            }
        }
    }

    @Test
    fun `worktree transfer preserves staged and unstaged versions of the same tracked binary`() = runBlocking {
        initRepo()
        Files.write(repo.resolve("blob.bin"), byteArrayOf(0, 1, 2, 3, 4, 5, 127, -1))
        git(repo, "add", "blob.bin")
        git(repo, "commit", "-m", "add binary")
        val staged = byteArrayOf(9, 8, 7, 0, 6, 5, -1, 127)
        Files.write(repo.resolve("blob.bin"), staged)
        git(repo, "add", "blob.bin")
        val index = head(repo, ":blob.bin")
        val unstaged = byteArrayOf(0, -1, 5, 6, 7, 8, 9, 10)
        Files.write(repo.resolve("blob.bin"), unstaged)

        preserved {
            captured { snapshot ->
                assertTrue(Files.readString(assertNotNull(snapshot.staged)).contains("GIT binary patch"))
                assertTrue(Files.readString(assertNotNull(snapshot.unstaged)).contains("GIT binary patch"))
                val target = target()
                val result = WorktreeTransfer.apply(snapshot, target)

                assertTrue(result.ok, "apply should succeed: ${result.error}")
                assertEquals(index, head(target, ":blob.bin"))
                assertContentEquals(unstaged, Files.readAllBytes(target.resolve("blob.bin")))
                assertEquals("MM blob.bin\u0000", output(target, "status", "--porcelain=v1", "-z", "--", "blob.bin"))
            }
        }
    }

    @Test
    fun `worktree transfer round trips untracked Unicode quoted and control character filenames`() = runBlocking {
        assumeFalse(SystemInfo.isWindows, "Windows forbids quotes and control characters in filenames")
        initRepo()
        val names = listOf("my new file.txt", "文件.txt", "quoted \"name\"\twith\nlines.txt")
        names.forEach { Files.writeString(repo.resolve(it), "content for $it\n") }

        preserved {
            captured { snapshot ->
                assertEquals(names.toSet(), snapshot.untracked.keys)
                val target = target()
                val result = WorktreeTransfer.apply(snapshot, target)

                assertTrue(result.ok, "apply should succeed: ${result.error}")
                names.forEach { name ->
                    assertEquals("content for $name\n", Files.readString(target.resolve(name)))
                }
                assertEquals(
                    names.toSet(),
                    output(target, "ls-files", "--others", "--exclude-standard", "-z").split('\u0000').filter { it.isNotEmpty() }.toSet(),
                )
            }
        }
    }

    @Test
    fun `captured tracked and untracked content survives edits to the source after capture`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("README.md"), "staged version\n")
        git(repo, "add", "README.md")
        Files.writeString(repo.resolve("README.md"), "unstaged version\n")
        Files.writeString(repo.resolve("untracked.txt"), "original\n")

        captured { snapshot ->
            val copy = assertNotNull(snapshot.untracked["untracked.txt"])
            assertFalse(copy.toRealPath().startsWith(repo.toRealPath()), "the snapshot must own an independent temporary copy")
            Files.writeString(repo.resolve("README.md"), "mutated after capture\n")
            git(repo, "add", "README.md")
            Files.writeString(repo.resolve("untracked.txt"), "mutated after capture\n")
            assertEquals("original\n", Files.readString(copy))

            preserved {
                val target = target()
                val result = WorktreeTransfer.apply(snapshot, target)

                assertTrue(result.ok, "apply should succeed: ${result.error}")
                assertEquals("staged version\n", output(target, "show", ":README.md"))
                assertEquals("unstaged version\n", Files.readString(target.resolve("README.md")))
                assertEquals("original\n", Files.readString(target.resolve("untracked.txt")))
            }
        }
    }

    @Test
    fun `captured untracked file content survives deletion of the source after capture`() = runBlocking {
        initRepo()
        val bytes = byteArrayOf(0, -1, 127, 10, 13)
        Files.write(repo.resolve("untracked.bin"), bytes)

        captured { snapshot ->
            val copy = assertNotNull(snapshot.untracked["untracked.bin"])
            Files.delete(repo.resolve("untracked.bin"))
            assertContentEquals(bytes, Files.readAllBytes(copy))

            preserved {
                val target = target()
                val result = WorktreeTransfer.apply(snapshot, target)

                assertTrue(result.ok, "apply should succeed: ${result.error}")
                assertContentEquals(bytes, Files.readAllBytes(target.resolve("untracked.bin")))
                assertFalse(Files.exists(repo.resolve("untracked.bin")), "apply must not recreate the deleted source")
            }
        }
    }

    @Test
    fun `worktree transfer reports failure when an unstaged patch cannot apply`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("README.md"), "unstaged version\n")

        preserved {
            captured { snapshot ->
                assertNull(snapshot.staged)
                assertNotNull(snapshot.unstaged)
                val target = target()
                Files.writeString(target.resolve("README.md"), "conflicting target\n")

                preserved(target) {
                    val result = WorktreeTransfer.apply(snapshot, target)

                    assertFalse(result.ok, "an unstaged patch failure must not report success")
                    val error = assertNotNull(result.error)
                    assertTrue(error.contains("Unstaged patch failed"), error)
                    assertTrue(error.contains("README.md"), error)
                }
            }
        }
    }

    @Test
    fun `worktree transfer reports a locked target index without changing its index or working files`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("README.md"), "staged version\n")
        git(repo, "add", "README.md")

        preserved {
            captured { snapshot ->
                assertNotNull(snapshot.staged)
                val target = target()
                val lock = metadata(target, "index.lock")
                Files.createFile(lock)
                try {
                    val index = metadata(target, "index")
                    val bytes = Files.readAllBytes(index)
                    preserved(target) {
                        val result = WorktreeTransfer.apply(snapshot, target)

                        assertFalse(result.ok, "apply must not report success when the target index is locked")
                        val error = assertNotNull(result.error)
                        assertTrue(error.contains("Staged patch failed"), error)
                        assertTrue(error.contains("index.lock"), error)
                        assertContentEquals(bytes, Files.readAllBytes(index), "a failed index write must leave the index intact")
                        assertTrue(Files.exists(lock), "apply must not remove another process's lock")
                    }
                } finally {
                    Files.deleteIfExists(lock)
                }
            }
        }
    }

    @Test
    fun `worktree transfer refuses to overwrite an existing untracked destination`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("untracked.txt"), "source content\n")

        preserved {
            captured { snapshot ->
                val target = target()
                Files.writeString(target.resolve("untracked.txt"), "keep target content\n")

                preserved(target) {
                    val result = WorktreeTransfer.apply(snapshot, target)

                    assertFalse(result.ok, "a pre-existing destination must not be overwritten")
                    assertTrue(assertNotNull(result.error).contains("untracked.txt"), result.error)
                }
            }
        }
    }

    @Test
    fun `worktree transfer fails when an untracked file cannot be written to the target`() = runBlocking {
        initRepo()
        Files.createDirectories(repo.resolve("sub"))
        Files.writeString(repo.resolve("sub/deep.txt"), "deep\n")

        preserved {
            captured { snapshot ->
                val target = target()
                Files.writeString(target.resolve("sub"), "blocking file\n")

                preserved(target) {
                    val result = WorktreeTransfer.apply(snapshot, target)

                    assertFalse(result.ok, "apply should fail when an untracked file cannot be written")
                    assertTrue(assertNotNull(result.error).contains("sub/deep.txt"), result.error)
                    assertFalse(Files.exists(target.resolve("sub/deep.txt")))
                }
            }
        }
    }

    @Test
    fun `worktree transfer names the untracked path when its captured copy is missing`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("untracked.txt"), "source content\n")

        preserved {
            captured { snapshot ->
                Files.delete(assertNotNull(snapshot.untracked["untracked.txt"]))
                val target = target()

                preserved(target) {
                    val result = WorktreeTransfer.apply(snapshot, target)

                    assertFalse(result.ok, "missing snapshot content must not be silently skipped")
                    assertTrue(assertNotNull(result.error).contains("untracked.txt"), result.error)
                    assertFalse(Files.exists(target.resolve("untracked.txt")))
                }
            }
        }
    }

    @Test
    fun `moveToWorktree rolls back the worktree and branch when copying an untracked file fails`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("README.md"), "staged version\n")
        git(repo, "add", "README.md")
        Files.writeString(repo.resolve("README.md"), "unstaged version\n")
        Files.createDirectories(repo.resolve("sub"))
        Files.writeString(repo.resolve("sub/deep.txt"), "source content\n")

        preserved {
            val events = api.moveToWorktree(repo.toString(), null, "feature/x").onEach { event ->
                if (event.stage == MoveStage.TRANSFERRING) {
                    val target = repo.resolve(".kilo/worktrees/feature-x")
                    assertTrue(Files.isDirectory(target))
                    assertEquals(head(repo, "HEAD"), head(repo, "refs/heads/feature/x"))
                    Files.writeString(target.resolve("sub"), "blocking file\n")
                }
            }.toList()

            assertEquals(
                listOf(MoveStage.CAPTURING, MoveStage.CREATING, MoveStage.TRANSFERRING, MoveStage.ERROR),
                events.map { it.stage },
            )
            assertTrue(assertNotNull(events.last().error).contains("sub/deep.txt"), events.last().error)
            assertNull(events.last().worktree)
            absent()
        }
    }

    @Test
    fun `moveToWorktree rejects oversized untracked content instead of moving a partial snapshot`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("README.md"), "staged version\n")
        git(repo, "add", "README.md")
        Files.writeString(repo.resolve("README.md"), "unstaged version\n")
        Files.writeString(repo.resolve("a-small.txt"), "capture before the oversized file\n")
        Files.write(repo.resolve("z-large.bin"), ByteArray(10 * 1024 * 1024 + 1) { (it % 251).toByte() })

        rejected {
            assertTrue(it.contains("z-large.bin"), it)
            assertTrue(it.contains("exceeds"), it)
            assertTrue(it.contains("10485760"), it)
            assertTrue(it.contains("limit"), it)
        }
    }

    @Test
    fun `moveToWorktree rejects an unreadable untracked regular file without creating a branch`() = runBlocking {
        assumeTrue(Files.getFileStore(repo).supportsFileAttributeView("posix"), "the fixture requires POSIX permissions")
        initRepo()
        val file = repo.resolve("unreadable.txt")
        Files.writeString(file, "must not be skipped\n")
        val permissions = Files.getPosixFilePermissions(file)

        preserved {
            Files.setPosixFilePermissions(file, emptySet())
            try {
                assumeFalse(Files.isReadable(file), "the fixture requires read access to be denied")
                val message = "Failed to capture untracked file unreadable.txt"
                assertTrue(assertNotNull(failure(repo).message).contains(message))
                val events = api.moveToWorktree(repo.toString(), null, "feature/x").toList()

                assertEquals(listOf(MoveStage.CAPTURING, MoveStage.ERROR), events.map { it.stage })
                assertTrue(assertNotNull(events.last().error).contains(message), events.last().error)
                assertNull(events.last().worktree)
                absent()
            } finally {
                Files.setPosixFilePermissions(file, permissions)
            }
        }
    }

    @Test
    fun `moveToWorktree rejects an unsupported untracked directory symlink`() = runBlocking {
        assumeFalse(SystemInfo.isWindows, "creating symbolic links on Windows may require elevated privileges")
        initRepo()
        Files.createSymbolicLink(repo.resolve("unsupported"), Path.of("."))

        rejected {
            assertTrue(it.contains("Failed to capture untracked file unsupported"), it)
            assertTrue(it.contains("Not a regular file"), it)
        }
    }

    @Test
    fun `moveToWorktree rejects untracked content that cannot be read through a dangling symlink`() = runBlocking {
        assumeFalse(SystemInfo.isWindows, "creating symbolic links on Windows may require elevated privileges")
        initRepo()
        Files.createSymbolicLink(repo.resolve("unreadable.txt"), Path.of("missing.txt"))

        rejected {
            assertTrue(it.contains("Failed to capture untracked file unreadable.txt"), it)
        }
    }

    @Test
    fun `cleanup deletes every staged unstaged and untracked temporary file`() = runBlocking {
        initRepo()
        Files.writeString(repo.resolve("README.md"), "staged version\n")
        git(repo, "add", "README.md")
        Files.writeString(repo.resolve("README.md"), "unstaged version\n")
        Files.writeString(repo.resolve("untracked.txt"), "temp content\n")
        Files.write(repo.resolve("untracked.bin"), byteArrayOf(0, -1, 127))

        preserved {
            captured { snapshot ->
                assertEquals(setOf("untracked.txt", "untracked.bin"), snapshot.untracked.keys)
                val files = listOf(assertNotNull(snapshot.staged), assertNotNull(snapshot.unstaged)) + snapshot.untracked.values
                assertEquals(4, files.distinct().size)
                assertTrue(Files.isDirectory(snapshot.storage))
                files.forEach { file ->
                    assertTrue(Files.isRegularFile(file), "snapshot file must exist: $file")
                    assertTrue(file.toRealPath().startsWith(snapshot.storage.toRealPath()))
                    assertFalse(file.toRealPath().startsWith(repo.toRealPath()), "snapshot file must be independently owned: $file")
                }

                WorktreeTransfer.cleanup(snapshot)

                files.forEach { assertFalse(Files.exists(it), "cleanup must remove $it") }
                assertFalse(Files.exists(snapshot.storage), "cleanup must remove the snapshot's owned directory")
            }
        }
    }

    private fun diverge(vararg names: String) {
        val base = output(repo, "branch", "--show-current").trim()
        git(repo, "checkout", "-b", "conflicting")
        names.forEach { Files.writeString(repo.resolve(it), "branch $it\n") }
        git(repo, "add", "--", *names)
        git(repo, "commit", "-m", "change on branch")
        git(repo, "checkout", base)
        names.forEach { Files.writeString(repo.resolve(it), "main $it\n") }
        git(repo, "add", "--", *names)
        git(repo, "commit", "-m", "change on main")
        val merged = runner(repo)(listOf("merge", "conflicting"))
        assertFalse(merged.ok, "the fixture must produce unresolved conflicts")
    }

    private suspend fun conflicted(
        vararg names: String,
        dir: Path = repo,
        stages: List<String> = listOf("1", "2", "3"),
    ) {
        val entries = output(repo, "ls-files", "--unmerged", "-z").split('\u0000').filter { it.isNotEmpty() }
        assertEquals(names.toSet(), entries.map { it.substringAfter('\t') }.toSet(), "the fixture must contain real unmerged entries")
        names.forEach { name ->
            assertEquals(
                stages,
                entries.filter { it.substringAfter('\t') == name }.map { it.substringBefore('\t').substringAfterLast(' ') },
                "unexpected index stages for $name",
            )
        }
        rejected(dir) {
            assertEquals("Resolve merge conflicts before moving to a worktree: ${names.joinToString(", ")}", it)
        }
    }

    private suspend fun rejected(dir: Path = repo, check: (String) -> Unit) {
        preserved {
            val message = assertNotNull(failure(dir).message)
            check(message)
            val events = api.moveToWorktree(dir.toString(), null, "feature/x").toList()

            assertEquals(listOf(MoveStage.CAPTURING, MoveStage.ERROR), events.map { it.stage })
            assertEquals(message, events.last().error)
            events.forEach {
                assertNull(it.worktree)
                assertNull(it.session)
            }
            absent()
        }
    }

    private fun absent() {
        assertFalse(Files.exists(repo.resolve(".kilo/worktrees/feature-x")), "a failed move must not leave a worktree directory")
        val listed = parseWorktreeList(output(repo, "worktree", "list", "--porcelain"))
        assertEquals(1, listed.size, "a failed move must not leave a worktree registration: $listed")
        assertTrue(listed.single().main)
        assertEquals(
            "",
            output(repo, "for-each-ref", "--format=%(refname)", "refs/heads/feature/x"),
            "a failed move must not leave its branch ref even if the worktree was removed",
        )
    }

    private inline fun preserved(dir: Path = repo, block: () -> Unit) {
        val rev = head(dir, "HEAD")
        val ref = output(dir, "symbolic-ref", "HEAD")
        val index = output(dir, "ls-files", "--stage", "-z")
        val status = output(dir, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".", ":(exclude).kilo")
        val files = output(dir, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ".", ":(exclude).kilo")
            .split('\u0000').filter { it.isNotEmpty() }.distinct().associateWith { bytes(dir.resolve(it)) }

        block()

        assertEquals(rev, head(dir, "HEAD"), "HEAD must be unchanged in $dir")
        assertEquals(ref, output(dir, "symbolic-ref", "HEAD"), "branch ref must be unchanged in $dir")
        assertEquals(index, output(dir, "ls-files", "--stage", "-z"), "index stages must be unchanged in $dir")
        assertEquals(
            status,
            output(dir, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".", ":(exclude).kilo"),
            "status must be unchanged in $dir",
        )
        files.forEach { (name, content) ->
            assertContentEquals(content, bytes(dir.resolve(name)), "bytes must be unchanged: ${dir.resolve(name)}")
        }
    }

    private fun bytes(file: Path): ByteArray? {
        if (Files.isSymbolicLink(file)) return Files.readSymbolicLink(file).toString().toByteArray()
        if (!Files.exists(file)) return null
        return Files.readAllBytes(file)
    }

    private inline fun captured(dir: Path = repo, block: (WorktreeTransfer.Snapshot) -> Unit) {
        val snapshot = WorktreeTransfer.capture(dir)
        try {
            block(snapshot)
        } finally {
            WorktreeTransfer.cleanup(snapshot)
        }
    }

    private fun failure(dir: Path): Throwable = assertFails { captured(dir) { Unit } }

    private suspend fun target(): Path {
        val result = api.create(repo.toString(), CreateWorktreeRequestDto("feature/x"))
        return Path.of(assertNotNull(result.worktree, "create failed: ${result.error}").path)
    }

    private fun metadata(dir: Path, name: String): Path =
        Path.of(output(dir, "rev-parse", "--path-format=absolute", "--git-path", name).trimEnd('\r', '\n'))

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
