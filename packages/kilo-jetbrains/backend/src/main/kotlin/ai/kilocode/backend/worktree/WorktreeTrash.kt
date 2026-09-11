package ai.kilocode.backend.worktree

import ai.kilocode.log.KiloLog
import com.intellij.openapi.components.Service
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.io.IOException
import java.nio.file.DirectoryNotEmptyException
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.BasicFileAttributes
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Registry and background executor for worktree deletion, so a remove RPC never blocks on a
 * recursive filesystem delete and no polling loop (`stats`, `dirty`, `prStatus`, `branchStatus`, the
 * gh probe) spawns a process inside a directory that is disappearing underneath it.
 *
 * Deletion is rename-then-delete, mirroring the VS Code extension's `WorktreeManager`
 * (`packages/kilo-vscode/src/agent-manager/WorktreeManager.ts`): the caller atomically renames the
 * worktree to a `$PREFIX<uuid>` sibling — which is what makes it vanish from `git worktree list` and
 * from disk-existence checks in a single filesystem operation — then this service deletes that
 * sibling's contents on its own scope. Both clients share the same prefix, so either one sweeps
 * orphans the other left behind (e.g. after a force-quit mid-delete).
 */
@Service(Service.Level.APP)
class WorktreeTrash(private val cs: CoroutineScope) {
    companion object {
        /** Must match the VS Code extension's `TEMP_PREFIX` exactly so orphan sweeps are shared. */
        const val PREFIX = ".kilo-delete-"
        private val LOG = KiloLog.create(WorktreeTrash::class.java)
    }

    /**
     * Paths currently being removed: a stable [key] (normalization only, so it does not depend on the
     * directory still existing) mapped to every identity that path resolved to when [mark] ran. A
     * removal renames the checkout away almost immediately, so anything derived from `toRealPath()`
     * stops being reproducible partway through — hence recording the identities up front and keying
     * the entry on something that cannot change.
     */
    private val marked = ConcurrentHashMap<String, Set<String>>()

    /** Trees a reap is walking right now, so two walkers never race over the same files. */
    private val reaping = ConcurrentHashMap.newKeySet<String>()

    /** Storage directories a sweep is scanning right now, so repeated polls do not pile up. */
    private val sweeping = ConcurrentHashMap.newKeySet<String>()

    /**
     * In-flight reaps and sweeps only — each job removes itself on completion, so this never grows
     * with the number of deletions performed over an IDE session. Exists solely so [drain] can await
     * them in tests.
     */
    private val jobs = CopyOnWriteArrayList<Job>()

    /** Marks [path] as being removed. Callers must pair this with [unmark] via `try`/`finally`. */
    fun mark(path: String) {
        marked[key(path)] = identities(path)
        LOG.info("worktree trash marked: path=$path inflight=${marked.size}")
    }

    fun unmark(path: String) {
        marked.remove(key(path))
        LOG.info("worktree trash unmarked: path=$path inflight=${marked.size}")
    }

    /**
     * True when [path] is mid-removal (explicitly [mark]ed) or is itself a staged-for-delete
     * directory (its name starts with [PREFIX]). The second case covers a worktree discovered by a
     * concurrent `git worktree list` before this process ever called [mark], and any leftover from a
     * previous run that has not been swept yet — both must be invisible to every poll just the same
     * as an explicitly marked path.
     *
     * Matching is by identity intersection rather than by key, so a caller that names the worktree
     * through a symlink still matches an entry marked by its real path (and the reverse), whether or
     * not the directory still exists to resolve.
     */
    fun doomed(path: String): Boolean {
        val name = Path.of(path).normalize().fileName?.toString().orEmpty()
        if (name.startsWith(PREFIX)) return true
        if (marked.isEmpty()) return false
        val ids = identities(path)
        return marked.values.any { stored -> stored.any { it in ids } }
    }

    /**
     * Atomically renames [dir] to a `$PREFIX<uuid>` sibling so it disappears from git and from disk
     * existence checks in one filesystem operation. Returns the new path, or null when the rename
     * failed — the caller falls back to `git worktree remove --force` in that case, so throwing here
     * would only complicate that fallback for no benefit.
     *
     * [StandardCopyOption.ATOMIC_MOVE] is required, not merely preferred: a plain `Files.move` across
     * filesystems silently degrades to copy-then-delete, which would block the caller for the length
     * of a full tree copy (the exact stall this whole path exists to avoid) and leave the original in
     * place next to a half-built sibling. Demanding atomicity turns that case into the
     * `AtomicMoveNotSupportedException` this catch reports as "cannot stage", so the caller's
     * synchronous fallback runs instead.
     */
    fun stage(dir: Path): Path? {
        val temp = dir.resolveSibling(PREFIX + UUID.randomUUID())
        return try {
            Files.move(dir, temp, StandardCopyOption.ATOMIC_MOVE)
            LOG.info("worktree trash staged: from=$dir to=$temp")
            temp
        } catch (e: Exception) {
            LOG.warn("worktree trash stage failed: from=$dir message=${e.message}", e)
            null
        }
    }

    /** Deletes [temp] recursively on this service's own scope. Never throws into the caller. */
    fun reap(temp: Path) {
        track(cs.launch(Dispatchers.IO) { reapNow(temp) })
    }

