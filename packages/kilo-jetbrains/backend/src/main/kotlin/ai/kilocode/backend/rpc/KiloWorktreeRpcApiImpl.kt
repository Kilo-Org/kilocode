package ai.kilocode.backend.rpc

import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.RenameWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeBranchesDto
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
import com.intellij.openapi.application.EDT
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.openapi.wm.WindowManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.awt.Frame
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.concurrent.ConcurrentHashMap
import kotlin.io.path.fileSize
import kotlin.io.path.inputStream
import kotlin.io.path.isRegularFile

class KiloWorktreeRpcApiImpl : KiloWorktreeRpcApi {

    companion object {
        internal val LOG = KiloLog.create(KiloWorktreeRpcApiImpl::class.java)
        private const val BASE_TTL = 60_000L
        private const val GH_PROBE_TTL = 300_000L
        private const val GH_STATUS_TTL = 3_000L
        private const val PR_TTL = 90_000L
    }

    private val bases = ConcurrentHashMap<String, Timed<String>>()
    private val prs = ConcurrentHashMap<String, Timed<WorktreePrListDto>>()
    private val ghLock = Any()
    @Volatile
    private var ghProbe: Timed<GhAvailability>? = null
    @Volatile
    private var ghCache: Timed<GhAvailability>? = null

    override suspend fun list(directory: String): WorktreeListDto = withContext(Dispatchers.IO) {
        val base = Path.of(directory).normalize()
        val res = runGit(base, "worktree", "list", "--porcelain")
        if (!res.ok) return@withContext WorktreeListDto()
        val items = managedWorktrees(parseWorktreeList(res.stdout))
        val store = worktreeNameStore(items)
        val state = store?.let { syncWorktreeState(it, worktreePaths(items)) } ?: WorktreeState()
        val named = overlayWorktreeNames(items, state.names)
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
        val res = runGit(root, "worktree", "list", "--porcelain")
        if (!res.ok) return@withContext WorktreeStatsListDto()
        val items = managedWorktrees(parseWorktreeList(res.stdout))
        val main = items.firstOrNull { it.main }
        val fallback = main?.branch?.takeIf { it.isNotBlank() && it != "(detached)" } ?: "HEAD"
        WorktreeStatsListDto(parallel(items.filter { !it.main }) { item -> stats(item, fallback) })
    }

    override suspend fun ghStatus(directory: String): GhAvailability = withContext(Dispatchers.IO) {
        probeGh(Path.of(directory).normalize(), "rpc")
    }

