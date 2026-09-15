package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.ForkHandoff
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.diff.GIT_COMMAND_TIMEOUT_MS
import ai.kilocode.backend.diff.GitComparison
import ai.kilocode.backend.diff.runGitCommand
import ai.kilocode.backend.worktree.WorktreeTrash
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.parsePrUrl
import ai.kilocode.rpc.dto.BranchStatusDto
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhCommentsDto
import ai.kilocode.rpc.dto.GhMerge
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.MoveProgressDto
import ai.kilocode.rpc.dto.MoveStage
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.RenameWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeBranchesDto
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreeDirtyListDto
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreeListDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreePrListDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import ai.kilocode.rpc.dto.WorktreeStatsListDto
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.configurations.GeneralCommandLine.ParentEnvironmentType
import com.intellij.execution.process.CapturingProcessHandler
import com.intellij.ide.impl.OpenProjectTask
import com.intellij.ide.impl.ProjectUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.EDT
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.openapi.wm.WindowManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.awt.Frame
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.concurrent.ConcurrentHashMap

class KiloWorktreeRpcApiImpl(
    // Resolved once at construction, matching every other worktree-scoped service accessed through
    // this class. Null exactly when there is no IntelliJ Application to resolve it from (a plain unit
    // test, same as every `service<...>()` call this file already makes) — every caller below treats
    // that as "nothing is ever being removed via the fast path", not as an error.
    private val trash: WorktreeTrash? = defaultTrash(),
) : KiloWorktreeRpcApi {

    companion object {
        internal val LOG = KiloLog.create(KiloWorktreeRpcApiImpl::class.java)
        private const val GH_PROBE_TTL = 300_000L
        private const val GH_STATUS_TTL = 3_000L
        // A spent budget lasts until GitHub's window rolls over, so re-probing on the ordinary cadence
        // would spend calls confirming a state that cannot have changed. Long enough to stop the churn,
        // short enough to notice the reset without waiting out a poll interval.
        private const val GH_LIMIT_TTL = 60_000L
        private const val PR_TTL = 90_000L
        // The rename+prune path returns long before this ever matters; it only bounds the fallback
        // `git worktree remove --force`, which recursively deletes the checkout synchronously and
        // therefore needs far more headroom than the 30s default query timeout.
        private const val REMOVE_TIMEOUT_MS = 600_000
        // Above this, a caller waiting on the per-repo mutation lock is worth a log line — most waits
        // are a few ms and would just be noise.
        private const val LOCK_WAIT_LOG_THRESHOLD_MS = 200L

        private fun defaultTrash(): WorktreeTrash? {
            if (ApplicationManager.getApplication() == null) return null
            return service<WorktreeTrash>()
        }
    }

    private val prs = ConcurrentHashMap<String, Timed<WorktreePrListDto>>()
    private val branches = ConcurrentHashMap<String, Timed<BranchStatusDto>>()
    private val resolver = PrResolver(gh = ::runGh, git = ::runGit)
    private val ghLock = Any()
    // Serializes the git-mutating operations (create/import/remove/rename/adopt/reorder/session-list)
    // for one repository, keyed by its main worktree's real path, so concurrent calls cannot interleave
    // `worktree list` / `remove` / `branch -D` / `worktree prune` or race the read-modify-write of
    // `.kilo/jetbrains.json`. Read paths (list/stats/dirty/prStatus/branchStatus/ghStatus/sessionList)
    // are deliberately never locked — they must not queue behind a slow mutation.
    private val locks = ConcurrentHashMap<String, Mutex>()
    @Volatile
    private var ghProbe: Timed<GhAvailability>? = null
    @Volatile
    private var ghCache: Timed<GhAvailability>? = null

    override suspend fun list(directory: String): WorktreeListDto = withContext(Dispatchers.IO) {
        val base = Path.of(directory).normalize()
        val res = runGit(base, "worktree", "list", "--porcelain")
        if (!res.ok) return@withContext WorktreeListDto()
        val all = parseWorktreeList(res.stdout)
        val items = managedWorktrees(all)
        val alive = live(items.filter { it.main || Files.isDirectory(Path.of(it.path)) })
        val store = worktreeNameStore(alive)
        val state = store?.let { syncWorktreeState(it, worktreePaths(alive), livePaths(alive)) } ?: WorktreeState()
        val named = overlayWorktreeNames(alive, state.names)
        // Cheap and non-blocking: sweeps orphaned `.kilo-delete-*` directories left by an interrupted
        // delete (this plugin's or the VS Code extension's) every time the list is polled, so they do
        // not require a fresh remove() to be cleaned up.
        all.firstOrNull { it.main }?.let {
            trash?.sweep(Path.of(it.path).normalize().resolve(".kilo").resolve("worktrees").normalize())
        }
        WorktreeListDto(orderWorktrees(named, state.worktreeOrder))
    }

    override suspend fun open(directory: String): Boolean {
        val dir = Path.of(directory).normalize()
        val exists = withContext(Dispatchers.IO) { Files.isDirectory(dir) }
        if (!exists) {
            LOG.warn("worktree open skipped, not a directory: $directory")
            return false
        }
        // If the worktree already has an open project frame, just focus it -- never enter the open
        // pipeline. forceOpenInNewFrame skips the platform's "already open -> focus" guard, so the
        // focus guard must run first. If nothing is open, always open a separate frame.
        val focused = withContext(Dispatchers.EDT) { focusIfOpen(dir) }
        if (focused) {
            LOG.info("worktree open (backend): focused already-open frame dir=$dir")
            return true
        }
        LOG.info("worktree open (backend): opening dir=$dir newFrame=true")
        val opts = OpenProjectTask.build().withForceOpenInNewFrame(true)
        val project = ProjectUtil.openOrImportAsync(dir, opts)
        LOG.info("worktree open (backend) requested: dir=$dir newFrame=true opened=${project?.name}")
        return true
    }

    /**
     * Focuses the frame of an already-open project whose base directory is [dir], mirroring the
     * platform window switcher (com.intellij.openapi.wm.impl.ProjectWindowAction). Returns false when
     * no open project matches, so the caller can open it. Matches with [ProjectUtil.isSameProject]
     * (symlink/case aware via the filesystem) and a path-string fallback.
     */
    @RequiresEdt
    private fun focusIfOpen(dir: Path): Boolean {
        val target = dir.toString()
        val project: Project = ProjectManager.getInstance().openProjects.firstOrNull {
            ProjectUtil.isSameProject(dir, it) || FileUtil.pathsEqual(it.basePath, target) || FileUtil.pathsEqual(it.presentableUrl, target)
        } ?: run {
            LOG.info("worktree focus (backend): no open project for $dir")
            return false
        }
        val frame = WindowManager.getInstance().getFrame(project) ?: run {
            LOG.info("worktree focus (backend): ${project.name} open but has no frame")
            return true
        }
        val state = frame.extendedState
        if (state and Frame.ICONIFIED != 0) frame.extendedState = state and Frame.ICONIFIED.inv()
        frame.toFront()
        val focus = IdeFocusManager.getGlobalInstance()
        focus.doWhenFocusSettlesDown { frame.mostRecentFocusOwner?.let { focus.requestFocus(it, true) } }
        LOG.info("worktree focus (backend): brought frame to front for ${project.name}")
        return true
    }

    override suspend fun listBranches(directory: String): WorktreeBranchesDto = withContext(Dispatchers.IO) {
        val base = Path.of(directory).normalize()
        val refs = runGit(base, "for-each-ref", "--format=%(refname:short)", "refs/heads")
        val branches = if (!refs.ok) emptyList() else refs.stdout.lines().map { it.trim() }.filter { it.isNotEmpty() }
        val current = runGit(base, "branch", "--show-current").stdout.trim().takeIf { it.isNotEmpty() }
        WorktreeBranchesDto(branches, current)
    }

    override suspend fun stats(directory: String): WorktreeStatsListDto = withContext(Dispatchers.IO) {
        val root = Path.of(directory).normalize()
        val items = sync(root) ?: return@withContext WorktreeStatsListDto()
        val fallback = baseBranch(items) ?: "HEAD"
        WorktreeStatsListDto(parallel(items.filter { !it.main }) { item -> statsSafe(item, fallback) })
    }

    /**
     * Uncommitted counts for every working tree of [directory]'s repo, the main checkout included: its
     * own session editor tab shows them in its header, and they are what a move to a worktree carries.
     * Unlike [stats], which compares a worktree against the base branch and so has nothing to say about
     * the checkout that branch lives on, this comparison is local to each working tree.
     */
    override suspend fun dirty(directory: String): WorktreeDirtyListDto = withContext(Dispatchers.IO) {
        val root = Path.of(directory).normalize()
        val items = sync(root) ?: return@withContext WorktreeDirtyListDto()
        WorktreeDirtyListDto(parallel(items) { item -> dirtySafe(item) })
    }

    /**
     * Lists the managed worktrees of [root] after reconciling git's metadata with the disk, so
     * callers never probe a directory that no longer exists. Returns null when [root] itself is gone
     * or git cannot list.
     *
     * Dropping gone entries from the result is what makes probing safe; the prune is only metadata
     * hygiene. So the prune runs exclusively when a Kilo-managed worktree is the stale one, and a
     * mis-parse can at worst skip it — git re-checks every entry on disk and only ever removes
     * `$GIT_DIR/worktrees` bookkeeping for a checkout it finds missing, never any files, and never a
     * locked worktree (the documented guard for worktrees on unmounted volumes).
     */
    private fun sync(root: Path): List<WorktreeDto>? {
        if (!Files.isDirectory(root)) {
            LOG.info("worktree sync skipped, directory does not exist: $root")
            return null
        }
        val res = runGit(root, "worktree", "list", "--porcelain")
        if (!res.ok) return null
        val raw = parseWorktreeList(res.stdout)
        val stale = staleWorktrees(raw, trash)
        val synced = if (stale.isEmpty()) managedWorktrees(raw) else {
            LOG.info("worktree sync pruning stale managed worktrees: ${stale.joinToString(", ") { it.path }}")
            val prune = runGit(root, "worktree", "prune", "-v")
            if (!prune.ok) LOG.warn("worktree prune during sync failed: exit=${prune.exit} stderr=${snippet(prune.stderr)}")
            if (prune.ok && prune.stdout.isNotBlank()) LOG.info("worktree sync pruned: ${snippet(prune.stdout)}")
            val again = runGit(root, "worktree", "list", "--porcelain")
            if (!again.ok) return null
            managedWorktrees(parseWorktreeList(again.stdout))
        }
        return live(synced.filter { Files.isDirectory(Path.of(it.path)) })
    }

    override suspend fun ghStatus(directory: String, github: Boolean, maxAge: Long?): GhAvailability = withContext(Dispatchers.IO) {
        probeGh(Path.of(directory).normalize(), "rpc", github, maxAge)
    }

    override suspend fun prStatus(directory: String, maxAge: Long?): WorktreePrListDto = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        prs[directory]?.takeIf { usable(it.time, now, PR_TTL, maxAge) }?.let { return@withContext it.value }
        val root = Path.of(directory).normalize()
        // A gone directory reports nothing and is not cached, so a real availability problem found
        // from a live directory still reaches the UI.
        if (!Files.isDirectory(root)) {
            LOG.info("pr status skipped, directory does not exist: $root")
            return@withContext WorktreePrListDto()
        }
        // A caller that rejected the cached PR list would not accept a cached availability verdict
        // from the same moment either, so the ceiling carries into the gh probe.
        val available = ghAvailable(root, maxAge = maxAge)
        if (available != GhAvailability.OK) return@withContext WorktreePrListDto(available).also { prs[directory] = Timed(now, it) }
        // Sync the worktree list before the per-worktree lookups so a worktree that was added and
        // then deleted on disk is pruned instead of resolved from a directory that no longer exists.
        // sync() (via live()) already drops anything mid-removal, so prTargets never fans `gh` out
        // into a directory this process is in the middle of deleting.
        val all = sync(root) ?: return@withContext WorktreePrListDto().also { prs[directory] = Timed(now, it) }
        val items = prTargets(all)
        val base = baseBranch(all)
        var status = GhAvailability.OK
        val data = parallel(items) { item ->
            if (status != GhAvailability.OK) return@parallel null
            val lookup = runCatching { resolver.resolve(item.path, item.branch, base) }.getOrElse { err ->
                if (err is CancellationException) throw err
                LOG.warn("worktree poll failed: op=pr path=${item.path} message=${err.message}", err)
                return@parallel null
            }
            // The resolver only ever reports UNAUTH or OK; a missing gh/git binary is already
            // caught by the upfront ghAvailable() check before this loop runs.
            if (lookup.availability != GhAvailability.OK) status = lookup.availability
            lookup.pr
        }.filterNotNull()
        val dto = WorktreePrListDto(status, if (status == GhAvailability.OK) data else emptyList())
        prs[directory] = Timed(System.currentTimeMillis(), dto)
        dto
    }

    override suspend fun branchStatus(directory: String, github: Boolean, maxAge: Long?): BranchStatusDto = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        // Keyed by directory + mode so flipping the GitHub integration setting cannot serve a
        // cross-mode entry (a disabled-mode entry always has a null pr; an enabled-mode entry may
        // not) for up to PR_TTL after the flip.
        val key = "$directory|$github"
        branches[key]?.takeIf { usable(it.time, now, PR_TTL, maxAge) }?.let { return@withContext it.value }
        val root = Path.of(directory).normalize()
        if (!Files.isDirectory(root)) {
            LOG.info("branch status skipped, directory does not exist: $root")
            return@withContext BranchStatusDto()
        }
        // Not cached — same rule as the missing-directory branch above, so a directory recreated at
        // this path right after a delete finishes is not pinned to an empty answer.
        if (trash?.doomed(directory) == true) {
            LOG.info("worktree poll skipped: op=branch path=$root reason=deleting")
            return@withContext BranchStatusDto()
        }
        val branch = runGit(root, "branch", "--show-current").stdout.trim()
        val worktree = isLinkedWorktree(root)
        val availability = ghAvailable(root, github, maxAge)
        val lookup = if (github && availability == GhAvailability.OK && branch.isNotBlank()) {
            resolver.resolve(directory, branch, baseBranch(root))
        } else {
            PrLookup()
        }
        val dto = BranchStatusDto(
            branch = branch,
            worktree = worktree,
            // A PR lookup that hits an auth failure must not be reported as a branch without a PR.
            availability = if (availability == GhAvailability.OK) lookup.availability else availability,
            pr = lookup.pr,
        )
        branches[key] = Timed(System.currentTimeMillis(), dto)
        dto
    }

    /**
     * Every failure path — including a throw from capture, worktree creation bookkeeping, or the
     * optional fork — emits [MoveStage.ERROR] and rolls back a worktree that was already created.
     * The frontend collector has no error handling of its own, so a silent flow completion would
     * leave the Agent Manager row stuck on its last stage forever.
     */
    override suspend fun moveToWorktree(directory: String, sessionId: String?, branch: String): Flow<MoveProgressDto> = flow {
        val base = Path.of(directory).normalize()
        LOG.info("worktree move requested: dir=$base session=$sessionId branch=$branch")
        // Both survive the try so `finally` can drop temp patches and the failure paths can drop a
        // worktree that was already created.
        var snapshot: WorktreeTransfer.Snapshot? = null
        var leftover: WorktreeDto? = null
        try {
            emit(MoveProgressDto(MoveStage.CAPTURING))
            val captured = withContext(Dispatchers.IO) { WorktreeTransfer.capture(base) }.also { snapshot = it }
            emit(MoveProgressDto(MoveStage.CREATING))
            // Not wrapped together with the later rollback()/remove() call below: that call takes its
            // own lock on this same repo, and Mutex is not reentrant, so nesting them would deadlock.
            // Each mutation only needs to be atomic on its own; the two never need to be atomic
            // together.
            val created = withContext(Dispatchers.IO) {
                lock(base, "move-create") { addWorktree(base, branch.trim(), existing = false, baseRef = captured.head) }
            }
            val worktree = created.worktree ?: run {
                emit(MoveProgressDto(MoveStage.ERROR, error = created.error ?: "Failed to create worktree"))
                return@flow
            }
            leftover = worktree
            val target = Path.of(worktree.path).normalize()
            emit(MoveProgressDto(MoveStage.TRANSFERRING))
            val applied = withContext(Dispatchers.IO) { WorktreeTransfer.apply(captured, target) }
            if (!applied.ok) {
                leftover = null
                rollback(directory, worktree, branch, "transfer failure")
                emit(MoveProgressDto(MoveStage.ERROR, error = applied.error ?: "Failed to apply changes to worktree"))
                return@flow
            }
            // A session-less move transfers changes only: nothing to fork, so no FORKING stage.
            val forked = sessionId?.let { id ->
                emit(MoveProgressDto(MoveStage.FORKING))
                withContext(Dispatchers.IO) {
                    val app = service<KiloBackendAppService>()
                    app.sessions.fork(id, worktree.path).also {
                        // Same handoff every fork path records: the session moved directory, and the
                        // copied context still names the old one.
                        ForkHandoff.record(app.chat, it.id, worktree.path)
                    }
                }
            }
            leftover = null
            LOG.info("worktree move done: worktree=${worktree.path} session=${forked?.id}")
            emit(MoveProgressDto(MoveStage.DONE, worktree = worktree, session = forked?.id))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            LOG.warn("worktree move failed: dir=$base session=$sessionId branch=$branch", e)
            leftover?.let { rollback(directory, it, branch, "move failure") }
            emit(MoveProgressDto(MoveStage.ERROR, error = e.message ?: "Failed to move session to a worktree"))
        } finally {
            withContext(Dispatchers.IO) { WorktreeTransfer.cleanup(snapshot) }
        }
    }

    /**
     * Drops a worktree created earlier in a failed move so a retry is not blocked by leftovers.
     * Deliberately calls the public [remove] rather than [removeManaged] directly: [remove] takes
     * its own lock on this repo, which is safe here specifically because nothing on this call path
     * is still holding it — the lock taken for the original `addWorktree` call in [moveToWorktree]
     * was released as soon as that call returned.
     */
    private suspend fun rollback(directory: String, worktree: WorktreeDto, branch: String, reason: String) {
        LOG.warn("worktree move: rolling back ${worktree.path} after $reason")
        runCatching { remove(directory, worktree.path, branch, force = true) }
            .onFailure { err -> LOG.warn("worktree move: rollback of ${worktree.path} failed", err) }
    }

    /** Detects a linked (non-primary) worktree: its git-dir differs from the shared common git-dir. */
    private fun isLinkedWorktree(root: Path): Boolean {
        val res = runGit(root, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir")
        if (!res.ok) return false
        val lines = res.stdout.lines().map { it.trim() }.filter { it.isNotEmpty() }
        if (lines.size < 2) return false
        return Path.of(lines[0]).normalize() != Path.of(lines[1]).normalize()
    }

    /** Main working tree for the repo containing [base]; falls back to [base] when git fails. */
    private fun mainWorktree(base: Path): Path {
        val res = runGit(base, "worktree", "list", "--porcelain")
        if (!res.ok) return base
        val main = parseWorktreeList(res.stdout).firstOrNull { it.main } ?: return base
        return Path.of(main.path).normalize()
    }

    /** Branch checked out in the main working tree of the repo containing [root]. */
    private fun baseBranch(root: Path): String? {
        val res = runGit(root, "worktree", "list", "--porcelain")
        if (!res.ok) return null
        return baseBranch(parseWorktreeList(res.stdout))
    }

    /**
     * Drops the PR and branch caches so the next poll reflects a mutation immediately. Entries are
     * keyed by the requesting directory and a mutation can change any repository the backend has
     * answered for, so clear wholesale rather than by key.
     */
    private fun invalidate() {
        prs.clear()
        branches.clear()
    }

    /**
     * Runs [block] while holding the mutation lock for the repository rooted at [base]'s main
     * worktree. Every discrete git-mutating RPC (create/import/remove/rename/adopt/reorder/session
     * list) goes through this; read paths never do.
     *
     * Deliberately not reentrant-safe: [Mutex] is not reentrant, and nothing here nests two locked
     * calls within one call stack. [rollback] calls the public [remove] specifically *without* this
     * wrapping — [remove] takes its own lock, and an outer lock held across that call would deadlock.
     */
    private suspend fun <T> lock(base: Path, op: String, block: suspend () -> T): T {
        val key = mainWorktree(base).toString()
        val mutex = locks.computeIfAbsent(key) { Mutex() }
        if (mutex.isLocked) {
            val start = System.currentTimeMillis()
            return mutex.withLock {
                val waited = System.currentTimeMillis() - start
                if (waited >= LOCK_WAIT_LOG_THRESHOLD_MS) LOG.info("worktree lock waited: op=$op base=$base ms=$waited")
                block()
            }
        }
        return mutex.withLock { block() }
    }

    /**
     * Drops any worktree currently being removed (see [WorktreeTrash]) so [stats], [dirty],
     * [prStatus], and [list] never fan out into a directory that is disappearing underneath them.
     * A no-op when [trash] is unavailable, which is also the state in which nothing is ever actually
     * mid-removal via the fast path.
     */
    private fun live(items: List<WorktreeDto>): List<WorktreeDto> {
        val t = trash ?: return items
        val (deleting, kept) = items.partition { !it.main && t.doomed(it.path) }
        if (deleting.isNotEmpty()) {
            LOG.info("worktree poll excluded deleting worktrees: ${deleting.joinToString(", ") { it.path }}")
        }
        return kept
    }

    override suspend fun create(directory: String, request: CreateWorktreeRequestDto): CreateWorktreeResultDto =
        withContext(Dispatchers.IO) {
            val base = Path.of(directory).normalize()
            val branch = request.branch.trim()
            if (branch.isEmpty()) return@withContext CreateWorktreeResultDto(error = "Branch name is required")
            lock(base, "create") { addWorktree(base, branch, request.existingBranch, request.baseBranch) }
        }

    override suspend fun importPr(directory: String, url: String): CreateWorktreeResultDto =
        withContext(Dispatchers.IO) {
            val base = Path.of(directory).normalize()
            val ref = parsePrUrl(url) ?: return@withContext CreateWorktreeResultDto(error = "Enter a valid GitHub pull request URL")
            lock(base, "import") {
                when (ghAvailable(base)) {
                    GhAvailability.GIT_MISSING -> return@lock CreateWorktreeResultDto(error = "Git is not installed")
                    GhAvailability.MISSING -> return@lock CreateWorktreeResultDto(error = "GitHub CLI (gh) is not installed")
                    GhAvailability.UNAUTH -> return@lock CreateWorktreeResultDto(error = "GitHub CLI (gh) is not authorized")
                    // Stated rather than attempted: the import runs several gh calls and the first would
                    // fail anyway, so say why instead of leaving a half-made worktree behind.
                    GhAvailability.RATE_LIMITED -> return@lock CreateWorktreeResultDto(
                        error = "GitHub is rate limiting this token. Try again later.",
                    )
                    GhAvailability.OK -> Unit
                }
                val fields = "headRefName,title,isCrossRepository,headRepositoryOwner"
                val view = runGh(base, "pr", "view", ref.number.toString(), "--repo", "${ref.owner}/${ref.repo}", "--json", fields)
                if (!view.ok) {
                    LOG.warn("pr import view failed: url=$url exit=${view.exit} stderr=${view.stderr.trim()}")
                    return@lock CreateWorktreeResultDto(error = view.stderr.ifBlank { "gh pr view failed" })
                }
                val head = parsePrHead(view.stdout)
                val branch = prBranchName(head, ref.number)
                val failure = fetchPrBranch({ args -> runGit(base, args) }, ref.number, head, branch)
                if (failure != null) {
                    LOG.warn("pr import fetch failed: url=$url exit=${failure.exit} stderr=${failure.stderr.trim()}")
                    return@lock CreateWorktreeResultDto(error = failure.stderr.ifBlank { "Failed to check out the pull request branch" })
                }
                addWorktree(base, branch, existing = true, baseRef = null)
            }
        }

    /** Runs `git worktree add` under `<base>/.kilo/worktrees/<slug>` and records list bookkeeping. */
    private fun addWorktree(base: Path, branch: String, existing: Boolean, baseRef: String?): CreateWorktreeResultDto {
        val root = mainWorktree(base)
        val storage = root.resolve(".kilo").resolve("worktrees").normalize()
        val parts = branch.split('/')
        if (parts.any { it.isBlank() || it == "." || it == ".." }) return CreateWorktreeResultDto(error = "Invalid branch name")
        val dir = storage.resolve(branch.replace('/', '-')).normalize()
        if (dir.parent != storage) return CreateWorktreeResultDto(error = "Invalid branch name")
        Files.createDirectories(dir.parent)
        val args = buildList {
            addAll(listOf("worktree", "add"))
            if (existing) {
                add(dir.toString())
                add(branch)
            } else {
                add("-b")
                add(branch)
                add(dir.toString())
                baseRef?.trim()?.takeIf { it.isNotEmpty() }?.let { add(it) }
            }
        }
        LOG.info("worktree add requested: branch=$branch existing=$existing base=${baseRef ?: "(current)"} dir=$dir")
        val res = add(base, args)
        if (!res.ok) {
            LOG.warn("worktree add failed: branch=$branch exit=${res.exit} stderr=${res.stderr.trim()}")
            return CreateWorktreeResultDto(error = res.stderr.ifBlank { "git worktree add failed" })
        }
        LOG.info("worktree created: branch=$branch dir=$dir")
        invalidate()
        val path = dir.toRealPath().toString()
        val list = runGit(base, "worktree", "list", "--porcelain")
        val items = if (list.ok) managedWorktrees(parseWorktreeList(list.stdout)) else emptyList()
        val store = worktreeNameStore(items) ?: base.resolve(".kilo").resolve(WORKTREE_NAMES_FILE)
        val paths = worktreePaths(items).ifEmpty { listOf(path) }
        prependWorktreeOrder(store, path, paths)
        return CreateWorktreeResultDto(worktree = WorktreeDto(path, dir.fileName.toString(), branch, path))
    }

    override suspend fun remove(directory: String, path: String, branch: String?, force: Boolean): RemoveWorktreeResultDto =
        withContext(Dispatchers.IO) {
            val base = Path.of(directory).normalize()
            val start = System.currentTimeMillis()
            LOG.info("worktree remove requested: path=$path branch=${branch ?: "(none)"} force=$force base=$base")
            lock(base, "remove") {
                val list = runGit(base, "worktree", "list", "--porcelain")
                if (!list.ok) {
                    LOG.warn("worktree remove rejected: reason=list-failed path=$path exit=${list.exit} stderr=${snippet(list.stderr)}")
                    return@lock RemoveWorktreeResultDto(error = list.stderr.ifBlank { "git worktree list failed" })
                }
                val all = parseWorktreeList(list.stdout)
                val items = managedWorktrees(all)
                val main = all.firstOrNull { it.main }
                val storage = main?.let { Path.of(it.path).normalize().resolve(".kilo").resolve("worktrees").normalize() }
                val target = all.firstOrNull {
                    val item = Path.of(it.path).normalize()
                    !it.main && samePath(it.path, path) && item.parent == storage
                }
                if (target == null) {
                    LOG.warn("worktree remove rejected: reason=unmanaged path=$path")
                    return@lock RemoveWorktreeResultDto(error = "Refusing to remove unmanaged worktree: $path")
                }
                // Compare canonical (symlink-resolved) paths: on macOS the temp/repo root is a symlink
                // (/var -> /private/var), so a raw startsWith against normalized porcelain paths would miss
                // a live child and let `git worktree remove --force` delete it recursively.
                val root = realPath(path)
                val nested = all.filter {
                    !it.prunable && Files.isDirectory(Path.of(it.path)) && !samePath(it.path, path) && realPath(it.path).startsWith(root)
                }
                if (nested.isNotEmpty()) {
                    val names = nested.joinToString("\n") { it.path }
                    LOG.warn("worktree remove rejected: reason=nested path=$path blockers=${nested.joinToString(", ") { it.path }}")
                    return@lock RemoveWorktreeResultDto(error = "Delete nested worktrees first:\n$names")
                }
                val store = worktreeNameStore(items) ?: base.resolve(".kilo").resolve(WORKTREE_NAMES_FILE)
                trash?.mark(target.path)
                try {
                    removeManaged(base, target, branch, force, store, storage, start)
                } finally {
                    trash?.unmark(target.path)
                }
            }
        }

    /**
     * Performs the actual removal of [target], once it has been validated as a managed, non-nested
     * worktree and marked in [WorktreeTrash]. Prefers an atomic rename to a `.kilo-delete-*` sibling
     * so the RPC never blocks on the recursive filesystem delete; falls back to a synchronous
     * `git worktree remove --force` when [trash] is unavailable, the rename fails (e.g. cross-device),
     * or the worktree is locked without [force] — a lock check has to go through git itself so
     * `locked` is reported correctly, and a filesystem rename cannot see or honor a git lock at all.
     */
    private fun removeManaged(
        base: Path,
        target: WorktreeDto,
        branch: String?,
        force: Boolean,
        store: Path,
        storage: Path?,
        start: Long,
    ): RemoveWorktreeResultDto {
        // Force means the user accepted removing a locked worktree; unlock first so the plain
        // remove succeeds. Unlock fails harmlessly when the tree isn't actually locked.
        if (force) {
            val unlock = runGit(base, "worktree", "unlock", target.path)
            if (!unlock.ok) LOG.info("worktree unlock skipped: path=${target.path} exit=${unlock.exit} stderr=${unlock.stderr.trim()}")
        }
        val targetPath = Path.of(target.path)
        // Only skip git's own removal when the checkout directory is actually gone. Git also flags a
        // worktree prunable when its admin metadata is stale while the files remain; those must still
        // be deleted so a later create of the same slug is not blocked by leftovers.
        val outcome: Triple<String, CmdOut, Path?> = when {
            !Files.isDirectory(targetPath) -> Triple("prune-only", CmdOut(0, "", ""), null)
            target.locked && !force -> {
                val r = runGit(base, listOf("worktree", "remove", "--force", target.path), REMOVE_TIMEOUT_MS)
                LOG.info("worktree remove git: path=${target.path} exit=${r.exit} ms=${System.currentTimeMillis() - start} timeout=${r.timeout}")
                Triple("git", r, null)
            }
            else -> {
                val temp = trash?.stage(targetPath)
                if (temp != null) {
                    LOG.info("worktree remove staged: path=${target.path} temp=$temp ms=${System.currentTimeMillis() - start}")
                    Triple("rename", CmdOut(0, "", ""), temp)
                } else {
                    LOG.info(
                        "worktree remove fallback: path=${target.path} " +
                            "reason=${if (trash == null) "trash-unavailable" else "rename-failed"}",
                    )
                    val r = runGit(base, listOf("worktree", "remove", "--force", target.path), REMOVE_TIMEOUT_MS)
                    LOG.info("worktree remove git: path=${target.path} exit=${r.exit} ms=${System.currentTimeMillis() - start} timeout=${r.timeout}")
                    Triple("git", r, null)
                }
            }
        }
        val (mode, res, staged) = outcome
        if (!res.ok) {
            val locked = res.stderr.contains("locked working tree", ignoreCase = true)
            LOG.warn(
                "worktree remove failed: path=${target.path} locked=$locked timeout=${res.timeout} " +
                    "exit=${res.exit} stderr=${snippet(res.stderr)}",
            )
            return RemoveWorktreeResultDto(error = reason(res, "git worktree remove failed"), locked = locked)
        }
        // Every successful arm arrives here with no checkout at the registered path — renamed away,
        // deleted by git, or already gone before this call started — so unregistering is always both
        // safe and needed. It has to happen before `branch -D`: git refuses to delete a branch that a
        // registered worktree still has checked out, so pruning afterwards would leave the branch
        // behind (the `git` arm has already unregistered it, making this a no-op there). `--expire now`
        // because the default grace period is three months, which for a checkout that is already gone
        // would mean not pruning it at all. This also clears unrelated dangling entries.
        val prune = runGit(base, "worktree", "prune", "--expire", "now")
        if (!prune.ok) {
            LOG.warn("worktree prune failed: path=${target.path} exit=${prune.exit} stderr=${snippet(prune.stderr)}")
        }
        // The worktree is gone; a failed branch delete must not fail the removal, only warn.
        branch?.trim()?.takeIf { it.isNotEmpty() }?.let {
            val del = runGit(base, "branch", "-D", it)
            if (!del.ok) LOG.warn("worktree branch delete failed: branch=$it exit=${del.exit} stderr=${del.stderr.trim()}")
        }
        staged?.let { trash?.reap(it) }
        LOG.info("worktree removed: path=${target.path} branch=${branch ?: "(none)"} mode=$mode ms=${System.currentTimeMillis() - start}")
        invalidate()
        removeWorktreeState(store, target.path)
        runCatching { service<KiloBackendAppService>().workspaces.remove(target.path) }
            .onFailure { err -> LOG.info("workspace cache eviction skipped: path=${target.path} message=${err.message}") }
        storage?.let { trash?.sweep(it) }
        return RemoveWorktreeResultDto(ok = true)
    }

    override suspend fun rename(directory: String, path: String, name: String): RenameWorktreeResultDto =
        withContext(Dispatchers.IO) {
            val title = name.trim()
            if (title.isEmpty()) return@withContext RenameWorktreeResultDto(error = "Name is required")
            val base = Path.of(directory).normalize()
            lock(base, "rename") {
                val res = runGit(base, "worktree", "list", "--porcelain")
                if (!res.ok) return@lock RenameWorktreeResultDto(error = res.stderr.ifBlank { "git worktree list failed" })
                val items = managedWorktrees(parseWorktreeList(res.stdout))
                val store = worktreeNameStore(items)
                    ?: return@lock RenameWorktreeResultDto(error = "Main worktree not found")
                val target = items.firstOrNull { samePath(it.path, path) && !it.main }
                    ?: return@lock RenameWorktreeResultDto(error = "Worktree not found")
                try {
                    val state = readWorktreeState(store).reconcile(worktreePaths(items), livePaths(items))
                    val names = state.names.toMutableMap()
                    names[target.path] = title
                    writeWorktreeState(store, state.copy(names = names))
                    RenameWorktreeResultDto(worktree = target.copy(name = title))
                } catch (e: Exception) {
                    LOG.warn("worktree rename failed: path=$path message=${e.message}", e)
                    RenameWorktreeResultDto(error = e.message ?: "worktree rename failed")
                }
            }
        }

    override suspend fun adopt(directory: String, path: String, name: String): RenameWorktreeResultDto =
        withContext(Dispatchers.IO) {
            val title = name.trim()
            if (title.isEmpty()) return@withContext RenameWorktreeResultDto()
            val base = Path.of(directory).normalize()
            lock(base, "adopt") {
                val res = runGit(base, "worktree", "list", "--porcelain")
                if (!res.ok) return@lock RenameWorktreeResultDto(error = res.stderr.ifBlank { "git worktree list failed" })
                val items = managedWorktrees(parseWorktreeList(res.stdout))
                val store = worktreeNameStore(items)
                    ?: return@lock RenameWorktreeResultDto(error = "Main worktree not found")
                val target = items.firstOrNull { samePath(it.path, path) && !it.main }
                    ?: return@lock RenameWorktreeResultDto(error = "Worktree not found")
                try {
                    val state = readWorktreeState(store).reconcile(worktreePaths(items), livePaths(items))
                    val names = state.names.toMutableMap()
                    // Only adopt while the worktree is still default. A recorded name means the user (or a
                    // prior adoption) already titled it, so leave it untouched and report a no-op.
                    if (!names[target.path].isNullOrBlank()) return@lock RenameWorktreeResultDto()
                    names[target.path] = title
                    writeWorktreeState(store, state.copy(names = names))
                    LOG.info("worktree name adopted: path=$path name=$title")
                    RenameWorktreeResultDto(worktree = target.copy(name = title))
                } catch (e: Exception) {
                    LOG.warn("worktree adopt failed: path=$path message=${e.message}", e)
                    RenameWorktreeResultDto(error = e.message ?: "worktree adopt failed")
                }
            }
        }

    override suspend fun reorder(directory: String, paths: List<String>): Boolean =
        withContext(Dispatchers.IO) {
            val base = Path.of(directory).normalize()
            lock(base, "reorder") {
                val res = runGit(base, "worktree", "list", "--porcelain")
                if (!res.ok) return@lock false
                val items = managedWorktrees(parseWorktreeList(res.stdout))
                val store = worktreeNameStore(items) ?: return@lock false
                try {
                    val state = readWorktreeState(store)
                    writeWorktreeState(store, state.copy(worktreeOrder = paths).reconcile(worktreePaths(items), livePaths(items)))
                    true
                } catch (e: Exception) {
                    LOG.warn("worktree reorder failed: dir=$directory message=${e.message}", e)
                    false
                }
            }
        }

    override suspend fun sessionList(directory: String): Boolean? =
        withContext(Dispatchers.IO) {
            val base = Path.of(directory).normalize()
            val res = runGit(base, "worktree", "list", "--porcelain")
            if (!res.ok) return@withContext null
            val items = managedWorktrees(parseWorktreeList(res.stdout))
            val store = worktreeNameStore(items) ?: return@withContext null
            val target = items.firstOrNull { samePath(it.path, directory) } ?: return@withContext null
            readWorktreeState(store).sessionList[target.path]
        }

    override suspend fun setSessionList(directory: String, visible: Boolean): Boolean =
        withContext(Dispatchers.IO) {
            val base = Path.of(directory).normalize()
            lock(base, "session-list") {
                val res = runGit(base, "worktree", "list", "--porcelain")
                if (!res.ok) return@lock false
                val items = managedWorktrees(parseWorktreeList(res.stdout))
                val store = worktreeNameStore(items) ?: return@lock false
                val target = items.firstOrNull { samePath(it.path, directory) } ?: return@lock false
                try {
                    val state = readWorktreeState(store).reconcile(worktreePaths(items), livePaths(items))
                    writeWorktreeState(store, state.copy(sessionList = state.sessionList + (target.path to visible)))
                    true
                } catch (e: Exception) {
                    LOG.warn("worktree session list state failed: dir=$directory message=${e.message}", e)
                    false
                }
            }
        }

    private data class Timed<T>(val time: Long, val value: T)

    private fun runGit(base: Path, vararg args: String): CmdOut = runGit(base, args.toList())

    private fun runGit(base: Path, args: List<String>, timeoutMs: Int = GIT_COMMAND_TIMEOUT_MS): CmdOut =
        runGitCommand(base, args, timeoutMs)

    private fun runGh(base: Path, vararg args: String): CmdOut = runGh(base, args.toList())

    private fun runGh(base: Path, args: List<String>): CmdOut {
        return try {
            val cmd = GeneralCommandLine(listOf("gh") + args)
                .withWorkDirectory(base.toFile())
                .withParentEnvironmentType(ParentEnvironmentType.CONSOLE)
            val out = CapturingProcessHandler(cmd).runProcess(30_000)
            if (out.isTimeout) LOG.warn("gh command timed out: dir=$base args=${args.joinToString(" ")} ms=30000")
            CmdOut(if (out.isTimeout) -1 else out.exitCode, out.stdout, out.stderr, out.isTimeout)
        } catch (e: Exception) {
            CmdOut(-1, "", e.message ?: "gh failed")
        }
    }

    private fun add(base: Path, args: List<String>): CmdOut {
        val first = runGit(base, *args.toTypedArray())
        if (first.ok || !stale(first.stderr)) return first
        val prune = runGit(base, "worktree", "prune")
        if (!prune.ok) LOG.warn("worktree prune before retry failed: exit=${prune.exit} stderr=${prune.stderr.trim()}")
        return runGit(base, *args.toTypedArray())
    }

    private fun stale(text: String): Boolean {
        return text.contains("is already checked out", ignoreCase = true) ||
            text.contains("already used by worktree", ignoreCase = true) ||
            text.contains("missing but already registered worktree", ignoreCase = true)
    }

    private suspend fun <T, R> parallel(items: List<T>, block: suspend (T) -> R): List<R> = coroutineScope {
        val sem = Semaphore(4)
        items.map { item -> async { sem.withPermit { block(item) } } }.map { it.await() }
    }

    /**
     * [stats] for one worktree, isolated so a directory that vanished between [sync]'s check and
     * this call (deleted by another process, or mid the fallback `git worktree remove --force`
     * still running in the background) cannot cancel every other worktree's result through
     * [parallel]'s shared [coroutineScope]. See [badDir] for the two exception shapes this expects.
     */
    internal fun statsSafe(item: WorktreeDto, fallback: String): WorktreeStatsDto = runCatching {
        stats(item, fallback)
    }.getOrElse { err ->
        if (err is CancellationException) throw err
        if (badDir(err.message.orEmpty())) {
            LOG.info("worktree poll skipped: op=stats path=${item.path} reason=gone")
        } else {
            LOG.warn("worktree poll failed: op=stats path=${item.path} message=${err.message}", err)
        }
        WorktreeStatsDto(item.path)
    }

    private fun stats(item: WorktreeDto, fallback: String): WorktreeStatsDto {
        val dir = Path.of(item.path).normalize()
        val comparison = GitComparison.open(dir, GitComparison.Mode.Base, fallback) ?: return WorktreeStatsDto(item.path)
        val files = comparison.files(false)
        val counts = comparison.counts()
        return WorktreeStatsDto(
            item.path,
            additions = files.sumOf { it.additions },
            deletions = files.sumOf { it.deletions },
            ahead = counts.second,
            behind = counts.first,
            files = files.size,
            base = comparison.base,
        )
    }

    /** [dirty] for one worktree, isolated the same way [statsSafe] isolates [stats]. */
    internal fun dirtySafe(item: WorktreeDto): WorktreeDirtyDto = runCatching {
        dirty(item)
    }.getOrElse { err ->
        if (err is CancellationException) throw err
        if (badDir(err.message.orEmpty())) {
            LOG.info("worktree poll skipped: op=dirty path=${item.path} reason=gone")
        } else {
            LOG.warn("worktree poll failed: op=dirty path=${item.path} message=${err.message}", err)
        }
        WorktreeDirtyDto(item.path)
    }

    private fun dirty(item: WorktreeDto): WorktreeDirtyDto {
        val dir = Path.of(item.path).normalize()
        val comparison = GitComparison.open(dir, GitComparison.Mode.Local) ?: return WorktreeDirtyDto(item.path)
        val files = comparison.files(false)
        return WorktreeDirtyDto(
            item.path,
            additions = files.sumOf { it.additions },
            deletions = files.sumOf { it.deletions },
            files = files.size,
            untracked = files.count { it.status == "untracked" },
            unpushed = comparison.unpushed(),
        )
    }

    /**
     * Resolves git/gh availability. When [github] is false, only git presence is checked and `gh`
     * is never spawned — used while the user has turned off the GitHub integration setting.
     */
    private fun ghAvailable(root: Path, github: Boolean = true, maxAge: Long? = null): GhAvailability {
        if (!Files.isDirectory(root)) {
            LOG.info("gh availability skipped dir=$root missing=true")
            return GhAvailability.OK
        }
        val status = probeGh(root, "availability", github, maxAge)
        // A git-only probe can only return GIT_MISSING or OK, so the gh-binary re-check below is
        // unreachable while github is false; the guard documents that explicitly.
        if (!github || status != GhAvailability.MISSING) return status
        val now = System.currentTimeMillis()
        // Installing gh is the transition this long-lived entry hides, so a caller demanding
        // freshness must be able to re-check the binary and not just the auth verdict.
        ghProbe?.takeIf { usable(it.time, now, GH_PROBE_TTL, maxAge) }?.let { return it.value }
        val res = runGh(root, "--version")
        val value = if (res.ok) GhAvailability.OK else GhAvailability.MISSING
        ghProbe = Timed(now, value)
        return value
    }

    /**
     * Resolves git/gh availability. When [github] is false, resolves git presence only and never
     * spawns `gh` or touches [ghCache] (the cache mixes gh-auth verdicts with a boolean this probe
     * would otherwise poison with a git-only "OK").
     */
    private fun probeGh(root: Path, reason: String, github: Boolean = true, maxAge: Long? = null): GhAvailability = synchronized(ghLock) {
        // A stale/removed worktree directory makes the process spawn fail, which would be
        // misreported as GIT_MISSING. Treat a missing directory as "nothing to report" and
        // don't cache it, so the next probe on a real directory still runs.
        if (!Files.isDirectory(root)) {
            LOG.info("gh probe skipped reason=$reason dir=$root missing=true")
            return@synchronized GhAvailability.OK
        }
        // The frontend GhStatusCoordinator only ever probes the main repo root (project.kiloRoot()),
        // which is never doomed itself, so this only matters when the open project *is* a worktree
        // being deleted from another window — but the RPC is directory-scoped, not project-scoped,
        // so it must still be checked here rather than relying on that caller behavior.
        if (trash?.doomed(root.toString()) == true) {
            LOG.info("worktree poll skipped: op=gh path=$root reason=deleting")
            return@synchronized GhAvailability.OK
        }
        val now = System.currentTimeMillis()
        if (github) {
            ghCache?.takeIf { usable(it.time, now, ghTtl(it.value), maxAge) }?.let {
                LOG.info("gh probe cache hit reason=$reason value=${it.value} ageMs=${now - it.time}")
                return@synchronized it.value
            }
        }
        val start = System.currentTimeMillis()
        LOG.info("gh probe start reason=$reason dir=$root github=$github maxAge=${maxAge ?: "default"}")
        val git = runGit(root, "--version")
        if (!git.ok) {
            // The directory can disappear between the check above and the spawn; a failed working
            // directory is not evidence that git is uninstalled, so report nothing in that case.
            if (badDir(git.stderr)) {
                LOG.info("gh probe skipped reason=$reason dir=$root badDir=true stderr=${snippet(git.stderr)}")
                return@synchronized GhAvailability.OK
            }
            val value = GhAvailability.GIT_MISSING
            if (github) ghCache = Timed(System.currentTimeMillis(), value)
            LOG.info("gh probe result reason=$reason value=$value exit=${git.exit} ms=${System.currentTimeMillis() - start} stderr=${snippet(git.stderr)}")
            return@synchronized value
        }
        if (!github) {
            LOG.info("gh probe result reason=$reason value=OK github=false ms=${System.currentTimeMillis() - start}")
            return@synchronized GhAvailability.OK
        }
        val res = runGh(root, "auth", "status")
        val value = if (res.ok) GhAvailability.OK else classifyGhError(res.stderr.ifBlank { res.stdout })
        ghCache = Timed(System.currentTimeMillis(), value)
        LOG.info("gh probe result reason=$reason value=$value exit=${res.exit} ms=${System.currentTimeMillis() - start} stderr=${snippet(res.stderr)}")
        value
    }

    /** How long a cached gh verdict may be served. See [GH_LIMIT_TTL] for why one value is special. */
    private fun ghTtl(value: GhAvailability): Long =
        if (value == GhAvailability.RATE_LIMITED) GH_LIMIT_TTL else GH_STATUS_TTL

    private fun snippet(text: String): String {
        return text.trim().replace(Regex("\\s+"), " ").take(180)
    }

    /**
     * Human-readable failure reason for [res]. A timed-out process is reported as such — its stderr
     * is whatever it managed to flush before being killed, usually blank — rather than falling
     * through to [fallback] and reading as an unexplained failure.
     */
    internal fun reason(res: CmdOut, fallback: String): String {
        if (res.timeout) return "timed out"
        return res.stderr.ifBlank { fallback }
    }

}