    /**
     * Reaps every `$PREFIX*` directory directly under [storage] — orphans left by an interrupted
     * delete (this process's or the VS Code extension's), or a stage whose reap never ran because
     * the IDE closed first. Safe to call from every `list`/`sync`: listing an ordinary directory is
     * cheap, a scan already running for the same [storage] is skipped rather than duplicated, and a
     * tree another reap is already walking is left to that walker.
     */
    fun sweep(storage: Path) {
        if (!Files.isDirectory(storage)) return
        val key = storage.normalize().toString()
        if (!sweeping.add(key)) return
        track(
            cs.launch(Dispatchers.IO) {
                try {
                    val found = runCatching {
                        Files.newDirectoryStream(storage).use { stream ->
                            stream.filter { Files.isDirectory(it) && it.fileName.toString().startsWith(PREFIX) }
                        }
                    }.getOrElse {
                        LOG.warn("worktree trash sweep listing failed: storage=$storage message=${it.message}", it)
                        emptyList()
                    }
                    LOG.info("worktree trash sweep: storage=$storage found=${found.size}")
                    found.forEach { reapNow(it) }
                } finally {
                    sweeping.remove(key)
                }
            },
        )
    }

    /** Awaits every reap/sweep still running. Test-only: production code never blocks on this. */
    internal suspend fun drain() {
        // Loops rather than joining a single snapshot so a job started by one already being awaited is
        // still covered. Filtering on `isActive` is what makes this terminate: a job removes itself
        // from `jobs` in a completion handler, and there is no ordering guarantee that the handler has
        // run by the time `join` resumes, so an emptiness check alone could spin on completed jobs.
        while (true) {
            val active = jobs.toList().filter { it.isActive }
            if (active.isEmpty()) return
            active.forEach { it.join() }
        }
    }

    /** Reaps/sweeps still tracked. Test-only: guards against [jobs] growing over a session. */
    internal fun pending(): Int = jobs.size

    private fun track(job: Job) {
        jobs.add(job)
        job.invokeOnCompletion { jobs.remove(job) }
    }

    private fun reapNow(temp: Path) {
        val key = temp.normalize().toString()
        // Another reap (or a sweep that listed the same orphan) already owns this tree. Two walkers
        // over one tree only produce failures as each deletes files the other is about to visit.
        if (!reaping.add(key)) {
            LOG.info("worktree trash reap skipped: temp=$temp reason=in-progress")
            return
        }
        val start = System.currentTimeMillis()
        LOG.info("worktree trash reap start: temp=$temp")
        try {
            deleteRecursively(temp)
            LOG.info("worktree trash reap done: temp=$temp ms=${System.currentTimeMillis() - start}")
        } catch (e: Exception) {
            // Left in place deliberately: the name keeps its delete prefix, so it stays invisible to
            // every poll and the next sweep retries it.
            LOG.warn("worktree trash reap failed: temp=$temp message=${e.message}", e)
        } finally {
            reaping.remove(key)
        }
    }

    private fun deleteRecursively(root: Path) {
        if (!Files.exists(root)) return
        Files.walkFileTree(
            root,
            object : SimpleFileVisitor<Path>() {
                override fun visitFile(file: Path, attrs: BasicFileAttributes): FileVisitResult {
                    Files.deleteIfExists(file)
                    return FileVisitResult.CONTINUE
                }

                /**
                 * The base implementation rethrows, which would abandon the rest of the tree over one
                 * entry. A file that vanished on its own (an external process, or a `.kilo-delete-*`
                 * tree the VS Code extension is reaping concurrently) is already the outcome this
                 * walk wants, so carry on; anything else is genuinely unexpected and propagates.
                 */
                override fun visitFileFailed(file: Path, exc: IOException): FileVisitResult {
                    if (exc is NoSuchFileException) return FileVisitResult.CONTINUE
                    throw exc
                }

                override fun postVisitDirectory(dir: Path, exc: IOException?): FileVisitResult {
                    try {
                        Files.deleteIfExists(dir)
                    } catch (e: DirectoryNotEmptyException) {
                        // Something was written into the tree while it was being walked. Leaving the
                        // prefixed root behind is safe (see reapNow) and the next sweep retries.
                        LOG.info("worktree trash reap left a non-empty directory: dir=$dir message=${e.message}")
                    }
                    return FileVisitResult.CONTINUE
                }
            },
        )
    }

    /**
     * Existence-independent handle for a path, so a [mark]/[unmark] pair always agrees on the entry
     * to add and remove even though the directory disappears between the two calls.
     */
    private fun key(path: String): String = Path.of(path).normalize().toString()

    /**
     * Every string form [path] can legitimately be named by right now: its normalized form, plus its
     * symlink-resolved form when the directory still exists (on macOS a temp/repo root under `/var`
     * resolves to `/private/var`, and git reports whichever the worktree was registered with). Same
     * resolution rule as [ai.kilocode.backend.rpc.samePath]/`realPath`.
     */
    private fun identities(path: String): Set<String> {
        val file = Path.of(path).normalize()
        val real = if (Files.exists(file)) runCatching { file.toRealPath() }.getOrNull() else null
        return setOfNotNull(file.toString(), real?.toString())
    }
}