    override suspend fun prStatus(directory: String): WorktreePrListDto = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        prs[directory]?.takeIf { now - it.time < PR_TTL }?.let { return@withContext it.value }
        val root = Path.of(directory).normalize()
        val available = ghAvailable(root)
        if (available != GhAvailability.OK) return@withContext WorktreePrListDto(available).also { prs[directory] = Timed(now, it) }
        val res = runGit(root, "worktree", "list", "--porcelain")
        if (!res.ok) return@withContext WorktreePrListDto().also { prs[directory] = Timed(now, it) }
        val items = managedWorktrees(parseWorktreeList(res.stdout)).filter { !it.main && it.branch != "(detached)" }
        var status = GhAvailability.OK
        val data = parallel(items) { item ->
            if (status != GhAvailability.OK) return@parallel null
            val out = runGh(Path.of(item.path).normalize(), "pr", "view", item.branch, "--json", "number,state,isDraft,url,title")
            if (!out.ok) {
                // prError only ever returns UNAUTH or OK; a missing gh/git binary is already caught
                // by the upfront ghAvailable() check before this loop runs.
                if (prError(out.stderr) == GhAvailability.UNAUTH) status = GhAvailability.UNAUTH
                return@parallel null
            }
            parsePr(item.path, out.stdout)
        }.filterNotNull()
        val dto = WorktreePrListDto(status, if (status == GhAvailability.OK) data else emptyList())
        prs[directory] = Timed(System.currentTimeMillis(), dto)
        dto
    }

    override suspend fun create(directory: String, request: CreateWorktreeRequestDto): CreateWorktreeResultDto =
        withContext(Dispatchers.IO) {
            val base = Path.of(directory).normalize()
            val branch = request.branch.trim()
            if (branch.isEmpty()) return@withContext CreateWorktreeResultDto(error = "Branch name is required")
            addWorktree(base, branch, request.existingBranch, request.baseBranch)
        }

    override suspend fun importPr(directory: String, url: String): CreateWorktreeResultDto =
        withContext(Dispatchers.IO) {
            val base = Path.of(directory).normalize()
            val ref = parsePrUrl(url) ?: return@withContext CreateWorktreeResultDto(error = "Enter a valid GitHub pull request URL")
            when (ghAvailable(base)) {
                GhAvailability.GIT_MISSING -> return@withContext CreateWorktreeResultDto(error = "Git is not installed")
                GhAvailability.MISSING -> return@withContext CreateWorktreeResultDto(error = "GitHub CLI (gh) is not installed")
                GhAvailability.UNAUTH -> return@withContext CreateWorktreeResultDto(error = "GitHub CLI (gh) is not authorized")
                GhAvailability.OK -> Unit
            }
            val view = runGh(base, "pr", "view", ref.number.toString(), "--repo", "${ref.owner}/${ref.repo}", "--json", "headRefName,title")
            if (!view.ok) {
                LOG.warn("pr import view failed: url=$url exit=${view.exit} stderr=${view.stderr.trim()}")
                return@withContext CreateWorktreeResultDto(error = view.stderr.ifBlank { "gh pr view failed" })
            }
            val branch = parsePrHeadRef(view.stdout).ifBlank { "pr-${ref.number}" }
            // The pull ref works for both same-repo and fork PRs without adding a fork remote; the
            // leading '+' force-updates a stale local branch from a previous import attempt.
            val fetch = runGit(base, "fetch", "origin", "+refs/pull/${ref.number}/head:$branch")
            if (!fetch.ok) {
                LOG.warn("pr import fetch failed: url=$url exit=${fetch.exit} stderr=${fetch.stderr.trim()}")
                return@withContext CreateWorktreeResultDto(error = fetch.stderr.ifBlank { "git fetch failed" })
            }
            addWorktree(base, branch, existing = true, baseRef = null)
        }

    /** Runs `git worktree add` under `<base>/.kilo/worktrees/<slug>` and records list bookkeeping. */
    private fun addWorktree(base: Path, branch: String, existing: Boolean, baseRef: String?): CreateWorktreeResultDto {
        val dir = base.resolve(".kilo").resolve("worktrees").resolve(branch.replace('/', '-'))
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
        val res = runGit(base, *args.toTypedArray())
        if (!res.ok) {
            LOG.warn("worktree add failed: branch=$branch exit=${res.exit} stderr=${res.stderr.trim()}")
            return CreateWorktreeResultDto(error = res.stderr.ifBlank { "git worktree add failed" })
        }
        LOG.info("worktree created: branch=$branch dir=$dir")
        val path = dir.toRealPath().toString()
        val list = runGit(base, "worktree", "list", "--porcelain")
        val items = if (list.ok) managedWorktrees(parseWorktreeList(list.stdout)) else emptyList()
        val store = worktreeNameStore(items) ?: base.resolve(".kilo").resolve(WORKTREE_NAMES_FILE)
        val paths = worktreePaths(items).ifEmpty { listOf(path) }
        appendWorktreeOrder(store, path, paths)
        return CreateWorktreeResultDto(worktree = WorktreeDto(path, dir.fileName.toString(), branch, path))
    }

    override suspend fun remove(directory: String, path: String, branch: String?, force: Boolean): RemoveWorktreeResultDto =
        withContext(Dispatchers.IO) {
            val base = Path.of(directory).normalize()
            LOG.info("worktree remove requested: path=$path branch=${branch ?: "(none)"} force=$force base=$base")
            val list = runGit(base, "worktree", "list", "--porcelain")
            val store = (if (list.ok) worktreeNameStore(managedWorktrees(parseWorktreeList(list.stdout))) else null)
                ?: base.resolve(".kilo").resolve(WORKTREE_NAMES_FILE)
            // Force means the user accepted removing a locked worktree; unlock first so the plain
            // remove succeeds. Unlock fails harmlessly when the tree isn't actually locked.
            if (force) {
                val unlock = runGit(base, "worktree", "unlock", path)
                if (!unlock.ok) LOG.info("worktree unlock skipped: path=$path exit=${unlock.exit} stderr=${unlock.stderr.trim()}")
            }
            val res = runGit(base, "worktree", "remove", "--force", path)
            if (!res.ok) {
                val locked = res.stderr.contains("locked working tree", ignoreCase = true)
                LOG.warn("worktree remove failed: path=$path locked=$locked exit=${res.exit} stderr=${res.stderr.trim()}")
                return@withContext RemoveWorktreeResultDto(
                    error = res.stderr.ifBlank { "git worktree remove failed" },
                    locked = locked,
                )
            }
            // The worktree is gone; a failed branch delete must not fail the removal, only warn.
            branch?.trim()?.takeIf { it.isNotEmpty() }?.let {
                val del = runGit(base, "branch", "-D", it)
                if (!del.ok) LOG.warn("worktree branch delete failed: branch=$it exit=${del.exit} stderr=${del.stderr.trim()}")
            }
            LOG.info("worktree removed: path=$path branch=${branch ?: "(none)"}")
            removeWorktreeState(store, path)
            RemoveWorktreeResultDto(ok = true)
        }

    override suspend fun rename(directory: String, path: String, name: String): RenameWorktreeResultDto =
        withContext(Dispatchers.IO) {
            val title = name.trim()
            if (title.isEmpty()) return@withContext RenameWorktreeResultDto(error = "Name is required")
            val base = Path.of(directory).normalize()
            val res = runGit(base, "worktree", "list", "--porcelain")
            if (!res.ok) return@withContext RenameWorktreeResultDto(error = res.stderr.ifBlank { "git worktree list failed" })
            val items = managedWorktrees(parseWorktreeList(res.stdout))
            val store = worktreeNameStore(items)
                ?: return@withContext RenameWorktreeResultDto(error = "Main worktree not found")
            val target = items.firstOrNull { samePath(it.path, path) && !it.main }
                ?: return@withContext RenameWorktreeResultDto(error = "Worktree not found")
            return@withContext try {
                val state = readWorktreeState(store).reconcile(worktreePaths(items))
                val names = state.names.toMutableMap()
                names[target.path] = title
                writeWorktreeState(store, state.copy(names = names))
                RenameWorktreeResultDto(worktree = target.copy(name = title))
            } catch (e: Exception) {
                LOG.warn("worktree rename failed: path=$path message=${e.message}", e)
                RenameWorktreeResultDto(error = e.message ?: "worktree rename failed")
            }
        }

    override suspend fun adopt(directory: String, path: String, name: String): RenameWorktreeResultDto =
        withContext(Dispatchers.IO) {
            val title = name.trim()
            if (title.isEmpty()) return@withContext RenameWorktreeResultDto()
            val base = Path.of(directory).normalize()
            val res = runGit(base, "worktree", "list", "--porcelain")
            if (!res.ok) return@withContext RenameWorktreeResultDto(error = res.stderr.ifBlank { "git worktree list failed" })
            val items = managedWorktrees(parseWorktreeList(res.stdout))
            val store = worktreeNameStore(items)
                ?: return@withContext RenameWorktreeResultDto(error = "Main worktree not found")
            val target = items.firstOrNull { samePath(it.path, path) && !it.main }
                ?: return@withContext RenameWorktreeResultDto(error = "Worktree not found")
            return@withContext try {
                val state = readWorktreeState(store).reconcile(worktreePaths(items))
                val names = state.names.toMutableMap()
                // Only adopt while the worktree is still default. A recorded name means the user (or a
                // prior adoption) already titled it, so leave it untouched and report a no-op.
                if (!names[target.path].isNullOrBlank()) return@withContext RenameWorktreeResultDto()
                names[target.path] = title
                writeWorktreeState(store, state.copy(names = names))
                LOG.info("worktree name adopted: path=$path name=$title")
                RenameWorktreeResultDto(worktree = target.copy(name = title))
            } catch (e: Exception) {
                LOG.warn("worktree adopt failed: path=$path message=${e.message}", e)
                RenameWorktreeResultDto(error = e.message ?: "worktree adopt failed")
            }
        }

    private data class GitResult(val exit: Int, val stdout: String, val stderr: String) {
        val ok get() = exit == 0
    }

    private data class Timed<T>(val time: Long, val value: T)

    private fun runGit(base: Path, vararg args: String): GitResult {
        return try {
            val cmd = GeneralCommandLine(listOf("git") + args).withWorkDirectory(base.toFile())
            val out = CapturingProcessHandler(cmd).runProcess(30_000)
            GitResult(if (out.isTimeout) -1 else out.exitCode, out.stdout, out.stderr)
        } catch (e: Exception) {
            GitResult(-1, "", e.message ?: "git failed")
        }
    }

    private fun runGh(base: Path, vararg args: String): GitResult {
        return try {
            val cmd = GeneralCommandLine(listOf("gh") + args)
                .withWorkDirectory(base.toFile())
                .withParentEnvironmentType(ParentEnvironmentType.CONSOLE)
            val out = CapturingProcessHandler(cmd).runProcess(30_000)
            GitResult(if (out.isTimeout) -1 else out.exitCode, out.stdout, out.stderr)
        } catch (e: Exception) {
            GitResult(-1, "", e.message ?: "gh failed")
        }
    }

    private suspend fun <T, R> parallel(items: List<T>, block: suspend (T) -> R): List<R> = coroutineScope {
        val sem = Semaphore(4)
        items.map { item -> async { sem.withPermit { block(item) } } }.map { it.await() }
    }

    private fun stats(item: WorktreeDto, fallback: String): WorktreeStatsDto {
        val dir = Path.of(item.path).normalize()
        return runCatching {
            val base = base(item, fallback)
            val anc = runGit(dir, "merge-base", "HEAD", base).stdout.trim().takeIf { it.isNotBlank() } ?: base
            val diff = runGit(dir, "-c", "core.quotepath=false", "diff", "--numstat", "--no-renames", anc)
            val tracked = if (diff.ok) parseNumstat(diff.stdout) else emptyList()
            val untrackedFiles = runGit(dir, "-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard")
                .stdout
                .lineSequence()
                .filter { it.isNotBlank() }
                .toList()
            val untracked = untrackedFiles.sumOf { countUntracked(dir, it) }
            val counts = aheadBehind(dir, base)
            WorktreeStatsDto(
                item.path,
                tracked.sumOf { it.additions } + untracked,
                tracked.sumOf { it.deletions },
                counts.second,
                counts.first,
                files = tracked.size + untrackedFiles.size,
            )
        }.getOrElse { err ->
            LOG.warn("worktree stats failed: path=${item.path} message=${err.message}", err)
            WorktreeStatsDto(item.path)
        }
    }

    private fun base(item: WorktreeDto, fallback: String): String {
        val now = System.currentTimeMillis()
        bases[item.path]?.takeIf { now - it.time < BASE_TTL }?.let { return it.value }
        val dir = Path.of(item.path).normalize()
        val upstream = runGit(dir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
        val value = upstream.stdout.trim().takeIf { upstream.ok && it.isNotBlank() } ?: fallback
        bases[item.path] = Timed(now, value)
        return value
    }

    private fun aheadBehind(dir: Path, base: String): Pair<Int, Int> {
        val out = runGit(dir, "rev-list", "--left-right", "--count", "$base...HEAD")
        if (!out.ok) return 0 to 0
        val parts = out.stdout.trim().split(Regex("\\s+"))
        return (parts.getOrNull(0)?.toIntOrNull() ?: 0) to (parts.getOrNull(1)?.toIntOrNull() ?: 0)
    }

    private fun ghAvailable(root: Path): GhAvailability {
        val status = probeGh(root, "availability")
        if (status != GhAvailability.MISSING) return status
        val now = System.currentTimeMillis()
        ghProbe?.takeIf { now - it.time < GH_PROBE_TTL }?.let { return it.value }
        val res = runGh(root, "--version")
        val value = if (res.ok) GhAvailability.OK else GhAvailability.MISSING
        ghProbe = Timed(now, value)
        return value
    }

    private fun probeGh(root: Path, reason: String): GhAvailability = synchronized(ghLock) {
        val now = System.currentTimeMillis()
        ghCache?.takeIf { now - it.time < GH_STATUS_TTL }?.let {
            LOG.info("gh probe cache hit reason=$reason value=${it.value}")
            return@synchronized it.value
        }
        val start = System.currentTimeMillis()
        LOG.info("gh probe start reason=$reason dir=$root")
        val git = runGit(root, "--version")
        if (!git.ok) {
            val value = GhAvailability.GIT_MISSING
            ghCache = Timed(System.currentTimeMillis(), value)
            LOG.info("gh probe result reason=$reason value=$value exit=${git.exit} ms=${System.currentTimeMillis() - start} stderr=${snippet(git.stderr)}")
            return@synchronized value
        }
        val res = runGh(root, "auth", "status")
        val value = if (res.ok) GhAvailability.OK else classifyGhError(res.stderr.ifBlank { res.stdout })
        ghCache = Timed(System.currentTimeMillis(), value)
        LOG.info("gh probe result reason=$reason value=$value exit=${res.exit} ms=${System.currentTimeMillis() - start} stderr=${snippet(res.stderr)}")
        value
    }

    private fun prError(stderr: String): GhAvailability {
        val text = stderr.lowercase()
        if (text.contains("not logged") || text.contains("gh auth login") || text.contains("authentication")) return GhAvailability.UNAUTH
        if (text.contains("not found") || text.contains("no pull requests found")) return GhAvailability.OK
        return GhAvailability.OK
    }

    private fun snippet(text: String): String {
        return text.trim().replace(Regex("\\s+"), " ").take(180)
    }

}

