package ai.kilocode.backend.rpc

import ai.kilocode.backend.diff.runGitCommand
import ai.kilocode.backend.repo.repoPathKey
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.util.concurrent.ConcurrentHashMap

internal const val WORKTREE_STATE_FILE = "jetbrains.json"

@Serializable
internal data class RepoEntry(
    val root: String,
    val label: String? = null,
    val order: Int = 0,
    val addedAt: String = "",
)

@Serializable
private data class WorktreeStateFile(
    val names: Map<String, String> = emptyMap(),
    val worktreeOrder: List<String> = emptyList(),
    val sessionList: Map<String, Boolean> = emptyMap(),
    val repos: List<RepoEntry> = emptyList(),
    val dismissed: List<String> = emptyList(),
)

internal data class WorktreeState(
    val names: Map<String, String> = emptyMap(),
    val worktreeOrder: List<String> = emptyList(),
    val sessionList: Map<String, Boolean> = emptyMap(),
    val repos: List<RepoEntry> = emptyList(),
    val dismissed: List<String> = emptyList(),
) {
    /**
     * Drop state for worktrees git no longer reports. Repository catalog fields are intentionally
     * preserved: they describe separate repositories, not checkouts of this one.
     */
    fun reconcile(paths: List<String>, live: List<String>): WorktreeState {
        val set = paths.toSet()
        val all = live.toSet()
        val order = (worktreeOrder.filter { it in set } + paths.filter { it !in worktreeOrder }).distinct()
        val next = names.filterKeys { it in set }
        val visible = sessionList.filterKeys { it in all }
        return copy(names = next, worktreeOrder = order, sessionList = visible)
    }
}

/**
 * Serializes every read-modify-write of one `.kilo/jetbrains.json` file across backend RPC providers.
 *
 * Worktree polling and repo-catalog mutations share this app service. A stale poll therefore cannot
 * overwrite a repo added between its read and write, which was possible when each RPC owned separate
 * state and locks.
 */
@Service(Service.Level.APP)
internal class WorktreeStateStore {
    private val locks = ConcurrentHashMap<String, Mutex>()

    suspend fun read(file: Path): WorktreeState = withContext(Dispatchers.IO) {
        val path = canonical(file)
        mutex(path).withLock { readWorktreeState(path) }
    }

    suspend fun update(file: Path, change: (WorktreeState) -> WorktreeState): WorktreeState = withContext(Dispatchers.IO) {
        val path = canonical(file)
        mutex(path).withLock {
            Files.createDirectories(path.parent)
            val lock = path.parent.resolve(LOCK_FILE)
            if (!Files.exists(lock)) ensureIgnored(path)
            FileChannel.open(lock, StandardOpenOption.CREATE, StandardOpenOption.WRITE).use { channel ->
                channel.lock().use {
                    // Strict decode here: a future incompatible schema must fail the mutation rather
                    // than be interpreted as empty state and overwritten with defaults.
                    val state = decodeWorktreeState(path)
                    val next = change(state)
                    if (next != state) writeWorktreeState(path, next)
                    next
                }
            }
        }
    }

    private fun mutex(file: Path): Mutex {
        val key = file.toAbsolutePath().normalize().toString()
        return locks.computeIfAbsent(key) { Mutex() }
    }

    /** Resolve aliases in the existing repo/.kilo parent even before the state file itself exists. */
    private fun canonical(file: Path): Path {
        val path = file.toAbsolutePath().normalize()
        val parent = path.parent
        return runCatching { parent.toRealPath().resolve(path.fileName) }.getOrDefault(path)
    }
}

internal fun defaultWorktreeStateStore(): WorktreeStateStore {
    if (ApplicationManager.getApplication() == null) return WorktreeStateStore()
    return service()
}

private val stateJson = Json {
    prettyPrint = true
    ignoreUnknownKeys = true
    encodeDefaults = true
}
private val legacyCodec = MapSerializer(String.serializer(), String.serializer())

internal fun worktreeStateFile(root: Path): Path = realPath(root.toString()).resolve(".kilo").resolve(WORKTREE_STATE_FILE)

internal fun readWorktreeNames(file: Path): Map<String, String> = readWorktreeState(file).names

internal fun readWorktreeState(file: Path): WorktreeState {
    return try {
        decodeWorktreeState(file)
    } catch (err: Exception) {
        KiloWorktreeRpcApiImpl.LOG.warn("worktree state read failed: file=$file message=${err.message}", err)
        WorktreeState()
    }
}