/**
 * Whether a cache entry written at [time] may still be served. [maxAge] is the caller's own ceiling
 * on staleness: it can only tighten [ttl], never extend it, so an event-driven request can reject an
 * entry the poll would have accepted while no caller is able to pin stale data in place past the TTL.
 * A [maxAge] of 0 (or below) rejects every entry and forces the work to run.
 */
internal fun usable(time: Long, now: Long, ttl: Long, maxAge: Long?): Boolean {
    val limit = maxAge?.coerceIn(0, ttl) ?: ttl
    return now - time < limit
}

/**
 * True when a command failed because its working directory disappeared out from under it, not
 * because the tool is absent or broken. Covers two distinct message shapes for the same race: the
 * platform's own process-spawn failure (`Cannot start a process, the working directory '...' does
 * not exist`) when the directory is already gone before the process starts, and git's own
 * `fatal: Unable to read current working directory: No such file or directory` when a worktree is
 * renamed or deleted after the process starts but before it calls `getcwd()` — exactly the race a
 * concurrent worktree removal (staged rename, or the synchronous fallback `git worktree remove`)
 * can cause mid-poll.
 */
internal fun badDir(text: String): Boolean {
    val msg = text.lowercase()
    if (msg.contains("working directory") && (msg.contains("does not exist") || msg.contains("not a directory"))) return true
    return msg.contains("unable to read current working directory")
}