internal fun classifyGhError(text: String): GhAvailability {
    val msg = text.lowercase()
    if (msg.contains("not logged") || msg.contains("gh auth login") || msg.contains("authentication")) return GhAvailability.UNAUTH
    // Only treat process-spawn failures as MISSING. A bare "not found" match would misclassify
    // transient gh auth failures (e.g. a GitHub Enterprise 404 or revoked token) as an uninstalled gh;
    // scope to spawn/shell signals instead.
    if (msg.contains("cannot run program") || msg.contains("no such file") || msg.contains("command not found")) return GhAvailability.MISSING
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
    return WorktreePrDto(path, number, state, url, title)
}

internal data class PrRef(val owner: String, val repo: String, val number: Int)

private val PR_URL = Regex("github\\.com[/:]([^/]+)/([^/]+?)(?:\\.git)?/pull/(\\d+)")

/** Parses `https://github.com/<owner>/<repo>/pull/<n>` (and ssh-style hosts) into its parts. */
internal fun parsePrUrl(url: String): PrRef? {
    val match = PR_URL.find(url.trim()) ?: return null
    val number = match.groupValues[3].toIntOrNull() ?: return null
    return PrRef(match.groupValues[1], match.groupValues[2], number)
}

/** Reads `headRefName` out of a `gh pr view --json` payload. */
internal fun parsePrHeadRef(raw: String): String {
    val obj = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: return ""
    return obj["headRefName"]?.jsonPrimitive?.content?.trim().orEmpty()
}