private fun decodeWorktreeState(file: Path): WorktreeState {
    if (!Files.exists(file)) return WorktreeState()
    val element = stateJson.parseToJsonElement(Files.readString(file))
    if (element is JsonObject && KNOWN_KEYS.any(element::containsKey)) {
        val data = stateJson.decodeFromJsonElement<WorktreeStateFile>(element)
        return WorktreeState(
            names = data.names.filterValues { it.isNotBlank() },
            worktreeOrder = data.worktreeOrder.filter { it.isNotBlank() },
            sessionList = data.sessionList.filterKeys { it.isNotBlank() },
            repos = data.repos.filter { it.root.isNotBlank() }.distinctBy { repoPathKey(it.root) },
            dismissed = data.dismissed.filter { it.isNotBlank() }.distinctBy(::repoPathKey),
        )
    }
    val names = stateJson.decodeFromJsonElement(legacyCodec, element).filterValues { it.isNotBlank() }
    return WorktreeState(names = names, worktreeOrder = names.keys.toList())
}

internal fun writeWorktreeNames(file: Path, names: Map<String, String>) {
    val state = readWorktreeState(file)
    writeWorktreeState(file, state.copy(names = names))
}

/**
 * Atomic replacement of known state fields while preserving unknown JSON keys for forward
 * compatibility. An older/newer client can add a field without this version erasing it on a poll.
 */
internal fun writeWorktreeState(file: Path, state: WorktreeState) {
    Files.createDirectories(file.parent)
    val data = WorktreeStateFile(
        names = state.names.filterValues { it.isNotBlank() },
        worktreeOrder = state.worktreeOrder.filter { it.isNotBlank() }.distinct(),
        sessionList = state.sessionList.filterKeys { it.isNotBlank() },
        repos = state.repos.filter { it.root.isNotBlank() }.distinctBy { repoPathKey(it.root) },
        dismissed = state.dismissed.filter { it.isNotBlank() }.distinctBy(::repoPathKey),
    )
    val known = stateJson.encodeToJsonElement(WorktreeStateFile.serializer(), data) as JsonObject
    val previous = runCatching {
        if (!Files.exists(file)) JsonObject(emptyMap()) else stateJson.parseToJsonElement(Files.readString(file)) as? JsonObject
    }.getOrNull() ?: JsonObject(emptyMap())
    val merged = mergeKnown(previous, known)
    atomicWrite(file, stateJson.encodeToString(JsonObject.serializer(), merged), ".worktree-state")
}

/** Keep machine-local absolute paths out of git without modifying tracked `.kilo` configuration. */
private fun ensureIgnored(state: Path) {
    val root = state.parent.parent
    val git = runGitCommand(root, listOf("rev-parse", "--path-format=absolute", "--git-path", "info/exclude"))
    if (git.ok) {
        val file = Path.of(git.stdout.trim())
        ensureLines(file, LOCAL_PATTERNS)
        return
    }
    // Non-git projects have no index to dirty. Keep the fallback local to `.kilo` for consistency.
    ensureLines(state.parent.resolve(".gitignore"), LOCAL_FILES)
}

private fun ensureLines(file: Path, lines: List<String>) {
    val raw = if (Files.exists(file)) Files.readString(file) else ""
    val present = raw.lineSequence().map(String::trim).toSet()
    val missing = lines.filterNot(present::contains)
    if (missing.isEmpty()) return
    val prefix = if (raw.isEmpty() || raw.endsWith("\n")) raw else "$raw\n"
    atomicWrite(file, prefix + missing.joinToString(separator = "\n", postfix = "\n"), ".kilo-ignore")
}

/** Preserve fields a newer plugin added inside an existing repo entry, keyed by canonical root. */
private fun mergeKnown(previous: JsonObject, known: JsonObject): JsonObject {
    val old = previous["repos"]?.let { runCatching { it.jsonArray }.getOrNull() }.orEmpty()
    val indexed = old.mapNotNull { item ->
        val obj = runCatching { item.jsonObject }.getOrNull() ?: return@mapNotNull null
        val root = obj["root"]?.let { runCatching { it.jsonPrimitive.content }.getOrNull() } ?: return@mapNotNull null
        repoPathKey(root) to obj
    }.toMap()
    val repos = known["repos"]?.jsonArray?.map { item ->
        val obj = item.jsonObject
        val root = obj["root"]?.jsonPrimitive?.content
        val prior = root?.let { indexed[repoPathKey(it)] }
        if (prior == null) obj else JsonObject(prior + obj)
    }.orEmpty()
    return JsonObject(previous + known + ("repos" to JsonArray(repos)))
}

private fun atomicWrite(file: Path, data: String, prefix: String) {
    Files.createDirectories(file.parent)
    val tmp = Files.createTempFile(file.parent, prefix, ".tmp")
    try {
        Files.writeString(tmp, data)
        try {
            Files.move(tmp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (_: Exception) {
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING)
        }
    } finally {
        Files.deleteIfExists(tmp)
    }
}

private val KNOWN_KEYS = setOf("names", "worktreeOrder", "sessionList", "repos", "dismissed")
private const val LOCK_FILE = ".jetbrains.lock"
private val LOCAL_PATTERNS = listOf("/.kilo/$WORKTREE_STATE_FILE", "/.kilo/$LOCK_FILE")
private val LOCAL_FILES = listOf(".gitignore", WORKTREE_STATE_FILE, LOCK_FILE)