internal fun classifyGhError(text: String): GhAvailability {
    val msg = text.lowercase()
    if (msg.contains("not logged") || msg.contains("gh auth login") || msg.contains("authentication")) return GhAvailability.UNAUTH
    // Only treat process-spawn failures as MISSING. A bare "not found" match would misclassify
    // transient gh auth failures (e.g. a GitHub Enterprise 404 or revoked token) as an uninstalled gh;
    // scope to spawn/shell signals instead.
    if (msg.contains("cannot run program") || msg.contains("no such file") || msg.contains("command not found")) return GhAvailability.MISSING
    // `gh auth status` validates the token against the API, so it is usually the first command to be
    // told the budget is spent. Checked after the auth wordings above: a rate-limited response says
    // nothing about whether the token is valid, so it must not be reported as a login problem.
    if (rateLimited(msg)) return GhAvailability.RATE_LIMITED
    return GhAvailability.OK
}

internal fun parsePr(path: String, raw: String): WorktreePrDto? {
    val obj = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: return null
    val number = obj["number"]?.jsonPrimitive?.intOrNull ?: return null
    val url = obj["url"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() } ?: return null
    val title = obj["title"]?.jsonPrimitive?.content?.trim().orEmpty()
    val draft = obj["isDraft"]?.jsonPrimitive?.booleanOrNull == true
    val state = if (draft) GhState.DRAFT else when (obj["state"]?.jsonPrimitive?.content?.uppercase()) {
        "MERGED" -> GhState.MERGED
        "CLOSED" -> GhState.CLOSED
        else -> GhState.OPEN
    }
    return WorktreePrDto(path, number, state, url, title, parseReview(obj), parseChecks(obj), merge = parseMerge(obj))
}