private val json = Json { prettyPrint = true; ignoreUnknownKeys = true }
private val codec = MapSerializer(String.serializer(), String.serializer())
private const val WORKTREE_NAMES_FILE = "worktree-names.json"

@Serializable
private data class WorktreeNamesFile(
    val names: Map<String, String> = emptyMap(),
    val worktreeOrder: List<String> = emptyList(),
)

internal data class WorktreeState(
    val names: Map<String, String> = emptyMap(),
    val worktreeOrder: List<String> = emptyList(),
) {
    fun reconcile(paths: List<String>): WorktreeState {
        val set = paths.toSet()
        val order = (worktreeOrder.filter { it in set } + paths.filter { it !in worktreeOrder }).distinct()
        val next = names.filterKeys { it in set }
        return WorktreeState(next, order)
    }
}

/** Parse `git worktree list --porcelain`. First entry is the main working tree. */
internal fun parseWorktreeList(raw: String): List<WorktreeDto> {
    val out = mutableListOf<WorktreeDto>()
    var path: String? = null
    var branch = "(detached)"
    var locked = false
    var lockReason: String? = null
    var first = true
    fun flush() {
        val p = path ?: return
        val name = p.substringAfterLast('/').ifBlank { p }
        out.add(WorktreeDto(p, name, branch, p, main = first, locked = locked, lockReason = lockReason))
        first = false
        path = null
        branch = "(detached)"
        locked = false
        lockReason = null
    }
    for (line in raw.lines()) {
        when {
            line.startsWith("worktree ") -> { flush(); path = line.removePrefix("worktree ").trim() }
            line.startsWith("branch ") -> branch = line.removePrefix("branch ").trim().removePrefix("refs/heads/")
            line == "locked" || line.startsWith("locked ") -> {
                locked = true
                lockReason = line.removePrefix("locked").trim().takeIf { it.isNotEmpty() }
            }
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
        val path = Path.of(item.path).normalize()
        path.startsWith(storage) && path != storage
    }
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
        if (element is JsonObject && ("names" in element || "worktreeOrder" in element)) {
            val data = json.decodeFromJsonElement<WorktreeNamesFile>(element)
            return WorktreeState(data.names.filterValues { it.isNotBlank() }, data.worktreeOrder.filter { it.isNotBlank() })
        }
        val names = json.decodeFromJsonElement(codec, element).filterValues { it.isNotBlank() }
        WorktreeState(names, names.keys.toList())
    } catch (e: Exception) {
        KiloWorktreeRpcApiImpl.LOG.warn("worktree names read failed: file=$file message=${e.message}", e)
        WorktreeState()
    }
}

