package ai.kilocode.backend.rpc

import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.RenameWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeBranchesDto
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreeListDto
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

class KiloWorktreeRpcApiImpl : KiloWorktreeRpcApi {

    companion object {
        internal val LOG = KiloLog.create(KiloWorktreeRpcApiImpl::class.java)
    }

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

    override suspend fun listBranches(directory: String): WorktreeBranchesDto = withContext(Dispatchers.IO) {
        val base = Path.of(directory).normalize()
        val refs = runGit(base, "for-each-ref", "--format=%(refname:short)", "refs/heads")
        val branches = if (!refs.ok) emptyList() else refs.stdout.lines().map { it.trim() }.filter { it.isNotEmpty() }
        val current = runGit(base, "branch", "--show-current").stdout.trim().takeIf { it.isNotEmpty() }
        WorktreeBranchesDto(branches, current)
    }

    override suspend fun create(directory: String, request: CreateWorktreeRequestDto): CreateWorktreeResultDto =
        withContext(Dispatchers.IO) {
            val base = Path.of(directory).normalize()
            val branch = request.branch.trim()
            if (branch.isEmpty()) return@withContext CreateWorktreeResultDto(error = "Branch name is required")
            val dir = base.resolve(".kilo").resolve("worktrees").resolve(branch.replace('/', '-'))
            Files.createDirectories(dir.parent)
            val args = buildList {
                addAll(listOf("worktree", "add", "-b", branch, dir.toString()))
                request.baseBranch?.trim()?.takeIf { it.isNotEmpty() }?.let { add(it) }
            }
            LOG.info("worktree create requested: branch=$branch base=${request.baseBranch ?: "(current)"} dir=$dir")
            val res = runGit(base, *args.toTypedArray())
            if (!res.ok) {
                LOG.warn("worktree create failed: branch=$branch exit=${res.exit} stderr=${res.stderr.trim()}")
                CreateWorktreeResultDto(error = res.stderr.ifBlank { "git worktree add failed" })
            } else {
                LOG.info("worktree created: branch=$branch dir=$dir")
                val path = dir.toRealPath().toString()
                val list = runGit(base, "worktree", "list", "--porcelain")
                val items = if (list.ok) managedWorktrees(parseWorktreeList(list.stdout)) else emptyList()
                val store = worktreeNameStore(items) ?: base.resolve(".kilo").resolve(WORKTREE_NAMES_FILE)
                val paths = worktreePaths(items).ifEmpty { listOf(path) }
                appendWorktreeOrder(store, path, paths)
                CreateWorktreeResultDto(
                    worktree = WorktreeDto(path, dir.fileName.toString(), branch, path),
                )
            }
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

    private fun runGit(base: Path, vararg args: String): GitResult {
        return try {
            val cmd = GeneralCommandLine(listOf("git") + args).withWorkDirectory(base.toFile())
            val out = CapturingProcessHandler(cmd).runProcess(30_000)
            GitResult(if (out.isTimeout) -1 else out.exitCode, out.stdout, out.stderr)
        } catch (e: Exception) {
            GitResult(-1, "", e.message ?: "git failed")
        }
    }
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