/**
 * Reads GitHub's `mergeable`. Absent, unrequested, and `UNKNOWN` all mean the same thing: nobody has said
 * the branches conflict. They must not collapse into [GhMerge.CLEAN] — GitHub recomputes mergeability after
 * every push and answers `UNKNOWN` until it finishes, so a missing verdict is a verdict not yet given.
 */
internal fun parseMerge(obj: JsonObject): GhMerge = when (obj["mergeable"]?.jsonPrimitive?.contentOrNull?.uppercase()) {
    "CONFLICTING" -> GhMerge.CONFLICTING
    "MERGEABLE" -> GhMerge.CLEAN
    else -> GhMerge.UNKNOWN
}

/**
 * Reads GitHub's `reviewDecision`. Absent when the field was not requested, when the repository asks
 * for no review, or when this `gh` could not answer it — all of which mean "nothing to show".
 */
internal fun parseReview(obj: JsonObject): GhReview {
    return when (obj["reviewDecision"]?.jsonPrimitive?.contentOrNull?.uppercase()) {
        "APPROVED" -> GhReview.APPROVED
        "CHANGES_REQUESTED" -> GhReview.CHANGES_REQUESTED
        "REVIEW_REQUIRED" -> GhReview.PENDING
        else -> GhReview.NONE
    }
}