internal fun writeWorktreeNames(file: Path, names: Map<String, String>) {
    val order = readWorktreeState(file).worktreeOrder
    writeWorktreeState(file, WorktreeState(names, order))
}

internal fun writeWorktreeState(file: Path, state: WorktreeState) {
    Files.createDirectories(file.parent)
    val data = WorktreeNamesFile(
        names = state.names.filterValues { it.isNotBlank() },
        worktreeOrder = state.worktreeOrder.filter { it.isNotBlank() }.distinct(),
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

private fun syncWorktreeState(file: Path, paths: List<String>): WorktreeState {
    val state = readWorktreeState(file)
    val next = state.reconcile(paths)
    if (next == state) return next
    try {
        writeWorktreeState(file, next)
    } catch (e: Exception) {
        KiloWorktreeRpcApiImpl.LOG.warn("worktree state sync failed: file=$file message=${e.message}", e)
    }
    return next
}

private fun appendWorktreeOrder(file: Path, path: String, paths: List<String>) {
    val state = readWorktreeState(file)
    val set = paths.toSet()
    val order = state.worktreeOrder.filter { it in set && !samePath(it, path) } +
        paths.filter { it !in state.worktreeOrder && !samePath(it, path) } +
        path
    writeWorktreeState(file, state.copy(worktreeOrder = order.distinct()))
}

private fun removeWorktreeState(file: Path, path: String) {
    val state = readWorktreeState(file)
    val names = state.names.filterKeys { !samePath(it, path) }
    val order = state.worktreeOrder.filter { !samePath(it, path) }
    if (names == state.names && order == state.worktreeOrder) return
    writeWorktreeState(file, state.copy(names = names, worktreeOrder = order))
}

private fun worktreePaths(items: List<WorktreeDto>): List<String> {
    return items.filter { !it.main }.map { it.path }
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

private fun countUntracked(base: Path, rel: String): Int {
    return runCatching {
        val path = base.resolve(rel).normalize()
        if (!path.startsWith(base) || !path.isRegularFile() || path.fileSize() > 2 * 1024 * 1024L) return@runCatching 0
        countLines(path) ?: 0
    }.getOrElse { err ->
        KiloWorktreeRpcApiImpl.LOG.debug { "worktree stats untracked read failed: path=$rel message=${err.message}" }
        0
    }
}

private fun countLines(path: Path): Int? {
    var newlines = 0
    var last = 0
    var any = false
    path.inputStream().buffered().use { input ->
        val buf = ByteArray(8192)
        while (true) {
            val n = input.read(buf)
            if (n <= 0) break
            any = true
            for (i in 0 until n) {
                val b = buf[i].toInt()
                if (b == 0) return null
                if (b == '\n'.code) newlines++
            }
            last = buf[n - 1].toInt()
        }
    }
    if (!any) return 0
    return if (last == '\n'.code) newlines else newlines + 1
}