/**
 * Rolls GitHub's `statusCheckRollup` up into counts and one verdict.
 *
 * A rollup entry is either a check run (`conclusion`, still empty while it runs, plus `status`) or a
 * legacy commit status (`state`), so the verdict is read from whichever the entry carries. Skipped
 * checks are excluded from [GhChecksDto.total] because GitHub does not count them either, and a single
 * failure outranks anything still running: a red build stays red however many jobs are queued behind it.
 */
internal fun parseChecks(obj: JsonObject): GhChecksDto {
    val items = obj["statusCheckRollup"] as? JsonArray ?: return GhChecksDto()
    var total = 0
    var passed = 0
    var failed = 0
    var pending = 0
    for (item in items) {
        val entry = item as? JsonObject ?: continue
        val raw = entry["conclusion"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
            ?: entry["state"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
            ?: entry["status"]?.jsonPrimitive?.contentOrNull
        when (checkState(raw)) {
            CheckState.SKIPPED -> continue
            CheckState.PASSED -> passed++
            CheckState.FAILED -> failed++
            CheckState.PENDING -> pending++
        }
        total++
    }
    val state = when {
        total == 0 -> GhChecks.NONE
        failed > 0 -> GhChecks.FAILED
        pending > 0 -> GhChecks.PENDING
        else -> GhChecks.PASSED
    }
    return GhChecksDto(state, total, passed, failed, pending)
}

/**
 * Reads the pull request's GraphQL node id out of a `gh pr view --json` payload, or an empty string when
 * this `gh` did not answer one. The id is what addresses the review-thread query, which has no
 * `--json` field of its own.
 */
internal fun parsePrNodeId(raw: String): String {
    val obj = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: return ""
    return obj["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
}

/**
 * Counts the review conversations in a `reviewThreads` GraphQL response.
 *
 * A thread with no `isResolved` at all counts as unresolved: the flag is only absent when GitHub omitted
 * it, and an omission is not evidence that someone resolved the thread. [GhCommentsDto.total] prefers
 * `totalCount` over the node count so it stays honest past the query's 100-thread page, even though the
 * unresolved figure cannot.
 */
internal fun parseThreads(raw: String): GhCommentsDto {
    val root = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: return GhCommentsDto()
    val data = root["data"] as? JsonObject ?: return GhCommentsDto()
    val threads = (data["node"] as? JsonObject)?.get("reviewThreads") as? JsonObject ?: return GhCommentsDto()
    val items = threads["nodes"] as? JsonArray ?: JsonArray(emptyList())
    val unresolved = items.count { (it as? JsonObject)?.get("isResolved")?.jsonPrimitive?.booleanOrNull != true }
    val total = threads["totalCount"]?.jsonPrimitive?.intOrNull ?: items.size
    return GhCommentsDto(total = total, unresolved = unresolved)
}

/** One rollup entry's verdict. [SKIPPED] is tracked only so it can be left out of the totals. */
internal enum class CheckState { PASSED, FAILED, PENDING, SKIPPED }

/**
 * Maps one rollup entry's conclusion, commit-status state, or run status to a verdict. An unknown or
 * missing value counts as pending: a check nobody recognises has not reported success, and calling it
 * a failure would paint rows red on GitHub's next new status name.
 */
internal fun checkState(raw: String?): CheckState = when (raw?.uppercase()) {
    "SUCCESS", "NEUTRAL" -> CheckState.PASSED
    "FAILURE", "ERROR", "ACTION_REQUIRED", "CANCELLED", "TIMED_OUT", "STALE", "STARTUP_FAILURE" -> CheckState.FAILED
    "SKIPPED" -> CheckState.SKIPPED
    else -> CheckState.PENDING
}

/** Head of a pull request being imported. */
internal data class PrHead(val ref: String = "", val cross: Boolean = false, val owner: String = "")

/** Reads the head branch and its repository out of a `gh pr view --json` payload. */
internal fun parsePrHead(raw: String): PrHead {
    val obj = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: return PrHead()
    val ref = obj["headRefName"]?.jsonPrimitive?.content?.trim().orEmpty()
    val cross = obj["isCrossRepository"]?.jsonPrimitive?.booleanOrNull == true
    val owner = (obj["headRepositoryOwner"] as? JsonObject)?.get("login")?.jsonPrimitive?.content?.trim().orEmpty()
    return PrHead(ref, cross, owner)
}

/**
 * Local branch name for an imported PR. Fork PRs are prefixed with their owner so two PRs sharing a
 * head branch name — `patch-1` is common — can be imported side by side.
 */
internal fun prBranchName(head: PrHead, number: Int): String {
    if (head.ref.isBlank()) return "pr-$number"
    val owner = head.owner.lowercase()
    return if (head.cross && owner.isNotEmpty()) "$owner/${head.ref}" else head.ref
}

/**
 * Fetches the PR head into [branch] and records which PR it belongs to, mirroring `gh pr checkout`:
 * a same-repo PR gets an ordinary upstream (so `git push`/`git pull` work in the imported worktree),
 * while a fork PR is tracked through `refs/pull/<number>/head`, which `gh` resolves back to the PR
 * by number. [run] executes git in the repository. Returns the failing command, or null on success.
 */
internal fun fetchPrBranch(run: (List<String>) -> CmdOut, number: Int, head: PrHead, branch: String): CmdOut? {
    val pull = "refs/pull/$number/head"
    // A fork head lives in a repository we may have no remote for. The pull ref reaches it without
    // adding one, and '+' force-updates a stale branch left by an earlier import attempt.
    if (head.cross || head.ref.isBlank()) {
        val fetch = run(listOf("fetch", "origin", "+$pull:$branch"))
        if (!fetch.ok) return fetch
        recordPrBranch(run, branch, pull)
        return null
    }
    val tracking = "refs/remotes/origin/${head.ref}"
    val direct = run(listOf("fetch", "origin", "+refs/heads/${head.ref}:$tracking"))
    if (!direct.ok) {
        // The head branch is gone — merged PR, or the author deleted it — but the pull ref survives.
        val fallback = run(listOf("fetch", "origin", "+$pull:$tracking"))
        if (!fallback.ok) return fallback
    }
    val point = run(listOf("branch", "--force", branch, tracking))
    if (!point.ok) return point
    recordPrBranch(run, branch, if (direct.ok) "refs/heads/${head.ref}" else pull)
    return null
}

/**
 * Records the branch's remote and merge ref. This is what lets a PR be recognised later without
 * guessing from the branch name, so a failure only degrades PR detection to slower lookups and must
 * never fail the import.
 */
private fun recordPrBranch(run: (List<String>) -> CmdOut, branch: String, merge: String) {
    listOf(
        listOf("config", "branch.$branch.remote", "origin"),
        listOf("config", "branch.$branch.merge", merge),
    ).forEach { args ->
        val res = run(args)
        if (!res.ok) {
            KiloWorktreeRpcApiImpl.LOG.warn("pr import config failed: args=$args exit=${res.exit} stderr=${res.stderr.trim()}")
        }
    }
}

private val json = Json { prettyPrint = true; ignoreUnknownKeys = true }
private val codec = MapSerializer(String.serializer(), String.serializer())
private const val WORKTREE_NAMES_FILE = "jetbrains.json"

@Serializable
private data class WorktreeNamesFile(
    val names: Map<String, String> = emptyMap(),
    val worktreeOrder: List<String> = emptyList(),
    val sessionList: Map<String, Boolean> = emptyMap(),
)

internal data class WorktreeState(
    val names: Map<String, String> = emptyMap(),
    val worktreeOrder: List<String> = emptyList(),
    val sessionList: Map<String, Boolean> = emptyMap(),
) {
    /**
     * Drops state for worktrees git no longer reports. Names and order cover linked worktrees only
     * ([paths]), while the session list is also kept for the main working tree, which has a worktree
     * editor of its own — hence the wider [live] set.
     */
    fun reconcile(paths: List<String>, live: List<String>): WorktreeState {
        val set = paths.toSet()
        val all = live.toSet()
        val order = (worktreeOrder.filter { it in set } + paths.filter { it !in worktreeOrder }).distinct()
        val next = names.filterKeys { it in set }
        val visible = sessionList.filterKeys { it in all }
        return WorktreeState(next, order, visible)
    }
}

/** Parse `git worktree list --porcelain`. First entry is the main working tree. */
internal fun parseWorktreeList(raw: String): List<WorktreeDto> {
    val out = mutableListOf<WorktreeDto>()
    var path: String? = null
    var branch = "(detached)"
    var locked = false
    var lockReason: String? = null
    var prunable = false
    var first = true
    fun flush() {
        val p = path ?: return
        val name = p.substringAfterLast('/').ifBlank { p }
        out.add(WorktreeDto(p, name, branch, p, main = first, locked = locked, lockReason = lockReason, prunable = prunable))
        first = false
        path = null
        branch = "(detached)"
        locked = false
        lockReason = null
        prunable = false
    }
    for (line in raw.lines()) {
        when {
            line.startsWith("worktree ") -> { flush(); path = line.removePrefix("worktree ").trim() }
            line.startsWith("branch ") -> branch = line.removePrefix("branch ").trim().removePrefix("refs/heads/")
            line == "locked" || line.startsWith("locked ") -> {
                locked = true
                lockReason = line.removePrefix("locked").trim().takeIf { it.isNotEmpty() }
            }
            line == "prunable" || line.startsWith("prunable ") -> prunable = true
            line.isBlank() -> flush()
        }
    }
    flush()
    return out
}

internal fun managedWorktrees(items: List<WorktreeDto>): List<WorktreeDto> {
    val main = items.firstOrNull { it.main } ?: return emptyList()
    val root = Path.of(main.path).normalize()
    val storage = root.resolve(".kilo").resolve("worktrees").normalize()
    return items.filter { item ->
        if (item.main) return@filter true
        if (item.prunable) return@filter false
        val path = Path.of(item.path).normalize()
        // A directory git still lists but whose name carries the delete-staging prefix is a
        // `WorktreeTrash` sibling mid-reap, not a worktree: it must never be presented or acted on
        // as one, however briefly git's own metadata still names it.
        if (path.fileName?.toString()?.startsWith(WorktreeTrash.PREFIX) == true) return@filter false
        path.parent == storage
    }
}

/**
 * Kilo-managed worktrees under `.kilo/worktrees/` whose checkout is gone. This is the only reason
 * [KiloWorktreeRpcApiImpl.sync] runs a prune, so a stale worktree the user keeps somewhere else is
 * never a reason for the plugin to touch git's administrative files on a polling loop.
 *
 * [trash] excludes a worktree already being removed through [WorktreeTrash]: it is about to become
 * stale by design (the removal renamed its directory away and will prune it itself), and letting a
 * concurrent poll's prune race that in-flight removal is pure risk for no benefit.
 */
internal fun staleWorktrees(items: List<WorktreeDto>, trash: WorktreeTrash? = null): List<WorktreeDto> {
    val main = items.firstOrNull { it.main } ?: return emptyList()
    val storage = Path.of(main.path).normalize().resolve(".kilo").resolve("worktrees").normalize()
    return items.filter { item ->
        if (item.main) return@filter false
        if (Path.of(item.path).normalize().parent != storage) return@filter false
        if (trash?.doomed(item.path) == true) return@filter false
        item.prunable || !Files.isDirectory(Path.of(item.path))
    }
}

/**
 * Worktrees eligible for a PR lookup. The main working tree is included — it can sit on a PR branch
 * just like a linked worktree — while detached heads have no branch to resolve and prunable entries
 * have no checkout left.
 */
internal fun prTargets(items: List<WorktreeDto>): List<WorktreeDto> {
    return items.filter { !it.prunable && it.branch != "(detached)" }
}

/** Branch checked out in the main working tree, or null when it is missing or detached. */
internal fun baseBranch(items: List<WorktreeDto>): String? {
    return items.firstOrNull { it.main }?.branch?.takeIf { it.isNotBlank() && it != "(detached)" }
}

internal fun overlayWorktreeNames(items: List<WorktreeDto>, names: Map<String, String>): List<WorktreeDto> {
    if (names.isEmpty()) return items
    return items.map { item ->
        val name = names[item.path]?.trim()
        if (item.main || name.isNullOrEmpty()) item else item.copy(name = name)
    }
}

internal fun orderWorktrees(items: List<WorktreeDto>, order: List<String>): List<WorktreeDto> {
    if (order.isEmpty()) return items
    val rank = order.withIndex().associate { it.value to it.index }
    val main = items.filter { it.main }
    val extra = items.filter { !it.main }
        .sortedWith(compareBy<WorktreeDto> { rank[it.path] ?: Int.MAX_VALUE }.thenBy { it.path })
    return main + extra
}

internal fun readWorktreeNames(file: Path): Map<String, String> {
    return readWorktreeState(file).names
}

internal fun readWorktreeState(file: Path): WorktreeState {
    if (!Files.exists(file)) return WorktreeState()
    return try {
        val raw = Files.readString(file)
        val element = json.parseToJsonElement(raw)
        if (element is JsonObject && ("names" in element || "worktreeOrder" in element || "sessionList" in element)) {
            val data = json.decodeFromJsonElement<WorktreeNamesFile>(element)
            return WorktreeState(
                data.names.filterValues { it.isNotBlank() },
                data.worktreeOrder.filter { it.isNotBlank() },
                data.sessionList.filterKeys { it.isNotBlank() },
            )
        }
        val names = json.decodeFromJsonElement(codec, element).filterValues { it.isNotBlank() }
        WorktreeState(names, names.keys.toList())
    } catch (e: Exception) {
        KiloWorktreeRpcApiImpl.LOG.warn("worktree names read failed: file=$file message=${e.message}", e)
        WorktreeState()
    }
}

internal fun writeWorktreeNames(file: Path, names: Map<String, String>) {
    val state = readWorktreeState(file)
    writeWorktreeState(file, state.copy(names = names))
}

internal fun writeWorktreeState(file: Path, state: WorktreeState) {
    Files.createDirectories(file.parent)
    val data = WorktreeNamesFile(
        names = state.names.filterValues { it.isNotBlank() },
        worktreeOrder = state.worktreeOrder.filter { it.isNotBlank() }.distinct(),
        sessionList = state.sessionList.filterKeys { it.isNotBlank() },
    )
    val tmp = Files.createTempFile(file.parent, ".worktree-names", ".tmp")
    try {
        Files.writeString(tmp, json.encodeToString(WorktreeNamesFile.serializer(), data))
        try {
            Files.move(tmp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (_: Exception) {
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING)
        }
    } finally {
        Files.deleteIfExists(tmp)
    }
}

private fun syncWorktreeState(file: Path, paths: List<String>, live: List<String>): WorktreeState {
    val state = readWorktreeState(file)
    val next = state.reconcile(paths, live)
    if (next == state) return next
    try {
        writeWorktreeState(file, next)
    } catch (e: Exception) {
        KiloWorktreeRpcApiImpl.LOG.warn("worktree state sync failed: file=$file message=${e.message}", e)
    }
    return next
}

private fun prependWorktreeOrder(file: Path, path: String, paths: List<String>) {
    val state = readWorktreeState(file)
    val set = paths.toSet()
    val rest = state.worktreeOrder.filter { it in set && !samePath(it, path) } +
        paths.filter { it !in state.worktreeOrder && !samePath(it, path) }
    writeWorktreeState(file, state.copy(worktreeOrder = (listOf(path) + rest).distinct()))
}

private fun removeWorktreeState(file: Path, path: String) {
    val state = readWorktreeState(file)
    val names = state.names.filterKeys { !samePath(it, path) }
    val order = state.worktreeOrder.filter { !samePath(it, path) }
    val visible = state.sessionList.filterKeys { !samePath(it, path) }
    if (names == state.names && order == state.worktreeOrder && visible == state.sessionList) return
    writeWorktreeState(file, state.copy(names = names, worktreeOrder = order, sessionList = visible))
}

private fun worktreePaths(items: List<WorktreeDto>): List<String> {
    return items.filter { !it.main }.map { it.path }
}

private fun livePaths(items: List<WorktreeDto>): List<String> {
    return items.map { it.path }
}

private fun worktreeNameStore(items: List<WorktreeDto>): Path? {
    val main = items.firstOrNull { it.main } ?: return null
    return Path.of(main.path).normalize().resolve(".kilo").resolve(WORKTREE_NAMES_FILE)
}

private fun samePath(a: String, b: String): Boolean {
    return realPath(a) == realPath(b)
}

private fun realPath(path: String): Path {
    val file = Path.of(path).normalize()
    return if (Files.exists(file)) file.toRealPath() else file
}
